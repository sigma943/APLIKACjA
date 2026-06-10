'use client';

import { memo, startTransition, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, CircleMarker, ZoomControl, useMapEvents, Pane } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchRouteGeometryClient, fetchRouteShapeClient, type RouteGeometryStop } from '@/lib/pks-client';
import { formatPublicStopName } from '@/lib/stop-display';

const PKS_COLOR = '#14b8a6';
const MPK_RZESZOW_COLOR = '#ff7a00';
const MARCEL_COLOR = '#68c44a';
const PKP_INTERCITY_COLOR = '#1d4ed8';
const ROUTE_POINT_LIMIT = 5000;
const ROAD_ROUTE_GEOMETRY_CACHE_VERSION = 'road-v10';
const RAIL_ROUTE_GEOMETRY_CACHE_VERSION = 'rail-v1';
const ROUTE_GEOMETRY_LOCAL_PREFIX = 'routeGeometry:';
const ROUTE_GEOMETRY_DB_NAME = 'pks-live-route-geometry';
const ROUTE_GEOMETRY_DB_VERSION = 1;
const ROUTE_GEOMETRY_DB_STORE = 'routes';
let routeGeometryDbPromise: Promise<IDBDatabase | null> | null = null;
let mapWorkerRef: Worker | null = null;
let mapWorkerRequestId = 0;

type StoredRouteGeometry = {
  key?: string;
  version?: string;
  createdAt?: number;
  permanent?: boolean;
  points?: [number, number][];
};

type WorkerRouteValidation = {
  complete: boolean;
  missedStops?: Array<{ id?: string | number; sequence?: number; distance?: number }>;
};

type WorkerMarkerGroup = {
  vehicleKeys: string[];
  lat: number;
  lon: number;
  provider: string;
  visualOffset: number;
  groupKey: string;
};

type VehicleMarkerGroup = {
  vehicles: Vehicle[];
  lat: number;
  lon: number;
  provider: string;
  visualOffset: number;
  groupKey: string;
};

function getMapWorker() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (!mapWorkerRef) {
    mapWorkerRef = new Worker('/map-worker.js');
  }
  return mapWorkerRef;
}

function requestMapWorker<T>(type: string, payload: unknown) {
  return new Promise<T>((resolve, reject) => {
    const worker = getMapWorker();
    if (!worker) {
      reject(new Error('Map worker unavailable'));
      return;
    }

    const id = ++mapWorkerRequestId;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data.result as T);
      else reject(new Error(event.data.error || 'Map worker failed'));
    };
    const handleError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error || new Error(event.message || 'Map worker failed'));
    };
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    worker.postMessage({ id, type, payload });
  });
}

function deferMapStorageWrite(value: { center: L.LatLng; zoom: number }) {
  if (typeof window === 'undefined') return;
  const write = () => {
    try {
      window.localStorage.setItem('mks_map_state', JSON.stringify(value));
    } catch {}
  };

  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(write, { timeout: 1200 });
    return;
  }
  globalThis.setTimeout(write, 0);
}

function scheduleMapIdle(callback: () => void, timeout = 250) {
  if (typeof window === 'undefined') return () => {};
  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(() => callback(), { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(callback, 18);
  return () => window.clearTimeout(id);
}

function getVehicleColor(vehicle?: Pick<Vehicle, 'provider'> | null, fallback = PKS_COLOR) {
  if (vehicle?.provider === 'mpk_rzeszow') return MPK_RZESZOW_COLOR;
  if (vehicle?.provider === 'marcel') return MARCEL_COLOR;
  if (vehicle?.provider === 'pkp_intercity') return PKP_INTERCITY_COLOR;
  if (vehicle?.provider === 'pks') return PKS_COLOR;
  return fallback;
}

function simplifyRouteForPaint(points: [number, number][], maxPoints = ROUTE_POINT_LIMIT) {
  const cleaned = removeRoutePaintSpikes(points);
  if (cleaned.length <= maxPoints) return cleaned;
  const step = Math.ceil(cleaned.length / maxPoints);
  const simplified: [number, number][] = [];

  for (let i = 0; i < cleaned.length; i += step) {
    simplified.push(cleaned[i]);
  }

  const last = cleaned[cleaned.length - 1];
  const currentLast = simplified[simplified.length - 1];
  if (!currentLast || currentLast[0] !== last[0] || currentLast[1] !== last[1]) {
    simplified.push(last);
  }

  return simplified;
}

function routePaintDistanceMeters(a: [number, number], b: [number, number]) {
  const meanLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
  const metersPerLat = 111_320;
  const metersPerLon = Math.cos(meanLat) * 111_320;
  const dx = (a[1] - b[1]) * metersPerLon;
  const dy = (a[0] - b[0]) * metersPerLat;
  return Math.hypot(dx, dy);
}

function routeLengthMeters(points: [number, number][]) {
  return points.reduce((sum, point, index) => {
    if (index === 0) return 0;
    return sum + routePaintDistanceMeters(points[index - 1], point);
  }, 0);
}

function distanceToRouteMeters(point: [number, number], route: [number, number][]) {
  if (route.length === 0) return Number.POSITIVE_INFINITY;
  if (route.length === 1) return routePaintDistanceMeters(point, route[0]);
  let best = Number.POSITIVE_INFINITY;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const meanLat = ((point[0] + start[0] + end[0]) / 3) * Math.PI / 180;
    const metersPerLat = 111_320;
    const metersPerLon = Math.cos(meanLat) * 111_320;
    const px = point[1] * metersPerLon;
    const py = point[0] * metersPerLat;
    const ax = start[1] * metersPerLon;
    const ay = start[0] * metersPerLat;
    const bx = end[1] * metersPerLon;
    const by = end[0] * metersPerLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    best = Math.min(best, Math.hypot(px - cx, py - cy));
  }

  return best;
}

function routeCoversIntermediateStops(points: [number, number][], stops: RouteGeometryStop[]) {
  if (stops.length <= 2) return true;

  for (let index = 1; index < stops.length - 1; index += 1) {
    const stop = stops[index];
    const point: [number, number] = [Number(stop.lat), Number(stop.lon)];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const tolerance = stops.length > 45 ? 320 : 240;
    if (distanceToRouteMeters(point, points) > tolerance) return false;
  }

  return true;
}

function isCompleteRouteGeometry(points: [number, number][], stops: RouteGeometryStop[]) {
  if (points.length < 2 || stops.length < 2) return false;
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  const start: [number, number] = [Number(firstStop.lat), Number(firstStop.lon)];
  const end: [number, number] = [Number(lastStop.lat), Number(lastStop.lon)];
  if (!Number.isFinite(start[0]) || !Number.isFinite(start[1]) || !Number.isFinite(end[0]) || !Number.isFinite(end[1])) {
    return false;
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const startDistance = Math.min(routePaintDistanceMeters(firstPoint, start), routePaintDistanceMeters(lastPoint, start));
  const endDistance = Math.min(routePaintDistanceMeters(firstPoint, end), routePaintDistanceMeters(lastPoint, end));
  const directDistance = routePaintDistanceMeters(start, end);
  const routeDistance = routeLengthMeters(points);
  const endpointTolerance = Math.max(450, Math.min(1400, directDistance * 0.08));

  return startDistance <= endpointTolerance &&
    endDistance <= endpointTolerance &&
    routeDistance >= directDistance * 0.72 &&
    routeCoversIntermediateStops(points, stops);
}

async function isCompleteRouteGeometryAsync(points: [number, number][], stops: RouteGeometryStop[]) {
  if (points.length < 2 || stops.length < 2) return false;
  try {
    const validation = await requestMapWorker<WorkerRouteValidation>('route:validate', { points, stops });
    return validation.complete === true;
  } catch {
    return isCompleteRouteGeometry(points, stops);
  }
}

function removeRoutePaintSpikes(points: [number, number][]) {
  if (points.length < 4) return points;
  const cleaned: [number, number][] = [points[0]];

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = cleaned[cleaned.length - 1];
    const current = points[i];
    const next = points[i + 1];
    const prevCurrent = routePaintDistanceMeters(prev, current);
    const currentNext = routePaintDistanceMeters(current, next);
    const prevNext = routePaintDistanceMeters(prev, next);
    const spikeLength = prevCurrent + currentNext;

    if (prevNext > 30 && spikeLength > prevNext * 4.5 && Math.max(prevCurrent, currentNext) > 90) {
      continue;
    }

    cleaned.push(current);
  }

  cleaned.push(points[points.length - 1]);
  return cleaned;
}

function dedupeStableStopIds(stopIds: Array<string | number>) {
  let last: string | null = null;
  const deduped: string[] = [];

  for (const rawId of stopIds) {
    const normalized = String(rawId || '').trim();
    if (!normalized) continue;
    if (!Number.isFinite(Number(normalized))) continue;
    // Preserve loop routes; remove only accidental consecutive duplicates.
    if (last === normalized) continue;
    deduped.push(normalized);
    last = normalized;
  }

  return deduped;
}

function normalizeRouteCachePart(value: unknown, fallback = 'unknown') {
  return String(value ?? fallback)
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || fallback;
}

function stableRouteHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function hashRouteGeometryStops(stops: RouteGeometryStop[]) {
  return stableRouteHash(
    stops
      .map((stop) => [
        String(stop.id ?? '').trim(),
        Number(stop.lat).toFixed(6),
        Number(stop.lon).toFixed(6),
      ].join(':'))
      .join('|'),
  );
}

function readLocalRouteGeometry(cacheKey: string, version: string) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${ROUTE_GEOMETRY_LOCAL_PREFIX}${cacheKey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredRouteGeometry;
    if (parsed.version !== version) return [];
    const points = Array.isArray(parsed.points) ? parsed.points : [];
    return points.filter((point): point is [number, number] =>
      Array.isArray(point) &&
      point.length === 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]),
    );
  } catch {
    return [];
  }
}

function openRouteGeometryDb() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);
  if (!routeGeometryDbPromise) {
    routeGeometryDbPromise = new Promise((resolve) => {
      const request = window.indexedDB.open(ROUTE_GEOMETRY_DB_NAME, ROUTE_GEOMETRY_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ROUTE_GEOMETRY_DB_STORE)) {
          db.createObjectStore(ROUTE_GEOMETRY_DB_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return routeGeometryDbPromise;
}

async function readIndexedRouteGeometry(cacheKey: string, version: string) {
  const db = await openRouteGeometryDb();
  if (!db) return [];
  return new Promise<[number, number][]>((resolve) => {
    const transaction = db.transaction(ROUTE_GEOMETRY_DB_STORE, 'readonly');
    const store = transaction.objectStore(ROUTE_GEOMETRY_DB_STORE);
    const request = store.get(cacheKey);
    request.onsuccess = () => {
      const parsed = request.result as StoredRouteGeometry | undefined;
      if (!parsed || parsed.version !== version) {
        resolve([]);
        return;
      }
      const points = Array.isArray(parsed.points) ? parsed.points : [];
      resolve(points.filter((point): point is [number, number] =>
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
      ));
    };
    request.onerror = () => resolve([]);
  });
}

async function readPersistentRouteGeometry(cacheKey: string, version: string) {
  const indexed = await readIndexedRouteGeometry(cacheKey, version).catch(() => []);
  if (indexed.length > 1) return indexed;
  return readLocalRouteGeometry(cacheKey, version);
}

function writeLocalRouteGeometry(cacheKey: string, points: [number, number][], version: string) {
  if (typeof window === 'undefined' || points.length <= 1) return;
  try {
    window.localStorage.setItem(
      `${ROUTE_GEOMETRY_LOCAL_PREFIX}${cacheKey}`,
      JSON.stringify({
        version,
        createdAt: Date.now(),
        permanent: true,
        points,
      }),
    );
  } catch {
    // localStorage may be full; memory cache still keeps the current session fast.
  }
}

async function writeIndexedRouteGeometry(cacheKey: string, points: [number, number][], version: string) {
  if (points.length <= 1) return;
  const db = await openRouteGeometryDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(ROUTE_GEOMETRY_DB_STORE, 'readwrite');
    const store = transaction.objectStore(ROUTE_GEOMETRY_DB_STORE);
    store.put({
      key: cacheKey,
      version,
      createdAt: Date.now(),
      permanent: true,
      points,
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

function writePersistentRouteGeometry(cacheKey: string, points: [number, number][], version: string) {
  writeLocalRouteGeometry(cacheKey, points, version);
  void writeIndexedRouteGeometry(cacheKey, points, version).catch(() => {});
}

function MapStateTracker({
  onInteraction,
  onViewportChange,
}: {
  onInteraction: (active: boolean) => void;
  onViewportChange?: (payload: { bbox: [number, number, number, number]; center: [number, number]; zoom: number }) => void;
}) {
  const map = useMap();
  const emitViewport = useCallback(() => {
    if (!onViewportChange) return;
    const bounds = map.getBounds();
    const center = map.getCenter();
    onViewportChange({
      bbox: [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()],
      center: [center.lat, center.lng],
      zoom: map.getZoom(),
    });
  }, [map, onViewportChange]);

  useEffect(() => {
    emitViewport();
  }, [emitViewport]);

  useMapEvents({
    zoomstart: () => onInteraction(true),
    zoomend: () => {
      onInteraction(false);
      deferMapStorageWrite({ center: map.getCenter(), zoom: map.getZoom() });
      emitViewport();
    },
    movestart: () => onInteraction(true),
    moveend: () => {
      onInteraction(false);
      deferMapStorageWrite({ center: map.getCenter(), zoom: map.getZoom() });
      emitViewport();
    },
  });
  return null;
}

function useCachedMapTiles() {
  const [canUseCachedTiles, setCanUseCachedTiles] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const update = () => setCanUseCachedTiles(Boolean(navigator.serviceWorker.controller));
    update();
    navigator.serviceWorker.ready.then(update).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', update);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', update);
  }, []);

  return canUseCachedTiles;
}

const formatDelay = (delaySec: number | undefined) => {
  if (delaySec === undefined) return null;
  if (Math.abs(delaySec) > 18000) return null; // Ignore absurd delays > 5 hours
  const abs = Math.abs(delaySec);
  const min = Math.floor(abs / 60);
  
  if (delaySec < -60) {
    return { text: `Przed ${min}m`, textLong: `Przed czasem: ${min} min`, class: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' }; // Ahead of time
  } else if (delaySec > 60) {
    return { text: `Opóźn. ${min}m`, textLong: `Opóźniony: ${min} min`, class: 'text-rose-600', bg: 'bg-rose-50 border-rose-200' }; // Delayed
  }
  return { text: 'Punktualnie', textLong: 'Zgodnie z planem', class: 'text-slate-500', bg: 'bg-white border-slate-200' };
};

const formatDelayBadgeSign = (delayValue: number) => {
  if (delayValue > 0) return '-';
  if (delayValue < 0) return '+';
  return '';
};

// Caching icons to prevent React-Leaflet from recreating DOM nodes unnecessarily
const iconCache = new Map<string, L.DivIcon>();
const clusterIconCache = new Map<string, L.DivIcon>();

const getMarkerAgeBucket = (dataAgeSec?: number) => {
  if (dataAgeSec === undefined) return 0;
  if (dataAgeSec > 180) return Math.floor(dataAgeSec / 60);
  if (dataAgeSec > 60) return dataAgeSec < 120 ? 1 : Math.floor(dataAgeSec / 60);
  return 0;
};

export const getCachedBusIcon = (
  routeShortName: string,
  vehicleId: string,
  delaySec?: number,
  isSelected?: boolean,
  themeColor: string = PKS_COLOR,
  dataAgeSec?: number,
  isHighVolume?: boolean,
  iconVariant?: string,
  vehicleLabel?: string,
  zoom: number = 14,
) => {
  const ageBucket = getMarkerAgeBucket(dataAgeSec);
  const delayBucket = delaySec === undefined ? 'na' : Math.trunc(delaySec / 60);
  const zoomBucket = zoom <= 12 ? 12 : zoom <= 13 ? 13 : 14;
  const hash = `${routeShortName}_${vehicleId}_${vehicleLabel}_${delayBucket}_${isSelected}_${themeColor}_${ageBucket}_${isHighVolume}_${iconVariant}_${zoomBucket}`;
  
  if (iconCache.has(hash)) {
    return iconCache.get(hash)!;
  }
  
  const icon = createBusIcon(routeShortName, vehicleId, delaySec, isSelected, themeColor, dataAgeSec, isHighVolume, iconVariant, vehicleLabel, zoom);
  
  // keep cache size reasonable
  if (iconCache.size > 2000) {
    const keys = Array.from(iconCache.keys());
    for (let i = 0; i < 500; i++) iconCache.delete(keys[i]);
  }
  
  iconCache.set(hash, icon);
  return icon;
};

const createBusIcon = (
  routeShortName: string,
  vehicleId: string,
  delaySec?: number,
  isSelected?: boolean,
  themeColor: string = PKS_COLOR,
  dataAgeSec?: number,
  isHighVolume?: boolean,
  iconVariant?: string,
  vehicleLabel?: string,
  zoom: number = 14,
) => {
  const trainCategory = String(iconVariant || routeShortName || '').toUpperCase();
  if (trainCategory === 'IC' || trainCategory === 'EIC' || trainCategory === 'EIP') {
    return createTrainIcon(routeShortName, vehicleId, delaySec, isSelected, dataAgeSec, isHighVolume, trainCategory, vehicleLabel);
  }

  const display = routeShortName || '?';
  const numberLabel = String(vehicleLabel || '').trim();
  const delayInfo = formatDelay(delaySec);
  
  let opacityClass = 'opacity-90';
  let filterStyle = '';

  const isSelClass = isSelected 
    ? 'z-[2000] scale-125 saturate-110 drop-shadow-2xl' 
    : `z-[100] scale-100 ${opacityClass} ${isHighVolume ? '' : 'drop-shadow-md hover:scale-105'}`;

  let badgeHtml = '';
  if (delayInfo && delaySec !== undefined && Math.abs(delaySec) > 60) {
    const delayPositionClass = delaySec > 0 ? '-top-[18px] left-[34px]' : '-top-4 -right-3';
    badgeHtml = `
      <div class="absolute ${delayPositionClass} px-1.5 py-0.5 rounded ${delayInfo.bg} ${delayInfo.class} text-[9px] font-black border border-white ${isHighVolume?'':'shadow-sm'} z-50 whitespace-nowrap">
        ${formatDelayBadgeSign(delaySec)}${Math.floor(Math.abs(delaySec)/60)}
      </div>
    `;
  }

  const markerColor = iconVariant === 'mpk_rzeszow' ? MPK_RZESZOW_COLOR : iconVariant === 'marcel' ? MARCEL_COLOR : themeColor;

  const html = `
    <div class="mks-marker-inner relative flex flex-col items-center justify-start ${isSelClass}" style="width: 48px; height: 68px; ${filterStyle}">
      
      <!-- Sleek App-Icon Style Bus Front -->
      <div class="relative w-[34px] bg-white border-2 border-white rounded-[8px] z-10 flex flex-col overflow-hidden ${isHighVolume?'':'shadow-sm'}" style="background-color: ${markerColor};">
        
        <!-- Large Route Number -->
        <span class="text-white font-black text-[13px] pt-1 pb-0.5 text-center leading-none drop-shadow-sm">
          ${display}
        </span>
        
        <!-- Minimal Windshield Container -->
        <div class="px-[4px] pb-[3px] w-full">
          <div class="w-full h-[8px] rounded-[2px]" style="background-color: rgba(15, 23, 42, 0.65); box-shadow: inset 0 2px 4px rgba(0,0,0,0.2)"></div>
        </div>

        <!-- Minimal Headlights -->
        <div class="flex justify-between px-1.5 pb-1 w-full">
          <div class="w-1 h-1 rounded-full" style="background-color: rgba(255,255,255,0.9)"></div>
          <div class="w-1 h-1 rounded-full" style="background-color: rgba(255,255,255,0.9)"></div>
        </div>

        ${isSelected ? `<div class="absolute inset-0 bg-white/20 pointer-events-none"></div>` : ''}
      </div>

      <!-- Tiny Tires -->
      <div class="flex justify-between w-[24px] -mt-0.5 z-0">
        <div class="w-1.5 h-1.5 rounded-b-sm" style="background-color: #1e293b"></div>
        <div class="w-1.5 h-1.5 rounded-b-sm" style="background-color: #1e293b"></div>
      </div>

      ${numberLabel ? `
        <!-- Minimal Vehicle ID -->
        <div class="mt-1 border border-slate-200 rounded px-1.5 py-[1px] text-[8px] tracking-wide font-bold max-w-[44px] truncate text-center ${isHighVolume?'':'shadow-sm'} flex items-center justify-center gap-1" style="background-color: rgba(255,255,255,0.95); color: #64748b;">
          <span>${numberLabel}</span>
        </div>
      ` : ''}

      ${badgeHtml}
    </div>
  `;

  return L.divIcon({
    className: 'mks-bus-marker !bg-transparent !border-0',
    html: html,
    iconSize: [48, 72],
    iconAnchor: [24, 46],
    popupAnchor: [0, -46],
  });
};

const createTrainIcon = (
  routeShortName: string,
  vehicleId: string,
  delaySec?: number,
  isSelected?: boolean,
  dataAgeSec?: number,
  isHighVolume?: boolean,
  iconVariant?: string,
  vehicleLabel?: string,
) => {
  const category = iconVariant === 'EIP' || iconVariant === 'EIC' || iconVariant === 'IC' ? iconVariant : 'IC';
  const display = routeShortName || category;
  const numberLabel = String(vehicleLabel || '').trim();
  const delayInfo = formatDelay(delaySec);
  const isSelClass = isSelected
    ? 'z-[2000] scale-125 saturate-110 drop-shadow-2xl'
    : `z-[100] scale-100 opacity-95 ${isHighVolume ? '' : 'drop-shadow-md hover:scale-105'}`;

  let badgeHtml = '';
  if (delayInfo && delaySec !== undefined && Math.abs(delaySec) > 60) {
    badgeHtml = `
      <div class="absolute -top-2 -right-2 px-1.5 py-0.5 rounded ${delayInfo.bg} ${delayInfo.class} text-[9px] font-black border border-white ${isHighVolume ? '' : 'shadow-sm'} z-50 whitespace-nowrap">
        ${formatDelayBadgeSign(delaySec)}${Math.floor(Math.abs(delaySec) / 60)}
      </div>
    `;
  }

  const html = `
    <div class="mks-marker-inner relative flex flex-col items-center justify-start ${isSelClass}" style="width: 58px; height: 72px;">
      <div class="relative flex h-[45px] w-[45px] items-center justify-center rounded-[12px] border-2 border-white bg-white ${isHighVolume ? '' : 'shadow-lg'} overflow-hidden">
        <img src="/train-icons/${category}.svg" alt="" class="h-[38px] w-[38px] object-contain" />
        <div class="absolute left-1 top-1 rounded bg-[#1d4ed8] px-1 text-[8px] font-black leading-3 text-white">${display}</div>
        ${isSelected ? `<div class="absolute inset-0 bg-blue-400/10 pointer-events-none"></div>` : ''}
      </div>
      ${numberLabel ? `
        <div class="mt-1 border border-slate-200 rounded px-1.5 py-[1px] text-[8px] tracking-wide font-bold max-w-[54px] truncate text-center ${isHighVolume ? '' : 'shadow-sm'} flex items-center justify-center" style="background-color: rgba(255,255,255,0.96); color: #1e3a8a;">
          <span>${numberLabel}</span>
        </div>
      ` : ''}
      ${badgeHtml}
    </div>
  `;

  return L.divIcon({
    className: 'mks-bus-marker mks-train-marker !bg-transparent !border-0',
    html,
    iconSize: [58, 74],
    iconAnchor: [29, 50],
    popupAnchor: [0, -50],
  });
};

const getCachedClusterIcon = (count: number, size: number, clusterColor: string, visualOffset: number) => {
  const key = `${count}_${size}_${clusterColor}_${visualOffset}`;
  const cached = clusterIconCache.get(key);
  if (cached) return cached;

  const icon = L.divIcon({
    className: 'mks-bus-cluster !bg-transparent !border-0',
    html: `
      <div class="relative flex items-center justify-center" style="width:${size}px;height:${size}px;transform:translateX(${visualOffset}px)">
        <div class="absolute inset-0 rounded-full" style="background:${clusterColor};opacity:.20;box-shadow:0 0 28px ${clusterColor}66"></div>
        <div class="absolute inset-[5px] rounded-full border-2 border-white/90 shadow-xl" style="background:${clusterColor}"></div>
        <div class="relative z-10 text-white font-black text-[15px] tracking-tight">${count}</div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  if (clusterIconCache.size > 300) {
    const firstKey = clusterIconCache.keys().next().value;
    if (firstKey) clusterIconCache.delete(firstKey);
  }
  clusterIconCache.set(key, icon);
  return icon;
};

export interface StopSchedule {
  id: number;
  name: string;
  planned: string | null;
  real: string | null;
  lat?: number;
  lon?: number;
  isPast?: boolean;
  platform?: string;
  track?: string;
  stopDelayMinutes?: number;
  timeType?: 'arrival' | 'departure';
}

export interface Vehicle {
  id: string;
  provider?: string;
  operatorName?: string;
  type?: 'bus' | 'train';
  iconVariant?: string;
  vehicleNumber?: string;
  name: string;
  routeId?: string;
  routeShortName?: string;
  lat: number;
  lon: number;
  speed?: number;
  direction?: string;
  delay?: number;
  dataAgeSec?: number;
  schedule?: StopSchedule[];
  routeStops?: StopSchedule[];
  routePath?: number[];
  routeShape?: [number, number][];
  model?: string;
  // Test fields
  lastStopDistance?: number;
  lastStopId?: number;
  lastSignalTime?: string;
  previousTripEndedAtMs?: number;
  nextTripStartAtMs?: number;
  nextTripFirstStopId?: number;
  computedSpeed?: number;
  journeyId?: string | number;
  serviceId?: string | number;
  tripId?: string | number;
  brigadeName?: string;
  bearing?: number;
  status?: 'active' | 'break' | 'inactive' | 'technical' | 'cached';
  statusText?: string;
  isHistorical?: boolean;
  trainName?: string;
  positionQuality?: 'known' | 'estimated';
}

export interface StopData {
  n: string;
  lat: number;
  lon: number;
}

interface BusMapProps {
  vehicles: Vehicle[];
  onVehicleClick?: (vehicle: Vehicle) => void;
  selectedVehicleId?: string | null;
  selectedVehicle?: Vehicle | null;
  stopsData?: Record<string, StopData> | null;
  themeColor?: string;
  refreshInterval?: number;
  forcedCenter?: [number, number] | null;
  onCenterComplete?: () => void;
  highlightedStopId?: string | null;
  onStopClick?: (stopId: string) => void;
  onMapClick?: () => void;
  onViewportChange?: (payload: { bbox: [number, number, number, number]; center: [number, number]; zoom: number }) => void;
}

function MapCenterer({ center, onComplete }: { center: [number, number] | null, onComplete?: () => void }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, 16, { animate: true, duration: 1.5 });
      if (onComplete) {
        setTimeout(onComplete, 1600);
      }
    }
  }, [center, map, onComplete]);
  return null;
}

function MapClickListener({ onClick }: { onClick?: () => void }) {
  useMapEvents({
    click: () => {
      if (onClick) onClick();
    }
  });
  return null;
}

type BusMarkerProps = {
  markerKey: string;
  vehicle: Vehicle;
  isSelected: boolean;
  isHighVolume: boolean;
  vehicleColor: string;
  zoom: number;
  onMarkerClick?: (markerKey: string) => void;
  registerMarker?: (markerKey: string, marker: L.Marker | null) => void;
};

const BusMarker = memo(function BusMarker({
  markerKey,
  vehicle,
  isSelected,
  isHighVolume,
  vehicleColor,
  zoom,
  onMarkerClick,
  registerMarker,
}: BusMarkerProps) {
  const initialPosition = useMemo<[number, number]>(() => [vehicle.lat, vehicle.lon], []); // eslint-disable-line react-hooks/exhaustive-deps
  const delayBucket = vehicle.delay === undefined ? 'na' : Math.trunc(vehicle.delay / 60);
  const ageBucket = getMarkerAgeBucket(vehicle.dataAgeSec);
  const icon = useMemo(
    () =>
      getCachedBusIcon(
        vehicle.routeShortName || '',
        vehicle.id,
        vehicle.delay,
        isSelected,
        vehicleColor,
        vehicle.dataAgeSec,
        isHighVolume,
        vehicle.iconVariant,
        vehicle.provider === 'pkp_intercity'
          ? String(
              vehicle.vehicleNumber
                ? `${String(vehicle.routeShortName || vehicle.iconVariant || '').trim().toUpperCase()} ${String(vehicle.vehicleNumber).trim()}`
                : '',
            ).trim()
          : (vehicle.vehicleNumber || (vehicle.provider === 'marcel' ? '' : vehicle.id)),
        zoom,
      ),
    [
      vehicle.routeShortName,
      vehicle.id,
      delayBucket,
      isSelected,
      vehicleColor,
      ageBucket,
      isHighVolume,
      vehicle.iconVariant,
      vehicle.vehicleNumber,
      zoom,
    ],
  );
  const eventHandlers = useMemo(
    () => ({
      click: (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e as any);
        if (onMarkerClick) onMarkerClick(markerKey);
      },
    }),
    [markerKey, onMarkerClick],
  );
  const refHandler = useCallback(
    (marker: L.Marker | null) => {
      if (registerMarker) registerMarker(markerKey, marker);
    },
    [markerKey, registerMarker],
  );

  return (
    <Marker
      ref={refHandler}
      position={initialPosition}
      icon={icon}
      zIndexOffset={isSelected ? 1000 : 0}
      eventHandlers={eventHandlers}
    />
  );
}, (prev, next) => {
  const prevVehicle = prev.vehicle;
  const nextVehicle = next.vehicle;
  return (
    prev.markerKey === next.markerKey &&
    prevVehicle.routeShortName === nextVehicle.routeShortName &&
    prevVehicle.id === nextVehicle.id &&
    prevVehicle.provider === nextVehicle.provider &&
    prevVehicle.iconVariant === nextVehicle.iconVariant &&
    prevVehicle.vehicleNumber === nextVehicle.vehicleNumber &&
    Math.trunc((prevVehicle.delay || 0) / 60) === Math.trunc((nextVehicle.delay || 0) / 60) &&
    getMarkerAgeBucket(prevVehicle.dataAgeSec) === getMarkerAgeBucket(nextVehicle.dataAgeSec) &&
    prev.isSelected === next.isSelected &&
    prev.isHighVolume === next.isHighVolume &&
    prev.vehicleColor === next.vehicleColor &&
    prev.zoom === next.zoom &&
    prev.onMarkerClick === next.onMarkerClick &&
    prev.registerMarker === next.registerMarker
  );
});

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function CanvasVehicleLayer({
  groups,
  selectedVehicleId,
  onVehicleClick,
}: {
  groups: VehicleMarkerGroup[];
  selectedVehicleId?: string | null;
  onVehicleClick?: (vehicle: Vehicle) => void;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitTargetsRef = useRef<Array<{ x: number; y: number; radius: number; group: VehicleMarkerGroup }>>([]);
  const drawRafRef = useRef<number | null>(null);
  const canvasSizeRef = useRef({ width: 0, height: 0, ratio: 0 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(size.x * ratio));
    const height = Math.max(1, Math.round(size.y * ratio));
    const previousSize = canvasSizeRef.current;
    if (previousSize.width !== width || previousSize.height !== height || previousSize.ratio !== ratio) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      canvasSizeRef.current = { width, height, ratio };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    hitTargetsRef.current = [];

    for (const group of groups) {
      const point = map.latLngToContainerPoint([group.lat, group.lon]);
      const count = group.vehicles.length;
      const firstVehicle = group.vehicles[0];
      const isCluster = count > 1;
      const isSelected = !isCluster && selectedVehicleId === firstVehicle?.id;
      const color = getVehicleColor(firstVehicle || ({ provider: group.provider } as Vehicle));
      const radius = isCluster ? (count >= 10 ? 25 : 22) : (isSelected ? 24 : 20);
      const x = point.x + group.visualOffset;
      const y = point.y;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.42)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = color;
      roundedRect(ctx, x - radius, y - radius, radius * 2, radius * 2, 10);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.84)';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = isCluster ? '900 13px system-ui, sans-serif' : '900 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = isCluster
        ? String(count)
        : String(firstVehicle?.routeShortName || firstVehicle?.vehicleNumber || '').replace(/^MKS\s+/, '').slice(0, 4);
      ctx.fillText(label || '•', x, y + 0.5);

      const delay = !isCluster ? Number(firstVehicle?.delay) : 0;
      if (!isCluster && Number.isFinite(delay) && Math.abs(delay) >= 60) {
        const delayMin = Math.round(delay / 60);
        const badge = `${formatDelayBadgeSign(delayMin)}${Math.abs(delayMin)}`;
        ctx.font = '900 10px system-ui, sans-serif';
        const metrics = ctx.measureText(badge);
        const badgeW = Math.max(22, metrics.width + 10);
        ctx.fillStyle = delayMin > 0 ? '#ef4444' : '#10b981';
        roundedRect(ctx, x + radius - 8, y - radius - 10, badgeW, 18, 6);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(badge, x + radius - 8 + badgeW / 2, y - radius - 1);
      }

      ctx.restore();
      hitTargetsRef.current.push({ x, y, radius: radius + 8, group });
    }
  }, [groups, map, selectedVehicleId]);

  const scheduleDraw = useCallback(() => {
    if (drawRafRef.current !== null) return;
    drawRafRef.current = window.requestAnimationFrame(() => {
      drawRafRef.current = null;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    const pane = map.getPanes().markerPane;
    const canvas = L.DomUtil.create('canvas', 'mks-canvas-vehicle-layer') as HTMLCanvasElement;
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.zIndex = '650';
    canvas.style.pointerEvents = 'auto';
    pane.appendChild(canvas);
    canvasRef.current = canvas;

    const resetPosition = () => {
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);
      scheduleDraw();
    };
    const handleClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const target = hitTargetsRef.current
        .slice()
        .reverse()
        .find((item) => Math.hypot(item.x - x, item.y - y) <= item.radius);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (target.group.vehicles.length > 1) {
        const bounds = L.latLngBounds(target.group.vehicles.map((vehicle) => [vehicle.lat, vehicle.lon] as [number, number]));
        map.fitBounds(bounds.pad(0.35), { animate: true, maxZoom: Math.max(14, map.getZoom() + 2) });
      } else if (target.group.vehicles[0]) {
        onVehicleClick?.(target.group.vehicles[0]);
      }
    };

    canvas.addEventListener('click', handleClick);
    map.on('move zoom resize moveend zoomend', resetPosition);
    resetPosition();

    return () => {
      if (drawRafRef.current !== null) {
        window.cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
      canvas.removeEventListener('click', handleClick);
      map.off('move zoom resize moveend zoomend', resetPosition);
      canvas.remove();
      canvasRef.current = null;
      hitTargetsRef.current = [];
    };
  }, [draw, map, onVehicleClick, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw]);

  return null;
}

function VehicleMarkerLayer({
  vehicles,
  selectedVehicleId,
  themeColor,
  refreshInterval,
  onVehicleClick,
  onInitialMarkersReady,
}: {
  vehicles: Vehicle[];
  selectedVehicleId?: string | null;
  themeColor: string;
  refreshInterval: number;
  onVehicleClick?: (vehicle: Vehicle) => void;
  onInitialMarkersReady?: () => void;
}) {
  const map = useMap();
  const [viewTick, setViewTick] = useState(0);
  const [renderVehicles, setRenderVehicles] = useState(vehicles);
  const [markerRenderLimit, setMarkerRenderLimit] = useState(0);
  const [useCanvasMarkers, setUseCanvasMarkers] = useState(false);
  const latestVehiclesRef = useRef(vehicles);
  const latestVehicleByKeyRef = useRef(new Map<string, Vehicle>());
  const markerRefs = useRef(new Map<string, L.Marker>());
  const mapMovingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const hasReportedInitialMarkersRef = useRef(false);
  const lastGroupsLengthRef = useRef(0);

  const getVehicleMarkerKey = useCallback((vehicle: Vehicle) => `${vehicle.provider || 'pks'}:${vehicle.id}`, []);

  useEffect(() => {
    setUseCanvasMarkers(false);
  }, []);

  const registerMarker = useCallback((markerKey: string, marker: L.Marker | null) => {
    if (marker) markerRefs.current.set(markerKey, marker);
    else markerRefs.current.delete(markerKey);
  }, []);

  const handleMarkerClick = useCallback((markerKey: string) => {
    const vehicle = latestVehicleByKeyRef.current.get(markerKey);
    if (vehicle && onVehicleClick) onVehicleClick(vehicle);
  }, [onVehicleClick]);

  const flushVehicleUpdates = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setRenderVehicles(latestVehiclesRef.current);
  }, []);

  useMapEvents({
    movestart: () => {
      mapMovingRef.current = true;
    },
    zoomstart: () => {
      mapMovingRef.current = true;
    },
    zoomend: () => {
      mapMovingRef.current = false;
      setViewTick((value) => value + 1);
      flushVehicleUpdates();
    },
    moveend: () => {
      mapMovingRef.current = false;
      setViewTick((value) => value + 1);
      flushVehicleUpdates();
    },
  });

  useEffect(() => {
    latestVehiclesRef.current = vehicles;
    latestVehicleByKeyRef.current = new Map(vehicles.map((vehicle) => [getVehicleMarkerKey(vehicle), vehicle]));
    if (mapMovingRef.current) return;

    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setRenderVehicles(latestVehiclesRef.current);
    });

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [getVehicleMarkerKey, vehicles]);

  const zoom = map.getZoom();
  const isHighVolumeLayer = renderVehicles.length > 35;
  const [groups, setGroups] = useState<Array<{
    vehicles: Vehicle[];
    lat: number;
    lon: number;
    provider: string;
    visualOffset: number;
    groupKey: string;
  }>>([]);

  useEffect(() => {
    let cancelled = false;
    const bounds = map.getBounds().pad(0.2);
    const minimalVehicles = renderVehicles.map((vehicle) => ({
      key: getVehicleMarkerKey(vehicle),
      id: vehicle.id,
      provider: vehicle.provider || 'pks',
      lat: vehicle.lat,
      lon: vehicle.lon,
    }));
    const byKey = new Map(renderVehicles.map((vehicle) => [getVehicleMarkerKey(vehicle), vehicle]));
    const applyWorkerGroups = (workerGroups: WorkerMarkerGroup[]) => {
      if (cancelled) return;
      setGroups(workerGroups.map((group) => ({
        ...group,
        vehicles: group.vehicleKeys
          .map((key) => byKey.get(key))
          .filter((vehicle): vehicle is Vehicle => Boolean(vehicle)),
      })).filter((group) => group.vehicles.length > 0));
    };

    requestMapWorker<{ groups: WorkerMarkerGroup[] }>('markers:cluster', {
      vehicles: minimalVehicles,
      zoom,
      bounds: {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      },
    })
      .then((result) => applyWorkerGroups(result.groups || []))
      .catch(() => {
        if (cancelled) return;
        const fallbackVehicles = renderVehicles.length <= 80
          ? renderVehicles
          : renderVehicles.filter((vehicle) => bounds.contains([vehicle.lat, vehicle.lon]));
        setGroups(fallbackVehicles.map((vehicle) => ({
          vehicles: [vehicle],
          lat: vehicle.lat,
          lon: vehicle.lon,
          provider: vehicle.provider || 'pks',
          visualOffset: 0,
          groupKey: getVehicleMarkerKey(vehicle),
        })));
      });

    return () => {
      cancelled = true;
    };
  }, [getVehicleMarkerKey, map, renderVehicles, viewTick, zoom]);

  useEffect(() => {
    let cancelled = false;
    let cancelScheduled = () => {};
    if (useCanvasMarkers) {
      setMarkerRenderLimit(groups.length);
      lastGroupsLengthRef.current = groups.length;
      return;
    }
    const firstChunk = groups.length > 90 ? 12 : groups.length > 36 ? 18 : groups.length;
    const chunkSize = groups.length > 180 ? 14 : groups.length > 90 ? 18 : 26;
    if (groups.length === 0) {
      setMarkerRenderLimit(0);
      lastGroupsLengthRef.current = 0;
      return;
    }
    if (hasReportedInitialMarkersRef.current && markerRenderLimit >= lastGroupsLengthRef.current) {
      setMarkerRenderLimit(groups.length);
      lastGroupsLengthRef.current = groups.length;
      return;
    }
    if (
      hasReportedInitialMarkersRef.current &&
      groups.length <= 30 &&
      Math.abs(groups.length - lastGroupsLengthRef.current) <= 8
    ) {
      setMarkerRenderLimit(groups.length);
      lastGroupsLengthRef.current = groups.length;
      return;
    }
    const pump = () => {
      if (cancelled) return;
      setMarkerRenderLimit((current) => {
        if (current >= groups.length) return current;
        const next = Math.min(groups.length, current + chunkSize);
        if (next < groups.length) cancelScheduled = scheduleMapIdle(pump, 220);
        return next;
      });
    };

    cancelScheduled = scheduleMapIdle(() => {
      if (cancelled) return;
      setMarkerRenderLimit(firstChunk);
      if (firstChunk < groups.length) cancelScheduled = scheduleMapIdle(pump, 220);
    }, 180);
    lastGroupsLengthRef.current = groups.length;

    return () => {
      cancelled = true;
      cancelScheduled();
    };
  }, [groups.length, markerRenderLimit, useCanvasMarkers]);

  const visibleGroups = useMemo(() => groups.slice(0, markerRenderLimit), [groups, markerRenderLimit]);

  useEffect(() => {
    if (hasReportedInitialMarkersRef.current) return;
    if (groups.length === 0) {
      const cancel = scheduleMapIdle(() => {
        if (hasReportedInitialMarkersRef.current) return;
        hasReportedInitialMarkersRef.current = true;
        onInitialMarkersReady?.();
      }, 180);
      return cancel;
    }
    if (groups.length > 0 && markerRenderLimit < groups.length) return;
    hasReportedInitialMarkersRef.current = true;
    onInitialMarkersReady?.();
  }, [groups.length, markerRenderLimit, onInitialMarkersReady]);

  useEffect(() => {
    for (const group of visibleGroups) {
      if (group.vehicles.length > 1) continue;
      const vehicle = group.vehicles[0];
      const marker = markerRefs.current.get(getVehicleMarkerKey(vehicle));
      if (marker) marker.setLatLng([vehicle.lat, vehicle.lon]);
    }
  }, [getVehicleMarkerKey, visibleGroups]);

  if (useCanvasMarkers) {
    return (
      <CanvasVehicleLayer
        groups={groups}
        selectedVehicleId={selectedVehicleId}
        onVehicleClick={onVehicleClick}
      />
    );
  }

  return (
    <>
      {visibleGroups.map((group) => {
        if (group.vehicles.length > 1) {
          const count = group.vehicles.length;
          const size = count >= 10 ? 54 : 46;
          const clusterColor = getVehicleColor(group.vehicles[0]);
          return (
            <Marker
              key={`cluster-${group.groupKey}`}
              position={[group.lat, group.lon]}
              zIndexOffset={900}
              icon={getCachedClusterIcon(count, size, clusterColor, group.visualOffset)}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e as any);
                  const bounds = L.latLngBounds(group.vehicles.map((vehicle) => [vehicle.lat, vehicle.lon] as [number, number]));
                  map.fitBounds(bounds.pad(0.35), { animate: true, maxZoom: Math.max(14, zoom + 2) });
                },
              }}
            />
          );
        }

        const vehicle = group.vehicles[0];
        const isSelected = selectedVehicleId === vehicle.id;
        const isHighVolume = renderVehicles.length > 35;
        const vehicleColor = getVehicleColor(vehicle);
        return (
          <BusMarker
            key={getVehicleMarkerKey(vehicle)}
            markerKey={getVehicleMarkerKey(vehicle)}
            vehicle={vehicle}
            isSelected={isSelected}
            isHighVolume={isHighVolume}
            vehicleColor={vehicleColor}
            zoom={zoom}
            onMarkerClick={handleMarkerClick}
            registerMarker={registerMarker}
          />
        );
      })}
    </>
  );
}

function RouteStopsLayer({
  selectedVehicle,
  stopsData,
  stopIds,
  highlightedStopId,
  selectedRouteColor,
  onStopClick,
}: {
  selectedVehicle?: Vehicle;
  stopsData: Record<string, StopData>;
  stopIds: Array<string | number>;
  highlightedStopId?: string | null;
  selectedRouteColor: string;
  onStopClick?: (stopId: string) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const visibleStopIds = useMemo(() => {
    if (!selectedVehicle) return [];

    const maxStops =
      zoom <= 11 ? 12 :
      zoom <= 12 ? 18 :
      zoom <= 13 ? 30 :
      zoom <= 14 ? 44 :
      Number.POSITIVE_INFINITY;
    if (stopIds.length <= maxStops) return stopIds;

    const step = Math.ceil(stopIds.length / maxStops);
    return stopIds.filter((stopId, idx) =>
      idx === 0 ||
      idx === stopIds.length - 1 ||
      String(stopId) === highlightedStopId ||
      idx % step === 0,
    );
  }, [highlightedStopId, selectedVehicle, stopIds, zoom]);

  if (!selectedVehicle) return null;

  const baseRadius = zoom <= 11 ? 4.5 : zoom <= 13 ? 5.1 : zoom <= 14 ? 5.8 : 6.5;

  return (
    <>
      {visibleStopIds.map((stopId, idx) => {
        const stop = stopsData[String(stopId)];
        if (!stop) return null;
        const isHighlighted = String(stopId) === highlightedStopId;

        return (
          <CircleMarker
            key={`stop-${stopId}-${idx}`}
            pane="routeStopsPane"
            center={[stop.lat, stop.lon]}
            radius={isHighlighted ? baseRadius + 2.3 : baseRadius}
            color={isHighlighted ? selectedRouteColor : 'rgba(12,18,28,0.9)'}
            fillColor="#ffffff"
            fillOpacity={1}
            weight={isHighlighted ? 4.6 : 2.8}
            pathOptions={{ pane: 'routeStopsPane', className: 'mks-route-stop-marker' }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e as any);
                if (onStopClick) onStopClick(String(stopId));
              }
            }}
          />
        );
      })}
    </>
  );
}

function RouteLineLayer({
  routeKey,
  positions,
  haloOptions,
  glowOptions,
  lineOptions,
}: {
  routeKey: string;
  positions: [number, number][];
  haloOptions: L.PolylineOptions;
  glowOptions: L.PolylineOptions;
  lineOptions: L.PolylineOptions;
}) {
  const map = useMap();
  const rendererRef = useRef<L.Renderer | null>(null);
  const layersRef = useRef<{ halo: L.Polyline; glow: L.Polyline; line: L.Polyline } | null>(null);
  const lastRouteKeyRef = useRef('');
  const lastPositionsRef = useRef<[number, number][] | null>(null);

  useEffect(() => {
    return () => {
      const layers = layersRef.current;
      if (layers) {
        layers.halo.remove();
        layers.glow.remove();
        layers.line.remove();
        layersRef.current = null;
      }
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!rendererRef.current) {
      rendererRef.current = L.canvas({ pane: 'routeLinePane', padding: 0.45 });
    }

    const renderer = rendererRef.current;
    const withRenderer = (options: L.PolylineOptions): L.PolylineOptions => ({
      ...options,
      renderer,
      interactive: false,
    });

    if (!layersRef.current) {
      layersRef.current = {
        halo: L.polyline([], withRenderer(haloOptions)).addTo(map),
        glow: L.polyline([], withRenderer(glowOptions)).addTo(map),
        line: L.polyline([], withRenderer(lineOptions)).addTo(map),
      };
    }

    const layers = layersRef.current;
    layers.halo.setStyle(withRenderer(haloOptions));
    layers.glow.setStyle(withRenderer(glowOptions));
    layers.line.setStyle(withRenderer(lineOptions));

    if (positions.length <= 1) {
      if (lastPositionsRef.current !== null) {
        layers.halo.setLatLngs([]);
        layers.glow.setLatLngs([]);
        layers.line.setLatLngs([]);
      }
      lastPositionsRef.current = null;
      lastRouteKeyRef.current = routeKey;
      return;
    }

    if (lastRouteKeyRef.current === routeKey && lastPositionsRef.current === positions) return;

    layers.halo.setLatLngs(positions);
    layers.glow.setLatLngs(positions);
    layers.line.setLatLngs(positions);
    lastRouteKeyRef.current = routeKey;
    lastPositionsRef.current = positions;
  }, [glowOptions, haloOptions, lineOptions, map, positions, routeKey]);

  return null;
}

export default function BusMap({ 
  vehicles, 
  onVehicleClick, 
  selectedVehicleId, 
  selectedVehicle: selectedVehicleOverride,
  stopsData, 
  themeColor = '#00A3A2', 
  refreshInterval = 5000,
  forcedCenter = null,
  onCenterComplete,
  highlightedStopId,
  onStopClick,
  onMapClick,
  onViewportChange,
}: BusMapProps) {
  const [initMapState, setInitMapState] = useState<{center: [number, number], zoom: number} | null>(() => {
    try {
      if (typeof window !== 'undefined') {
         const saved = localStorage.getItem('mks_map_state');
         if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.center && parsed.zoom) {
               return { center: [parsed.center.lat, parsed.center.lng], zoom: parsed.zoom };
            }
         }
      }
    } catch (err) {}
    return { center: [50.0412, 21.9991], zoom: 13 };
  });
  const [initialMarkersReady, setInitialMarkersReady] = useState(false);
  const canUseCachedTiles = useCachedMapTiles();
  const tileLayerUrl = canUseCachedTiles
    ? '/mks-map-tile/google/{z}/{x}/{y}.png?lyrs=m&hl=pl&gl=PL'
    : 'https://mt1.google.com/vt/lyrs=m&hl=pl&gl=PL&x={x}&y={y}&z={z}';

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const handleInitialMarkersReady = useCallback(() => {
    setInitialMarkersReady(true);
  }, []);

  useEffect(() => {
    if (initialMarkersReady) return;
    const timer = window.setTimeout(() => {
      setInitialMarkersReady(true);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [initialMarkersReady]);

  const handleInteraction = useCallback((active: boolean) => {
    if (mapContainerRef.current) {
      if (active) {
        mapContainerRef.current.classList.add('is-map-moving');
      } else {
        mapContainerRef.current.classList.remove('is-map-moving');
      }
    }
  }, []);

  const selectedVehicle = selectedVehicleOverride || vehicles.find(v => v.id === selectedVehicleId);
  const [snappedRoute, setSnappedRoute] = useState<[number, number][]>([]);
  const refinedRouteCacheRef = useRef(new Map<string, [number, number][]>());
  const refinedRouteByVehicleRef = useRef(new Map<string, [number, number][]>());
  const selectedVehicleIdentityRef = useRef<string>('');
  const routeAbortRef = useRef<AbortController | null>(null);
  const activeRouteRequestIdRef = useRef(0);
  const routeStopsSource = useMemo(() => {
    const routeStops = selectedVehicle?.routeStops || [];
    if (routeStops.length > 0) return routeStops;
    return selectedVehicle?.schedule || [];
  }, [selectedVehicle?.routeStops, selectedVehicle?.schedule]);
  const routeStopsData = useMemo(() => {
    const next: Record<string, StopData> = { ...(stopsData || {}) };
    for (const stop of routeStopsSource) {
      if (Number.isFinite(stop.lat) && Number.isFinite(stop.lon)) {
        next[String(stop.id)] = {
          n: formatPublicStopName({
            name: stop.name || '',
            lat: Number(stop.lat),
            lon: Number(stop.lon),
            sourceProviderIds: selectedVehicle?.provider === 'marcel' ? ['marcel'] : [selectedVehicle?.provider || 'pks'],
          }),
          lat: Number(stop.lat),
          lon: Number(stop.lon),
        };
      }
    }
    return next;
  }, [routeStopsSource, stopsData]);
  const routeStopIds = useMemo(() => {
    const fullRoute = selectedVehicle?.routePath?.filter((id) => Number.isFinite(Number(id))) || [];
    if (fullRoute.length > 0) return dedupeStableStopIds(fullRoute);
    const routeStops = (selectedVehicle?.routeStops || []).map((s: any) => s.id);
    if (routeStops.length > 0) return dedupeStableStopIds(routeStops);
    return dedupeStableStopIds((selectedVehicle?.schedule || []).map((s: any) => s.id));
  }, [selectedVehicle]);
  const visibleRouteStopIds = useMemo(() => {
    const scheduleIds = (selectedVehicle?.schedule || [])
      .filter((stop: any) => !stop?.isPast)
      .map((stop: any) => stop.id)
      .filter((id: unknown) => Number.isFinite(Number(id)));
    if (scheduleIds.length > 0) return dedupeStableStopIds(scheduleIds);

    const futureRouteStopIds = (selectedVehicle?.routeStops || [])
      .filter((stop: any) => !stop?.isPast)
      .map((stop: any) => stop.id)
      .filter((id: unknown) => Number.isFinite(Number(id)));
    return futureRouteStopIds.length > 0 ? dedupeStableStopIds(futureRouteStopIds) : [];
  }, [selectedVehicle?.routeStops, selectedVehicle?.schedule]);
  const visibleRouteStopIdsKey = useMemo(() => visibleRouteStopIds.join(','), [visibleRouteStopIds]);
  const routeGeometryStops = useMemo<RouteGeometryStop[]>(() => {
    const next: RouteGeometryStop[] = [];
    for (let index = 0; index < routeStopIds.length; index += 1) {
      const stopId = routeStopIds[index];
      const stop = routeStopsData[String(stopId)];
      if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
      next.push({
        id: stopId,
        name: stop.n,
        lat: Number(stop.lat),
        lon: Number(stop.lon),
        sequence: index,
      });
    }
    return next;
  }, [routeStopIds, routeStopsData]);
  const routeStopsHash = useMemo(() => hashRouteGeometryStops(routeGeometryStops), [routeGeometryStops]);
  const routeShapeHash = useMemo(() => {
    const points = selectedVehicle?.routeShape || [];
    if (points.length <= 1) return '';
    return stableRouteHash(
      points
        .filter((point) => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map(([lat, lon]) => `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`)
        .join('|'),
    );
  }, [selectedVehicle?.routeShape]);
  const selectedRouteColor = getVehicleColor(selectedVehicle);
  const routeHaloOpts = useMemo(() => ({ pane: 'routeLinePane', color: '#f8fafc', weight: 11, opacity: 0.5, lineCap: 'round', lineJoin: 'round', noClip: false, smoothFactor: 0 }) as L.PolylineOptions, []);
  const routeGlowOpts = useMemo(() => ({ pane: 'routeLinePane', color: '#020617', weight: 7.5, opacity: 0.58, lineCap: 'round', lineJoin: 'round', noClip: false, smoothFactor: 0 }) as L.PolylineOptions, []);
  const routePolylineOpts = useMemo(() => ({ pane: 'routeLinePane', color: selectedRouteColor, weight: 5.5, opacity: 0.98, lineCap: 'round', lineJoin: 'round', noClip: false, smoothFactor: 0 }) as L.PolylineOptions, [selectedRouteColor]);
  const routeLine = normalizeRouteCachePart(selectedVehicle?.routeShortName || selectedVehicle?.routeId || selectedVehicle?.name || '');
  const routeDirection = normalizeRouteCachePart(
    selectedVehicle?.direction ||
    routeGeometryStops[routeGeometryStops.length - 1]?.name ||
    selectedVehicle?.routeId ||
    '',
  );
  const routeMode = selectedVehicle?.provider === 'pkp_intercity' ? 'rail' : 'road';
  const routeGeometryVersion = routeMode === 'rail' ? RAIL_ROUTE_GEOMETRY_CACHE_VERSION : ROAD_ROUTE_GEOMETRY_CACHE_VERSION;
  // Persistent cache identity is the route variant, not the live vehicle.
  const routeKey = selectedVehicle
    ? [
        routeMode,
        normalizeRouteCachePart(selectedVehicle.provider || 'pks'),
        routeLine,
        routeDirection,
        routeStopsHash,
      ].join(':')
    : '';

  useEffect(() => {
    activeRouteRequestIdRef.current += 1;
    const requestId = activeRouteRequestIdRef.current;
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;

    if (!selectedVehicle) {
      startTransition(() => setSnappedRoute([]));
      selectedVehicleIdentityRef.current = '';
      return;
    }

    const currentIdentity = `${selectedVehicle.provider || 'pks'}:${selectedVehicle.id}`;
    if (selectedVehicleIdentityRef.current && selectedVehicleIdentityRef.current !== currentIdentity) {
      startTransition(() => setSnappedRoute([]));
    }
    selectedVehicleIdentityRef.current = currentIdentity;

    if (routeGeometryStops.length < 2) {
      startTransition(() => setSnappedRoute([]));
      return;
    }

    const memoryRoute = routeShapeHash ? undefined : refinedRouteCacheRef.current.get(routeKey);
    if (memoryRoute && isCompleteRouteGeometry(memoryRoute, routeGeometryStops)) {
      setSnappedRoute(memoryRoute);
      refinedRouteByVehicleRef.current.set(currentIdentity, memoryRoute);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    routeAbortRef.current = controller;

    const loadRoute = async () => {
      const apiRoute = Array.isArray(selectedVehicle.routeShape)
        ? selectedVehicle.routeShape.filter((point): point is [number, number] =>
            Array.isArray(point) &&
            point.length === 2 &&
            Number.isFinite(point[0]) &&
            Number.isFinite(point[1]),
          )
        : [];
      if (await isCompleteRouteGeometryAsync(apiRoute, routeGeometryStops)) {
        const refinedApiRoute = simplifyRouteForPaint(apiRoute);
        refinedRouteCacheRef.current.set(routeKey, refinedApiRoute);
        refinedRouteByVehicleRef.current.set(currentIdentity, refinedApiRoute);
        writePersistentRouteGeometry(routeKey, refinedApiRoute, routeGeometryVersion);
        startTransition(() => setSnappedRoute(refinedApiRoute));
        return;
      }

      const localRoute = await readPersistentRouteGeometry(routeKey, routeGeometryVersion);
      if (cancelled || requestId !== activeRouteRequestIdRef.current || controller.signal.aborted) return;
      if (await isCompleteRouteGeometryAsync(localRoute, routeGeometryStops)) {
        const refinedLocalRoute = simplifyRouteForPaint(localRoute);
        refinedRouteCacheRef.current.set(routeKey, refinedLocalRoute);
        refinedRouteByVehicleRef.current.set(currentIdentity, refinedLocalRoute);
        setSnappedRoute(refinedLocalRoute);
        return;
      }

      const officialRoute = routeMode === 'road'
        ? await fetchRouteShapeClient(
            String(
              selectedVehicle.tripId ||
              selectedVehicle.journeyId ||
              selectedVehicle.serviceId ||
              selectedVehicle.routeId ||
              '',
            ),
            routeStopIds,
            routeStopsData,
            {
              refineTimeoutMs: 900,
              disableSyntheticFallback: true,
              strictShortSegments: selectedVehicle.provider === 'mpk_rzeszow',
              startPoint: [selectedVehicle.lat, selectedVehicle.lon],
            },
          ).catch(() => [])
        : [];
      if (cancelled || requestId !== activeRouteRequestIdRef.current || controller.signal.aborted) return;
      if (await isCompleteRouteGeometryAsync(officialRoute, routeGeometryStops)) {
        const refinedOfficialRoute = simplifyRouteForPaint(officialRoute);
        refinedRouteCacheRef.current.set(routeKey, refinedOfficialRoute);
        refinedRouteByVehicleRef.current.set(currentIdentity, refinedOfficialRoute);
        writePersistentRouteGeometry(routeKey, refinedOfficialRoute, routeGeometryVersion);
        startTransition(() => setSnappedRoute(refinedOfficialRoute));
        return;
      }

      const response = await fetchRouteGeometryClient({
        carrier: selectedVehicle.provider || 'pks',
        line: selectedVehicle.routeShortName || selectedVehicle.routeId || selectedVehicle.name || 'unknown',
        direction: selectedVehicle.direction || routeGeometryStops[routeGeometryStops.length - 1]?.name || 'unknown',
        variant: String(
          selectedVehicle.tripId ||
          selectedVehicle.journeyId ||
          selectedVehicle.serviceId ||
          selectedVehicle.brigadeName ||
          selectedVehicle.routeId ||
          'default',
        ),
        dataVersion: routeGeometryVersion,
        mode: routeMode,
        stops: routeGeometryStops,
      }, { signal: controller.signal });
      if (cancelled || requestId !== activeRouteRequestIdRef.current || controller.signal.aborted) return;
        const points = (response.geometry?.coordinates || [])
          .map(([lon, lat]) => [lat, lon] as [number, number])
          .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
        if (await isCompleteRouteGeometryAsync(points, routeGeometryStops)) {
          const refinedRoute = simplifyRouteForPaint(points);
          refinedRouteCacheRef.current.set(routeKey, refinedRoute);
          if (response.cacheKey) refinedRouteCacheRef.current.set(response.cacheKey, refinedRoute);
          refinedRouteByVehicleRef.current.set(currentIdentity, refinedRoute);
          writePersistentRouteGeometry(routeKey, refinedRoute, routeGeometryVersion);
          if (response.cacheKey && response.cacheKey !== routeKey) {
            writePersistentRouteGeometry(response.cacheKey, refinedRoute, routeGeometryVersion);
          }
          if (refinedRouteCacheRef.current.size > 600) {
            const firstKey = refinedRouteCacheRef.current.keys().next().value;
            if (firstKey) refinedRouteCacheRef.current.delete(firstKey);
          }
          if (refinedRouteByVehicleRef.current.size > 800) {
            const firstVehicleKey = refinedRouteByVehicleRef.current.keys().next().value;
            if (firstVehicleKey) refinedRouteByVehicleRef.current.delete(firstVehicleKey);
          }
          startTransition(() => setSnappedRoute(refinedRoute));
          return;
        }
    };

    loadRoute().catch((error) => {
      if ((error as any)?.name === 'AbortError') return;
      if (requestId !== activeRouteRequestIdRef.current || controller.signal.aborted) return;
      // Keep the last good rendered route when a transient network/backend error happens.
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [routeKey, routeStopsHash, routeShapeHash, selectedVehicle?.provider, selectedVehicle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!initMapState) return null;

  return (
    <div ref={mapContainerRef} className={`h-full w-full relative z-0 style-map ${vehicles.length > 35 ? 'is-high-volume' : ''}`}>
      <style>{`
        /* Hide zoom controls on mobile */
        @media (max-width: 768px) {
          .leaflet-control-zoom {
            display: none !important;
          }
        }
        
        /* 
           SMOOTH MOVEMENT:
           Interpolate position over the polling interval.
        */
        .mks-bus-marker {
          transition: transform ${Math.max(1, (refreshInterval / 1000) - 1)}s linear, opacity 0.5s ease-out;
          will-change: transform;
        }

        .mks-marker-inner {
          transform-origin: center bottom;
          transition: transform 0.18s ease, filter 0.18s ease;
        }

        .mks-bus-marker:hover .mks-marker-inner {
          transform: scale(1.08);
          filter: saturate(1.08);
        }

        @keyframes mksLivePulse {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(255,255,255,0.08)); }
          50% { filter: drop-shadow(0 0 10px rgba(255,255,255,0.18)); }
        }

        .mks-live-bus-body {
          animation: mksLivePulse 3.8s ease-in-out infinite;
        }

        .is-high-volume .mks-bus-marker {
          transition: none !important;
          will-change: auto;
        }

        .is-high-volume .mks-marker-inner {
          transition: none !important;
        }

        .is-high-volume .mks-live-bus-body {
          animation: none !important;
        }

        .is-high-volume .mks-route-stop-marker {
          filter: drop-shadow(0 0 5px rgba(255,255,255,0.5)) drop-shadow(0 2px 5px rgba(0,0,0,0.5));
        }
        
        /* Disable transition during ANY map interaction to prevent jitter */
        .is-map-moving .mks-bus-marker,
        .leaflet-zoom-anim .mks-bus-marker,
        .leaflet-drag-anim .mks-bus-marker,
        .leaflet-zoom-animated .mks-bus-marker,
        .mks-bus-marker.leaflet-zoom-animated {
          transition: none !important;
          transition-duration: 0s !important;
        }

        .mks-route-stop-marker {
          filter: drop-shadow(0 0 7px rgba(255,255,255,0.62)) drop-shadow(0 2px 6px rgba(0,0,0,0.5));
        }
      `}</style>
      <MapContainer
        center={initMapState.center}
        zoom={initMapState.zoom}
        scrollWheelZoom={true}
        preferCanvas={true}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <MapStateTracker onInteraction={handleInteraction} onViewportChange={onViewportChange} />
        <MapClickListener onClick={onMapClick} />
        <MapCenterer center={forcedCenter} onComplete={onCenterComplete} />
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution='Map tiles by Google'
          url={tileLayerUrl}
          maxZoom={19}
        />

        {/* Highlighted Selected Stop */}
        {highlightedStopId && routeStopsData[highlightedStopId] && (
          <Marker 
            position={[routeStopsData[highlightedStopId].lat, routeStopsData[highlightedStopId].lon]}
            zIndexOffset={5000}
            icon={L.divIcon({
               className: 'stop-highlight-pin',
               html: `
                 <div class="relative flex flex-col items-center">
                       <div class="w-8 h-8 bg-white rounded-full shadow-xl flex items-center justify-center border-[3px]" style="border-color: ${selectedRouteColor}">
                       <div class="w-3 h-3 rounded-full animate-ping absolute" style="background-color: ${selectedRouteColor}"></div>
                       <div class="w-4 h-4 rounded-full z-10" style="background-color: ${selectedRouteColor}"></div>
                    </div>
                    <div class="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] -mt-1 shadow-xl" style="border-t-color: ${selectedRouteColor}"></div>
                 </div>
               `,
               iconSize: [32, 42],
               iconAnchor: [16, 42],
            })}
          />
        )}

        {/* Draw Route Line */}
        <Pane name="routeLinePane" style={{ zIndex: 430 }}>
          <RouteLineLayer
            routeKey={`${selectedVehicleId || ''}:${routeKey}`}
            positions={snappedRoute}
            haloOptions={routeHaloOpts}
            glowOptions={routeGlowOpts}
            lineOptions={routePolylineOpts}
          />
        </Pane>

        {/* Draw Route Stops */}
        <Pane name="routeStopsPane" style={{ zIndex: 470 }}>
          {selectedVehicle && (
            <RouteStopsLayer
              selectedVehicle={selectedVehicle}
              stopsData={routeStopsData}
              stopIds={visibleRouteStopIds}
              highlightedStopId={highlightedStopId}
              selectedRouteColor={selectedRouteColor}
              onStopClick={onStopClick}
            />
          )}
        </Pane>

        <VehicleMarkerLayer
          vehicles={vehicles}
          selectedVehicleId={selectedVehicleId}
          themeColor={themeColor}
          refreshInterval={refreshInterval}
          onVehicleClick={onVehicleClick}
          onInitialMarkersReady={handleInitialMarkersReady}
        />
      </MapContainer>
      {!initialMarkersReady && (
        <div className="pks-map-loading-screen pointer-events-none absolute inset-0 z-[1200] flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="pks-map-loading-spinner h-10 w-10 rounded-full border-4 animate-spin"></div>
            <p className="pks-map-loading-label text-sm font-black tracking-tight">Trwa wczytywanie mapy...</p>
          </div>
        </div>
      )}
    </div>
  );
}
