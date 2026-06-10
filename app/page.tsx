'use client';

import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import dynamic from 'next/dynamic';
import { Capacitor } from '@capacitor/core';
import { Bus, Search, RefreshCw, X, Clock, Navigation, MapPin, Map as MapIcon, Settings, Eye, Palette, Monitor, Sun, Moon, Sparkles, CloudOff, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Vehicle } from '@/components/BusMap';
import type { TransportOption } from '@/components/TransportSelectorPanel';
import type { Stop as StopsPanelStop } from '@/Panel/src/types';
import {
  fetchDeparturesClient,
  fetchMarcelCoursesClient,
  fetchMarcelPublicCourseStopsClient,
  fetchMarcelRoutesClient,
  fetchMpkRzeszowDeparturesClient,
  fetchStopsClient,
  fetchVehicleDetailsClient,
  fetchVehiclesClient,
  type PkpQueryViewport,
  type TransportProviderId,
} from '@/lib/pks-client';
import { useFirebase } from '@/components/FirebaseProvider';
import { canAccessAdminDashboard } from '@/lib/admin/rbac';
import { formatPublicStopName } from '@/lib/stop-display';
import StopsPanel from '@/components/stops-panel/StopsPanel';

const PKS_COLOR = '#14b8a6';
const MPK_RZESZOW_COLOR = '#ff7a00';
const MARCEL_COLOR = '#68c44a';
const PKP_INTERCITY_COLOR = '#1d4ed8';
const VEHICLES_CACHE_KEY = 'pks-live:last-vehicles:v2';

function readCachedVehicles(): Vehicle[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(VEHICLES_CACHE_KEY) || 'null') as { savedAt?: number; vehicles?: Vehicle[] } | null;
    if (!parsed?.vehicles?.length || !parsed.savedAt) return [];
    if (Date.now() - parsed.savedAt > 3 * 60_000) return [];
    return parsed.vehicles.filter((vehicle) => Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon));
  } catch {
    return [];
  }
}

function writeCachedVehicles(vehicles: Vehicle[]) {
  if (typeof window === 'undefined' || vehicles.length === 0) return;
  scheduleClientIdle(() => {
    try {
      localStorage.setItem(VEHICLES_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        vehicles: vehicles.slice(0, 350),
      }));
    } catch {
      // Cache is only a startup accelerator.
    }
  }, 1800);
}

function scheduleClientIdle(callback: () => void, timeout = 900) {
  if (typeof window === 'undefined') return () => {};
  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(() => callback(), { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(callback, 120);
  return () => window.clearTimeout(id);
}

function scheduleAfterFirstPaint(callback: () => void, delayMs = 0) {
  if (typeof window === 'undefined') return () => {};
  let timeoutId: number | null = null;
  let rafId = window.requestAnimationFrame(() => {
    rafId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(callback, delayMs);
    });
  });

  return () => {
    window.cancelAnimationFrame(rafId);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
}

const BusMap = dynamic(() => import('@/components/BusMap'), {
  ssr: false,
  loading: () => (
    <div className="pks-map-loading-screen h-full w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="pks-map-loading-spinner h-10 w-10 rounded-full border-4 animate-spin"></div>
        <p className="pks-map-loading-label text-sm font-black tracking-tight">Trwa wczytywanie mapy...</p>
      </div>
    </div>
  ),
});

const TransportSelectorPanel = dynamic(() => import('@/components/TransportSelectorPanel'), {
  ssr: false,
});

const TrainDetailsPanel = dynamic(() => import('@/components/TrainDetailsPanel'), {
  ssr: false,
});

const AdminDashboard = dynamic(() => import('@/app/admin/AdminDashboard'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-[#040609] flex items-center justify-center text-slate-400 text-sm font-medium">
      Ładowanie panelu administratora…
    </div>
  ),
});

function StopTabIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M11 7.5h11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M11 14h11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M11 20.5h11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6 7.5h.01M6 14h.01M6 20.5h.01" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

const normalizeVehicleText = (value?: string | null) =>
  String(value || '')
    .replace(/\[Brak sygna\?u\]/g, '[Brak sygna\u0142u]')
    .replace(/\[Brak sygna\u0142u\]/g, '[Brak sygna\u0142u]')
    .replace(/Post\?j/g, 'Post\u00f3j')
    .replace(/Post\u00f3j/g, 'Post\u00f3j')
    .replace(/ostatni\? pozycj\?/gi, 'ostatni\u0105 pozycj\u0119');

const parseJourneyMs = (raw: unknown): number => {
  const value = String(raw || '').trim();
  if (!value) return NaN;
  const normalized = value.replace(' ', 'T');
  const parsed = new Date(normalized).getTime();
  if (Number.isFinite(parsed)) return parsed;

  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!timeOnly) return NaN;
  const now = new Date();
  now.setHours(Number(timeOnly[1]), Number(timeOnly[2]), Number(timeOnly[3] || '0'), 0);
  return now.getTime();
};

const selectedWarsawDateIso = (dayOffset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' });
};

const parseTimeOnWarsawDate = (dateIso: string, timeValue: unknown) => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeValue || '').trim());
  if (!match) return Number.NaN;
  const date = new Date(`${dateIso}T00:00:00`);
  date.setHours(Number(match[1]), Number(match[2]), Number(match[3] || '0'), 0);
  return date.getTime();
};

const parseMpkRealtimeOnWarsawDate = (dateIso: string, value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const direct = new Date(raw.replace(' ', 'T')).getTime();
  if (Number.isFinite(direct)) return direct;
  return parseTimeOnWarsawDate(dateIso, raw);
};

const normalizeStopKey = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[-/]\s*/g, ' ')
    .replace(/\b(?:rzeszow|przystanek|przyst|autobusowy|autobusowa)\b/g, ' ')
    .replace(/\b\d{1,3}[a-z]?\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePreciseStopKey = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\(\d+[a-z]?\)\s*/i, '')
    .replace(/\s*\((?:\+|-|\/|\s)+\)\s*$/g, '')
    .replace(/\s*[-/]\s*/g, ' ')
    .replace(/\b(?:rzeszow|przystanek|przyst|autobusowy|autobusowa)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const marcelCourseStopKeys = (stop: { nazMi?: unknown; nazPr?: unknown }) =>
  [
    normalizePreciseStopKey([stop.nazMi, stop.nazPr].filter(Boolean).join(' ')),
    normalizePreciseStopKey(stop.nazPr),
    normalizeStopKey([stop.nazMi, stop.nazPr].filter(Boolean).join(' ')),
  ].filter(Boolean);

const mapMpkDepartureToJourney = (entry: Record<string, unknown>, dateIso: string, index: number) => {
  const plannedMs = parseTimeOnWarsawDate(dateIso, entry.departure_time);
  const realMs = parseMpkRealtimeOnWarsawDate(
    dateIso,
    entry.real_departure_time || entry.realDeparture || entry.real || entry.estimated_departure_time,
  );
  const rawDelayMinutes = Number(entry.deviation ?? entry.delayMinutes);
  const deviation = Number.isFinite(plannedMs) && Number.isFinite(realMs)
    ? Math.round((realMs - plannedMs) / 60_000)
    : Number.isFinite(rawDelayMinutes)
      ? rawDelayMinutes
      : undefined;
  return {
    line_name: String(entry.line || '').trim(),
    route_description: String(entry.trip_headsign || entry.end_stop_name || 'Nieznany kierunek').trim(),
    timetable_time: Number.isFinite(plannedMs) ? new Date(plannedMs).toISOString() : `${dateIso}T${entry.departure_time || '00:00'}`,
    real_departure_time: Number.isFinite(realMs) ? new Date(realMs).toISOString() : undefined,
    deviation,
    vehicle_id: entry.vehicle || entry.vehicle_number,
    provider_id: 'mpk_rzeszow',
    trip_id: entry.trip_id || entry.block_id || `mpk-${index}`,
  };
};

const mapMarcelDepartureToJourney = (
  course: Record<string, unknown>,
  stop: Record<string, unknown>,
  dateIso: string,
  index: number,
) => {
  const plannedMs = parseTimeOnWarsawDate(dateIso, stop.godz || course.godz);
  const rawDirection = String(course.nazTr || stop.nazTr || 'Marcel').trim();
  const parts = rawDirection.split(/\s*(?:-|>)\s*/).map((part) => part.trim()).filter(Boolean);
  return {
    line_name: 'M',
    route_description: parts.length >= 2 ? parts[parts.length - 1] : rawDirection,
    timetable_time: Number.isFinite(plannedMs) ? new Date(plannedMs).toISOString() : `${dateIso}T${stop.godz || course.godz || '00:00'}`,
    provider_id: 'marcel',
    trip_id: course.idKu || `marcel-${index}`,
  };
};

const formatGpsSignalClock = (value?: string | null) => {
  const ms = parseJourneyMs(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
};

const isScheduleStopUpcoming = (
  stop: Pick<NonNullable<Vehicle['schedule']>[number], 'planned' | 'real' | 'isPast'> | null | undefined,
  nowMs: number,
) => {
  if (!stop) return false;
  if (stop.isPast) return false;
  const timeRaw = String(stop.real || stop.planned || '').trim();
  if (!timeRaw) return true;
  const timeMs = parseJourneyMs(timeRaw);
  if (!Number.isFinite(timeMs)) return true;
  return timeMs >= nowMs - 30 * 1000;
};

const hasUsableRouteDetails = (vehicle?: Vehicle | null) => {
  if (!vehicle) return false;
  if ((vehicle.routePath?.length || 0) > 1) return true;
  if ((vehicle.routeStops?.length || 0) > 1) return true;
  if ((vehicle.schedule?.length || 0) > 1) return true;
  if ((vehicle.routeShape?.length || 0) > 1) return true;
  return false;
};

const vehicleStableKey = (vehicle: Pick<Vehicle, 'id' | 'provider'>) => `${vehicle.provider || 'pks'}:${vehicle.id}`;

const vehicleListSignature = (vehicles: Vehicle[]) => vehicles
  .map((vehicle) => [
    vehicle.provider || 'pks',
    vehicle.id,
    Number(vehicle.lat).toFixed(5),
    Number(vehicle.lon).toFixed(5),
    Math.trunc(Number(vehicle.delay || 0) / 60),
    Math.trunc(Number(vehicle.dataAgeSec || 0) / 15),
    vehicle.status || '',
    vehicle.routeShortName || vehicle.routeId || '',
    vehicle.schedule?.length || 0,
    vehicle.routeStops?.length || 0,
  ].join(':'))
  .join('|');

const chooseRicherList = <T,>(incoming?: T[], previous?: T[]) => {
  const next = incoming || [];
  const old = previous || [];
  return next.length >= old.length || old.length <= 1 ? next : old;
};

const mergeLiveVehicleSnapshot = (incoming: Vehicle, previous?: Vehicle | null): Vehicle => {
  if (!previous) return incoming;
  const incomingSpeed = Number(incoming.speed);
  const previousSpeed = Number(previous.speed);
  const incomingAge = Number(incoming.dataAgeSec);
  const previousAge = Number(previous.dataAgeSec);
  const shouldKeepPreviousSpeed =
    incoming.status !== 'break' &&
    incoming.status !== 'inactive' &&
    Number.isFinite(previousSpeed) &&
    previousSpeed > 1 &&
    (!Number.isFinite(incomingSpeed) || incomingSpeed <= 1) &&
    (!Number.isFinite(incomingAge) || incomingAge <= 90) &&
    (!Number.isFinite(previousAge) || previousAge <= 180);

  return {
    ...previous,
    ...incoming,
    speed: shouldKeepPreviousSpeed ? previousSpeed : incoming.speed,
    computedSpeed: shouldKeepPreviousSpeed ? previous.computedSpeed : incoming.computedSpeed,
    schedule: chooseRicherList(incoming.schedule, previous.schedule),
    routeStops: chooseRicherList(incoming.routeStops, previous.routeStops),
    routePath: chooseRicherList(incoming.routePath, previous.routePath),
    routeShape: chooseRicherList(incoming.routeShape, previous.routeShape),
    model: incoming.model || previous.model,
    vehicleNumber: incoming.vehicleNumber || previous.vehicleNumber,
    journeyId: incoming.journeyId ?? previous.journeyId,
    serviceId: incoming.serviceId ?? previous.serviceId,
    tripId: incoming.tripId ?? previous.tripId,
    brigadeName: incoming.brigadeName ?? previous.brigadeName,
  };
};

const vehicleRouteDetailsCacheKey = (vehicle: Vehicle, provider: TransportProviderId, includeInactive: boolean) => {
  const routeIdentity = String(
    vehicle.journeyId ??
    vehicle.tripId ??
    vehicle.serviceId ??
    vehicle.routeId ??
    vehicle.direction ??
    vehicle.routeShortName ??
    'current',
  ).trim();
  return [provider, vehicle.id, routeIdentity || 'current', includeInactive ? 'inactive' : 'active'].join(':');
};

const withAlpha = (hex: string, alpha: number) => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `#${clean}${value}`;
};

const DEFAULT_ACTIVE_PROVIDERS: TransportProviderId[] = ['pks'];
const AVAILABLE_TRANSPORT_PROVIDERS = new Set<TransportProviderId>(['pks', 'mpk_rzeszow', 'marcel']);
const PKP_INTERCITY_REFRESH_MS = 60_000;
const NETWORK_REACHABILITY_URL = 'https://www.gstatic.com/generate_204';

async function hasInternetReachability(timeoutMs = 2500) {
  if (typeof window === 'undefined') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${NETWORK_REACHABILITY_URL}?ts=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

const sanitizeProvidersWithVisibility = (
  providers: TransportProviderId[],
  hiddenProviders: Set<TransportProviderId>,
) => {
  const unique = providers
    .filter((providerId, index, values) => values.indexOf(providerId) === index)
    .filter((providerId) => AVAILABLE_TRANSPORT_PROVIDERS.has(providerId))
    .filter((providerId) => !hiddenProviders.has(providerId));
  return unique;
};

const readStoredTransportProviders = (): TransportProviderId[] => {
  if (typeof window === 'undefined') return DEFAULT_ACTIVE_PROVIDERS;
  try {
    const parsed = JSON.parse(localStorage.getItem('mks_transport_providers') || 'null');
    if (!Array.isArray(parsed)) return DEFAULT_ACTIVE_PROVIDERS;
    const storedProviders = parsed.filter(
      (provider): provider is TransportProviderId =>
        typeof provider === 'string' && AVAILABLE_TRANSPORT_PROVIDERS.has(provider as TransportProviderId),
    );
    return storedProviders;
  } catch {
    return DEFAULT_ACTIVE_PROVIDERS;
  }
};

const sameTransportProviders = (left: TransportProviderId[], right: TransportProviderId[]) => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((provider) => rightSet.has(provider));
};

const VEHICLE_PROVIDER_STALE_GRACE_MS = 90_000;

const getVehicleDisplayNumber = (vehicle?: Pick<Vehicle, 'vehicleNumber' | 'id' | 'provider' | 'routeShortName'> | null) => {
  if (vehicle?.provider === 'pkp_intercity') {
    const rawNumber = String(vehicle.vehicleNumber || '').trim();
    const category = String(vehicle.routeShortName || '').trim().toUpperCase();
    if (!rawNumber) return '';
    if (category && rawNumber.toUpperCase().startsWith(`${category} `)) return rawNumber;
    return category ? `${category} ${rawNumber}` : rawNumber;
  }
  if (vehicle?.provider === 'marcel') return String(vehicle.vehicleNumber || '').trim();
  return String(vehicle?.vehicleNumber || vehicle?.id || '').replace(/^(mpk_rzeszow|marcel)_/, '');
};

const normalizeMapFilterValue = (value?: string | number | null) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^mks\s+/, '')
    .replace(/\s+/g, '');

const matchesMapVehicleFilter = (vehicle: Vehicle, rawFilter: string) => {
  const query = normalizeMapFilterValue(rawFilter);
  if (!query) return true;

  const lineValues = [
    vehicle.routeShortName,
    vehicle.routeId,
    (vehicle as any).line,
  ].map(normalizeMapFilterValue).filter(Boolean);

  if (lineValues.some((line) => line === query)) return true;

  const isShortLineQuery = /^[a-z0-9]{1,3}$/i.test(query);
  if (isShortLineQuery) return false;

  return [
    ...lineValues,
    vehicle.id,
    getVehicleDisplayNumber(vehicle),
  ].map(normalizeMapFilterValue).some((value) => value.includes(query));
};

export default function Home() {
  const { device, loading, hiddenProviderIds } = useFirebase();
  const isOwnerDevice = device?.role === 'owner';
  const hiddenProvidersSet = useMemo(
    () => new Set(
      (isOwnerDevice ? [] : hiddenProviderIds)
        .filter((providerId): providerId is TransportProviderId => AVAILABLE_TRANSPORT_PROVIDERS.has(providerId as TransportProviderId))
        .map((providerId) => providerId as TransportProviderId),
    ),
    [hiddenProviderIds, isOwnerDevice],
  );
  const initialTransportProviders = useMemo(
    () => sanitizeProvidersWithVisibility(readStoredTransportProviders(), hiddenProvidersSet),
    // Read once for the first paint; later hidden-provider changes are handled by effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const lastVehiclesRef = useRef<string>('');
  const lastVehiclesEtagRef = useRef<string>('');
  const activeProvidersRef = useRef<TransportProviderId[]>(initialTransportProviders);
  const vehiclesFetchAbortRef = useRef<AbortController | null>(null);
  const bootstrapCancelRef = useRef<(() => void) | null>(null);
  const lastProviderNonEmptyAtRef = useRef<Map<TransportProviderId, number>>(new Map());
  const vehicleDetailsCacheRef = useRef<Map<string, { vehicle: Vehicle; expiresAt: number }>>(new Map());
  const vehicleDetailsRequestSeqRef = useRef(0);
  const vehiclesRef = useRef<Vehicle[]>([]);
  const lastPkpIntercityFetchAtRef = useRef(0);
  const isAppForegroundRef = useRef<boolean>(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const mapViewportRef = useRef<PkpQueryViewport | null>(null);
  const lastViewportFetchAtRef = useRef(0);

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>(readCachedVehicles);
  const [isLoading, setIsLoading] = useState(true);
  const [appLoadTimedOut, setAppLoadTimedOut] = useState(false);
  const [filterRoute, setFilterRoute] = useState('');
  const [activeProviders, setActiveProviders] = useState<TransportProviderId[]>(initialTransportProviders);
  const [draftProviders, setDraftProviders] = useState<TransportProviderId[]>(initialTransportProviders);
  const [hasLoadedTransportProviders, setHasLoadedTransportProviders] = useState(true);
  const [hasBootstrappedLiveVehicles, setHasBootstrappedLiveVehicles] = useState(false);
  const [isTransportPanelOpen, setIsTransportPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBus, setSelectedBus] = useState<Vehicle | null>(null);
  const [selectedBusDetailsLoading, setSelectedBusDetailsLoading] = useState(false);
  const [isBusPanelExpanded, setIsBusPanelExpanded] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isAppForeground, setIsAppForeground] = useState<boolean>(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  
  // Customization States
  const [themeColor, setThemeColor] = useState('#00A3A2');
  const [showInactive, setShowInactive] = useState(false);
  const [appTheme, setAppTheme] = useState<'system'|'light'|'light-warm'|'dark'|'dark-oled'|'dark-aurora'>(() => {
    if (typeof window === 'undefined') return 'system';
    const raw = (localStorage.getItem('mks_app_theme') || 'system').trim().toLowerCase();
    if (raw === 'amoled' || raw === 'oled' || raw === 'dark_oled' || raw === 'darkoled') return 'dark-oled';
    if (raw === 'light' || raw === 'light-warm' || raw === 'dark' || raw === 'dark-oled' || raw === 'dark-aurora') return raw;
    return 'system';
  });
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  const [transparentUI, setTransparentUI] = useState(true);

  // Stops States
  const [activeTab, setActiveTab] = useState<'map' | 'stops' | 'admin'>('map');
  const canOpenAdminEmbed = Boolean(
    device && canAccessAdminDashboard(device.role, device.permissions),
  );
  const isMapTabDisabled = Boolean(device?.permissions?.disableMap);
  const isStopsTabDisabled = Boolean(device?.permissions?.disableStops) && !isMapTabDisabled;
  useEffect(() => {
    if (activeTab === 'admin' && !canOpenAdminEmbed) setActiveTab('map');
    if (activeTab === 'map' && isMapTabDisabled) setActiveTab('stops');
    if (activeTab === 'stops' && isStopsTabDisabled) setActiveTab('map');
  }, [activeTab, canOpenAdminEmbed, isMapTabDisabled, isStopsTabDisabled]);
  const [stopsList, setStopsList] = useState<{id: string, name: string, areaId?: string, code?: string, lat?: number, lon?: number}[]>([]);
  const [stopsLoadError, setStopsLoadError] = useState(false);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedExternalStop, setSelectedExternalStop] = useState<StopsPanelStop | null>(null);
  const [isStopPanelExpanded, setIsStopPanelExpanded] = useState(true);
  const [stopDepartures, setStopDepartures] = useState<any[]>([]);
  const [isFetchingDepartures, setIsFetchingDepartures] = useState(false);
  const stopDeparturesCacheRef = useRef<Map<string, { savedAt: number; journeys: any[] }>>(new Map());
  const stopDeparturesInFlightRef = useRef<Map<string, Promise<any[]>>>(new Map());
  const stopDeparturesRequestSeqRef = useRef(0);
  const [refreshInterval, setRefreshInterval] = useState(7000);
  const [favsState, setFavsState] = useState<string[]>([]);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [shouldMountMap, setShouldMountMap] = useState(false);
  const [mapVehiclesEnabled, setMapVehiclesEnabled] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setAppLoadTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => setAppLoadTimedOut(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  useEffect(() => {
    if (activeTab !== 'map' || isMapTabDisabled) {
      if (shouldMountMap) setShouldMountMap(false);
      if (mapVehiclesEnabled) setMapVehiclesEnabled(false);
      return;
    }
    if (activeTab !== 'map' || isMapTabDisabled) return;
    if (shouldMountMap) return;
    const cancelPaint = scheduleAfterFirstPaint(() => {
      setShouldMountMap(true);
    });
    return () => {
      cancelPaint();
    };
  }, [activeTab, isMapTabDisabled, mapVehiclesEnabled, shouldMountMap]);

  useEffect(() => {
    if (!shouldMountMap || activeTab !== 'map' || isMapTabDisabled || mapVehiclesEnabled) return;
    setMapVehiclesEnabled(true);
  }, [activeTab, isMapTabDisabled, mapVehiclesEnabled, shouldMountMap]);

  const closeMapPanelsForSearch = useCallback(() => {
    if (selectedBus || selectedStopId) {
      setSelectedBus(null);
      setSelectedStopId(null);
      setSelectedExternalStop(null);
    }
  }, [selectedBus, selectedStopId]);

  useEffect(() => {
    activeProvidersRef.current = activeProviders;
  }, [activeProviders]);
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isSecure = window.location.protocol === 'https:' || isLocalhost;
    if (!isSecure) return;
    const timer = window.setTimeout(() => {
      navigator.serviceWorker
        .register('/mks-map-cache-sw.js', { scope: '/' })
        .catch((error) => console.warn('Map cache service worker unavailable:', error));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    vehiclesRef.current = vehicles;
    writeCachedVehicles(vehicles);
  }, [vehicles]);
  useEffect(() => {
    isAppForegroundRef.current = isAppForeground;
  }, [isAppForeground]);

  const formatScheduleStopName = useCallback((name?: string | null, provider?: TransportProviderId | string | null) => {
    const raw = String(name || '').trim();
    if (!raw) return '';
    if (provider === 'marcel') return raw;
    const normalized = raw.replace(/^Rzesz\S*w\s+D\.A\.\s+st\.\s*0*\d+$/i, 'Rzeszow D.A.');
    return formatPublicStopName({ name: normalized });
  }, []);

  // Handle hardware back button to prevent accidental app exits when viewing a panel
  useEffect(() => {
     if (selectedBus || selectedStopId) {
        window.history.pushState({ panelOpen: true }, '');
     }
  }, [selectedBus, selectedStopId]);

  useEffect(() => {
     const handlePopState = (e: PopStateEvent) => {
        if (isTransportPanelOpen) {
           setIsTransportPanelOpen(false);
           return;
        }
        if (selectedBus || selectedStopId) {
           setSelectedBus(null);
           setSelectedStopId(null);
           setSelectedExternalStop(null);
        }
     };
     window.addEventListener('popstate', handlePopState);
     return () => window.removeEventListener('popstate', handlePopState);
  }, [isTransportPanelOpen, selectedBus, selectedStopId]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let listenerPromise: Promise<{ remove: () => Promise<void> }> | null = null;

    listenerPromise = import('@capacitor/app').then(({ App }) =>
      App.addListener('backButton', () => {
        if (cancelled) return;

        if (isSettingsOpen) {
          setIsSettingsOpen(false);
          return;
        }
        if (isTransportPanelOpen) {
          setIsTransportPanelOpen(false);
          return;
        }
        if (selectedBus) {
          setSelectedBus(null);
          return;
        }
        if (selectedStopId) {
          setSelectedStopId(null);
          setSelectedExternalStop(null);
          return;
        }
        if (activeTab === 'admin') {
          return;
        }
        if (activeTab === 'stops' && !isMapTabDisabled) {
          setActiveTab('map');
          return;
        }

        App.exitApp();
      }),
    );

    return () => {
      cancelled = true;
      listenerPromise?.then((listener) => listener.remove()).catch(() => {});
    };
  }, [activeTab, isMapTabDisabled, isSettingsOpen, isTransportPanelOpen, selectedBus, selectedStopId]);

  useEffect(() => {
    let cancelled = false;
    let nativeListenerPromise: Promise<{ remove: () => Promise<void> }> | null = null;
    let nativeActive = true;

    const updateForeground = () => {
      const visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible';
      if (!cancelled) setIsAppForeground(visible && nativeActive);
    };

    updateForeground();

    const handleVisibilityChange = () => {
      updateForeground();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    if (Capacitor.isNativePlatform()) {
      nativeListenerPromise = import('@capacitor/app').then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          nativeActive = Boolean(isActive);
          updateForeground();
        }),
      );
    }

    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      nativeListenerPromise?.then((listener) => listener.remove()).catch(() => {});
    };
  }, []);

  const toggleFavoriteStop = useCallback((stopId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFavsState((current) => {
      const next = current.includes(stopId) ? current.filter((id) => id !== stopId) : [...current, stopId];
      const persist = () => {
        try {
          localStorage.setItem('mks_fav_stops', JSON.stringify(next));
        } catch {
          // ignore storage quota failures
        }
      };
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as Window & { requestIdleCallback?: (cb: IdleRequestCallback) => number }).requestIdleCallback?.(() => persist());
      } else {
        setTimeout(persist, 0);
      }
      return next;
    });
  }, []);

  const [now, setNow] = useState(0);
  useEffect(() => {
    const initTimer = setTimeout(() => setNow(Date.now()), 0);
    const tickMs = selectedBus?.status === 'break' ? 1000 : 5000;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => {
       clearTimeout(initTimer);
       clearInterval(id);
    };
  }, [selectedBus?.status]);

  const processedDepartures = useMemo(() => {
    if (!stopDepartures || stopDepartures.length === 0) return [];
    const technicalRegex = /(zjazd|zajezd|baza|technicz|serwis|warsztat|przejazd\s+techn|bez\s+pasa[zż]er|manewr|out\s+of\s+service|deadhead|poza\s+lini[aą])/i;
    
    const splitCsv = (value: unknown) =>
      String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    const providerStopIds = selectedExternalStop?.providerStopIds || {};
    const liveStopIds = new Set(
      [
        selectedStopId,
        ...splitCsv(providerStopIds.pks),
        ...splitCsv(providerStopIds.mpk_rzeszow),
      ].filter(Boolean).map(String),
    );
    
    const results = Object.values(stopDepartures.reduce((acc: any, journey: any) => {
        const journeyPlannedMs = parseJourneyMs(journey.timetable_time);
        let actualTimeStr = Number.isFinite(journeyPlannedMs) ? new Date(journeyPlannedMs).toTimeString().substring(0, 5) : '--:--';
        let diffMin = Number.isFinite(journeyPlannedMs) ? Math.floor((journeyPlannedMs - now) / 60000) : Number.POSITIVE_INFINITY;
        let isRealtime = false;
        let vehicleNum = '';
        let isDelayed = false;
        let actualDepTimeMs = journeyPlannedMs;
        const journeyRealMs = parseJourneyMs(journey.real_departure_time || journey.realDeparture || journey.real);
        
        const normLine = (s: any) => String(s || '').trim().toUpperCase().replace(/^MKS\s+/, '');
        const journeyLineNorm = normLine(journey.line_name);
        const directionLabel = String(journey.route_description || journey.direction || journey.destination || '').trim();
        if (technicalRegex.test(journeyLineNorm) || technicalRegex.test(directionLabel)) return acc;
        
        let liveMatch: any = null;
        let stopInfo: any = null;
        let minDiff = Infinity;
        const journeyProvider = String(journey.provider_id || journey.provider || 'pks');
        
        vehicles.forEach(v => {
            const vehicleProvider = String(v.provider || 'pks');
            if (journeyProvider === 'mpk_rzeszow' && vehicleProvider !== 'mpk_rzeszow') return;
            if (journeyProvider === 'pks' && vehicleProvider !== 'pks') return;
            if (v.status === 'break' || v.status === 'inactive' || v.status === 'technical') return;
            if (normLine(v.routeShortName || v.routeId) === journeyLineNorm) {
                const scheduleStops = [...(v.schedule || []), ...(v.routeStops || [])];
                const s = scheduleStops.find((x: any) => liveStopIds.has(String(x.id)) && !x.isPast);
                if (s && s.planned) {
                    const diff = Math.abs(new Date(s.planned).getTime() - journeyPlannedMs);
                    const matchWindow = journeyProvider === 'mpk_rzeszow' ? 30 * 60000 : 10 * 60000;
                    const realMs = s.real ? parseJourneyMs(s.real) : NaN;
                    if (Number.isFinite(realMs) && realMs < now - 30_000) return;
                    if (diff <= matchWindow && diff < minDiff) {
                        minDiff = diff;
                        liveMatch = v;
                        stopInfo = s;
                    }
                }
            }
        });

        if (Number.isFinite(journeyRealMs)) {
            isRealtime = true;
            isDelayed = Math.abs(journeyRealMs - journeyPlannedMs) >= 60_000;
            actualDepTimeMs = journeyRealMs;
            diffMin = Math.floor((actualDepTimeMs - now) / 60000);
            actualTimeStr = new Date(actualDepTimeMs).toTimeString().substring(0, 5);
        } else if (liveMatch) {
            const liveDelaySec = Number(liveMatch.delay);
            const canUseLiveDelay =
              liveMatch.status !== 'break' &&
              liveMatch.status !== 'inactive' &&
              liveMatch.status !== 'technical' &&
              Number.isFinite(liveDelaySec) &&
              Math.abs(liveDelaySec) <= 18000;
            const stopPlannedMs = stopInfo?.planned ? new Date(stopInfo.planned).getTime() : NaN;
            const basePlannedMs = Number.isFinite(stopPlannedMs) ? stopPlannedMs : journeyPlannedMs;
            const realT = stopInfo?.real
              ? new Date((stopInfo.real || '').replace(' ', 'T'))
              : (Number.isFinite(basePlannedMs) && canUseLiveDelay ? new Date(basePlannedMs + liveDelaySec * 1000) : null);
            
            if (realT && !isNaN(realT.getTime())) {
                isRealtime = true;
                isDelayed = Math.abs(realT.getTime() - basePlannedMs) >= 60_000;
                vehicleNum = getVehicleDisplayNumber(liveMatch);
                actualDepTimeMs = realT.getTime();
                diffMin = Math.floor((actualDepTimeMs - now) / 60000);
                actualTimeStr = realT.toTimeString().substring(0, 5);
            }
        } else if (journey.deviation !== null && journey.deviation !== undefined) {
            isRealtime = true;
            isDelayed = !!(Math.abs(journey.deviation) > 1);
            if (!isNaN(journeyPlannedMs)) {
               const realD = new Date(journeyPlannedMs + journey.deviation * 60000);
               actualDepTimeMs = realD.getTime();
               diffMin = Math.floor((actualDepTimeMs - now) / 60000);
               actualTimeStr = realD.toTimeString().substring(0, 5);
            }
        }

        if (!vehicleNum && (journey.vehicle_id || journey.veh_id || journey.vehicle_number)) {
           vehicleNum = journey.vehicle_id || journey.veh_id || journey.vehicle_number;
        }

        if (!Number.isFinite(journeyPlannedMs)) return acc;
        const plannedMinuteBucket = Math.round(journeyPlannedMs / 60000);
        const uniqKey = [
          journeyLineNorm,
          String(journey.route_description || '').trim().toUpperCase(),
          `min:${plannedMinuteBucket}`,
        ].join('|');
        const depDate = new Date(journeyPlannedMs);
        const todayDate = new Date(now);
        const isTomorrow = depDate.getDate() !== todayDate.getDate() || 
                          depDate.getMonth() !== todayDate.getMonth() || 
                          depDate.getFullYear() !== todayDate.getFullYear();
        const dateStr = `${depDate.getDate()}.${(depDate.getMonth() + 1).toString().padStart(2, '0')}`;

        if(!acc[uniqKey]) {
           acc[uniqKey] = {
               bus: {
                   routeShortName: journey.line_name,
                   direction: journey.route_description,
                    id: isRealtime ? 'LIVE' : 'ROZKŁAD',
                   model: liveMatch ? liveMatch.model : null
               },
               providerId: journey.provider_id || journey.provider || 'pks',
                vehicleNum,
               actualTimeStr,
               diffMin,
               isRealtime,
               isTomorrow,
               dateStr,
               isDelayed,
               plannedTimeMs: journeyPlannedMs,
               depTimeMs: Number.isFinite(actualDepTimeMs) ? actualDepTimeMs : journeyPlannedMs
           };
        } else if (liveMatch) {
           acc[uniqKey].isRealtime = true;
           acc[uniqKey].isDelayed = isDelayed;
           acc[uniqKey].actualTimeStr = actualTimeStr;
           acc[uniqKey].diffMin = diffMin;
           acc[uniqKey].isTomorrow = isTomorrow;
           acc[uniqKey].dateStr = dateStr;
           acc[uniqKey].vehicleNum = vehicleNum;
           acc[uniqKey].plannedTimeMs = journeyPlannedMs;
           acc[uniqKey].bus.model = liveMatch.model;
           acc[uniqKey].bus.id = 'LIVE';
        }
        return acc;
    }, {})).filter((a: any) => Number.isFinite(a.diffMin) && a.diffMin >= -15 && a.diffMin <= 2880).sort((a: any, b: any) => {
      const aPlanned = Number.isFinite(a.plannedTimeMs) ? a.plannedTimeMs : a.depTimeMs;
      const bPlanned = Number.isFinite(b.plannedTimeMs) ? b.plannedTimeMs : b.depTimeMs;
      return (Number.isFinite(a.depTimeMs) ? a.depTimeMs : aPlanned) - (Number.isFinite(b.depTimeMs) ? b.depTimeMs : bPlanned);
    });

    return results;
  }, [stopDepartures, vehicles, selectedStopId, selectedExternalStop, now]);

  useEffect(() => {
    if (selectedStopId) {
      const splitCsv = (value: unknown) =>
        String(value || '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
      const stopInfo = stopsList.find(s => s.id === selectedStopId);
      const providerStopIds = selectedExternalStop?.providerStopIds || {};
      const externalPksIds = splitCsv(providerStopIds.pks);
      const mpkStopIds = splitCsv(providerStopIds.mpk_rzeszow);
      const marcelRouteIds = splitCsv(providerStopIds.marcelRouteIds);
      const stopIdsToFetch = selectedExternalStop ? externalPksIds : [selectedStopId];

      const areaIds = splitCsv(providerStopIds.pksAreaIds || selectedExternalStop?.areaId || stopInfo?.areaId);
      const codes = splitCsv(providerStopIds.pksCodes || selectedExternalStop?.code || stopInfo?.code || '');
      const tuples = stopIdsToFetch.map((stopId, index) => ({
        stopId,
        areaId: areaIds[index] || areaIds[0],
        code: codes[index] || codes[0] || '',
      }));
      const dateKeys = [selectedWarsawDateIso(0), selectedWarsawDateIso(1)];
      const requestKey = JSON.stringify({
        pks: tuples,
        mpk: mpkStopIds,
        marcel: marcelRouteIds,
        selected: selectedExternalStop?.id || selectedStopId,
        days: dateKeys,
      });
      const requestSeq = ++stopDeparturesRequestSeqRef.current;

      const cached = stopDeparturesCacheRef.current.get(requestKey);
      const isFreshCache = Boolean(cached && Date.now() - cached.savedAt <= 75_000);
      if (cached?.journeys?.length) {
        setStopDepartures(cached.journeys);
        setIsFetchingDepartures(!isFreshCache);
        if (isFreshCache) return;
      } else {
        setIsFetchingDepartures(true);
        setStopDepartures([]);
      }

      const existingRequest = stopDeparturesInFlightRef.current.get(requestKey);
      const fetchRequest = existingRequest || (async () => {
        const pksRequests = tuples.flatMap((tuple) =>
          dateKeys.map((dateIso) =>
            fetchDeparturesClient(tuple.stopId, tuple.areaId, tuple.code, dateIso)
            .then((result) => (Array.isArray(result?.journeys) ? result.journeys : []))
            .then((journeys: any[]) => journeys.map((journey: any) => ({ ...journey, provider_id: 'pks' })))
            .catch(() => []),
          ),
        );

        const mpkRequests = mpkStopIds.flatMap((mpkStopId) =>
          dateKeys.map((dateIso) =>
            fetchMpkRzeszowDeparturesClient(mpkStopId, dateIso)
              .then((entries) => entries.map((entry, index) => mapMpkDepartureToJourney(entry as Record<string, unknown>, dateIso, index)))
              .catch(() => []),
          ),
        );

        const marcelKeys = new Set(
          [
            ...splitCsv(providerStopIds.marcelMatchKeys),
            ...splitCsv(providerStopIds.marcelMatchKey),
            normalizePreciseStopKey(selectedExternalStop?.name || ''),
          ].filter(Boolean),
        );
        const marcelRoutes = marcelRouteIds.length > 0
          ? marcelRouteIds
          : selectedExternalStop?.sourceProviderIds?.includes('marcel')
            ? await fetchMarcelRoutesClient().then((routes) => routes.map((route) => String(route.idTr))).catch(() => [])
          : [];
        const marcelRequests = marcelRoutes.flatMap((routeId) =>
          dateKeys.map(async (dateIso) => {
            const courses = await fetchMarcelCoursesClient(routeId, dateIso).catch(() => []);
            const journeys: any[] = [];
            await Promise.all(courses.map(async (course, courseIndex) => {
              const stopsForCourse = await fetchMarcelPublicCourseStopsClient(course.idKu).catch(() => []);
              const matchIndex = stopsForCourse.findIndex((courseStop) =>
                marcelCourseStopKeys(courseStop).some((key) => marcelKeys.has(key)),
              );
              if (matchIndex < 0) return;
              journeys.push(mapMarcelDepartureToJourney(course as Record<string, unknown>, stopsForCourse[matchIndex] as Record<string, unknown>, dateIso, courseIndex));
            }));
            return journeys;
          }),
        );

        const responses = await Promise.all([...pksRequests, ...mpkRequests, ...marcelRequests]);
        return responses.flat();
      })()
        .finally(() => {
          stopDeparturesInFlightRef.current.delete(requestKey);
        });
      if (!existingRequest) {
        stopDeparturesInFlightRef.current.set(requestKey, fetchRequest);
      }

      fetchRequest
        .then((journeys) => {
          stopDeparturesCacheRef.current.set(requestKey, {
            savedAt: Date.now(),
            journeys,
          });
          if (stopDeparturesCacheRef.current.size > 80) {
            const oldestKey = stopDeparturesCacheRef.current.keys().next().value;
            if (oldestKey) stopDeparturesCacheRef.current.delete(oldestKey);
          }
          if (stopDeparturesRequestSeqRef.current !== requestSeq) return;
          setStopDepartures(journeys);
          setIsFetchingDepartures(false);
        })
        .catch(err => {
          console.error('Fetch departures error:', err);
          if (stopDeparturesRequestSeqRef.current !== requestSeq) return;
          setStopDepartures([]);
          setIsFetchingDepartures(false);
        });
    } else {
      stopDeparturesRequestSeqRef.current += 1;
      setTimeout(() => setStopDepartures([]), 0);
      setIsFetchingDepartures(false);
    }
  }, [selectedExternalStop, selectedStopId, stopsList]);

  useEffect(() => {
    const storedProviders = sanitizeProvidersWithVisibility(readStoredTransportProviders(), hiddenProvidersSet);
    activeProvidersRef.current = storedProviders;
    setActiveProviders(storedProviders);
    setDraftProviders(storedProviders);
    setHasLoadedTransportProviders(true);
    setIsLoading(false);

    const sTheme = localStorage.getItem('mks_theme');
    if (sTheme && sTheme !== themeColor) setTimeout(() => setThemeColor(sTheme), 0);
    const sInactive = localStorage.getItem('mks_show_inactive');
    if (sInactive !== null) setTimeout(() => setShowInactive(sInactive === 'true'), 0);
    const sAppTheme = localStorage.getItem('mks_app_theme') as any;
    if (sAppTheme) setAppTheme(sAppTheme);
    const sTrans = localStorage.getItem('mks_transparent');
    if (sTrans !== null) setTimeout(() => setTransparentUI(sTrans === 'true'), 0);
    const favs = localStorage.getItem('mks_fav_stops');
    if (favs) setTimeout(() => setFavsState(JSON.parse(favs)), 0);
    
    // Check system preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemIsDark(mediaQuery.matches);
    
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveThemeColor = (hex: string) => { setThemeColor(hex); localStorage.setItem('mks_theme', hex); };
  const saveInactive = (val: boolean) => { setShowInactive(val); localStorage.setItem('mks_show_inactive', String(val)); fetchVehicles(val); };
  const saveAppTheme = (val: any) => {
    setAppTheme(val);
    localStorage.setItem('mks_app_theme', val);
    const actual = val === 'system' ? (systemIsDark ? 'dark' : 'light') : val;
    const bg =
      actual === 'light'
        ? '#f8fafc'
        : actual === 'light-warm'
          ? '#f2ede1'
          : actual === 'dark-oled'
            ? '#000000'
            : actual === 'dark-aurora'
              ? '#06130f'
              : '#111027';
    const text = actual === 'light'
      ? '#020617'
      : actual === 'light-warm'
        ? '#272116'
        : '#ffffff';
    document.documentElement.style.setProperty('--pks-initial-bg', bg);
    document.documentElement.style.setProperty('--pks-loading-text', text);
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
  };
  const saveTransparentUI = (val: boolean) => { setTransparentUI(val); localStorage.setItem('mks_transparent', String(val)); };

  const deferredFilterRoute = useDeferredValue(filterRoute);
  const handleManualRefresh = async () => {
    setIsManualRefreshing(true);
    // eslint-disable-next-line react-hooks/purity
    const start = Date.now();
    try {
      await fetchVehicles(showInactive, true);
    } catch {
      // Ignored
    } finally {
      const elapsed = Date.now() - start;
      const finish = () => {
        setIsManualRefreshing(false);
      };
      if (elapsed < 800) {
        setTimeout(finish, 800 - elapsed);
      } else {
        finish();
      }
    }
  };

  const mergeVehicleDetails = useCallback((base: Vehicle, details?: Vehicle | null) => {
    if (!details) return base;

    const baseSchedule = base.schedule || [];
    const detailsSchedule = details.schedule || [];
    const baseRouteStops = base.routeStops || [];
    const detailsRouteStops = details.routeStops || [];
    const baseRoutePath = base.routePath || [];
    const detailsRoutePath = details.routePath || [];
    const baseRouteShape = base.routeShape || [];
    const detailsRouteShape = details.routeShape || [];

    const scheduleScore = (schedule: Vehicle['schedule']) => {
      const list = schedule || [];
      if (list.length === 0) return 0;
      let withTime = 0;
      let withCoords = 0;
      for (const stop of list) {
        if (stop?.planned || stop?.real) withTime += 1;
        if (Number.isFinite(stop?.lat) && Number.isFinite(stop?.lon)) withCoords += 1;
      }
      return list.length + withTime * 4 + withCoords * 2;
    };

    const routeStopsScore = (stops: Vehicle['routeStops']) => {
      const list = stops || [];
      if (list.length === 0) return 0;
      let withCoords = 0;
      let withRealNames = 0;
      for (const stop of list) {
        if (Number.isFinite(stop?.lat) && Number.isFinite(stop?.lon)) withCoords += 1;
        if (stop?.name && !/^Przystanek\s+\d+$/i.test(String(stop.name).trim())) withRealNames += 1;
      }
      return list.length + withCoords * 3 + withRealNames * 4;
    };

    const baseScheduleScore = scheduleScore(baseSchedule);
    const detailsScheduleScore = scheduleScore(detailsSchedule);
    const baseRouteStopsScore = routeStopsScore(baseRouteStops);
    const detailsRouteStopsScore = routeStopsScore(detailsRouteStops);
    const hasLiveSchedule = baseScheduleScore >= detailsScheduleScore + 2;
    const hasLiveRouteStops = baseRouteStopsScore >= detailsRouteStopsScore + 2;
    const hasLiveRoutePath = baseRoutePath.length > 1 && baseRoutePath.length >= detailsRoutePath.length;
    const hasLiveRouteShape = baseRouteShape.length > 1 && baseRouteShape.length >= detailsRouteShape.length;

    const provider = (base.provider || details.provider) as TransportProviderId;
    const isPkpIntercity = provider === 'pkp_intercity';
    const stableLiveBase = mergeLiveVehicleSnapshot(base, details);

    return {
      ...details,
      ...base,
      // Keep live telemetry authoritative to avoid stale detail cache snapping UI backward.
      lat: base.lat,
      lon: base.lon,
      delay: base.delay,
      status: base.status,
      statusText: base.statusText,
      dataAgeSec: base.dataAgeSec,
      lastSignalTime: base.lastSignalTime,
      schedule: hasLiveSchedule ? baseSchedule : (detailsSchedule.length > 0 ? detailsSchedule : baseSchedule),
      routeStops: hasLiveRouteStops ? baseRouteStops : (detailsRouteStops.length > 0 ? detailsRouteStops : baseRouteStops),
      routePath: hasLiveRoutePath ? baseRoutePath : (detailsRoutePath.length > 0 ? detailsRoutePath : baseRoutePath),
      routeShape: hasLiveRouteShape ? baseRouteShape : (detailsRouteShape.length > 0 ? detailsRouteShape : baseRouteShape),
      // Preserve details-only metadata if polling payload does not carry it.
      model: base.model || details.model,
      journeyId: base.journeyId ?? details.journeyId,
      serviceId: base.serviceId ?? details.serviceId,
      tripId: base.tripId ?? details.tripId,
      brigadeName: base.brigadeName ?? details.brigadeName,
      bearing: base.bearing ?? details.bearing,
      isHistorical: base.isHistorical ?? details.isHistorical,
      speed: stableLiveBase.speed,
      computedSpeed: stableLiveBase.computedSpeed,
      vehicleNumber: isPkpIntercity ? (details.vehicleNumber || base.vehicleNumber) : (base.vehicleNumber || details.vehicleNumber),
      name: isPkpIntercity ? (details.name || base.name) : (base.name || details.name),
      routeShortName: isPkpIntercity ? (details.routeShortName || base.routeShortName) : (base.routeShortName || details.routeShortName),
      iconVariant: isPkpIntercity ? (details.iconVariant || base.iconVariant) : (base.iconVariant || details.iconVariant),
      trainName: isPkpIntercity ? (details.trainName || base.trainName) : (base.trainName || details.trainName),
      positionQuality: isPkpIntercity ? (details.positionQuality || base.positionQuality) : (base.positionQuality || details.positionQuality),
    };
  }, [hiddenProvidersSet]);

  useEffect(() => {
    if (!hasLoadedTransportProviders) return;
    const nextProviders = sanitizeProvidersWithVisibility(activeProvidersRef.current, hiddenProvidersSet);
    if (sameTransportProviders(nextProviders, activeProvidersRef.current)) return;

    const nextProviderSet = new Set(nextProviders);
    activeProvidersRef.current = nextProviders;
    setActiveProviders(nextProviders);
    setDraftProviders((current) => sanitizeProvidersWithVisibility(current, hiddenProvidersSet));
    setVehicles((currentVehicles) => currentVehicles.filter((vehicle) =>
      nextProviderSet.has((vehicle.provider || 'pks') as TransportProviderId),
    ));
    localStorage.setItem('mks_transport_providers', JSON.stringify(nextProviders));
    setSelectedBus((currentSelected) => {
      if (!currentSelected) return currentSelected;
      const providerId = (currentSelected.provider || 'pks') as TransportProviderId;
      return nextProviderSet.has(providerId) ? currentSelected : null;
    });
  }, [hasLoadedTransportProviders, hiddenProvidersSet]);

  const loadVehicleDetails = useCallback(async (
    vehicle: Vehicle,
    options?: { force?: boolean; silent?: boolean },
  ) => {
    const force = Boolean(options?.force);
    const silent = Boolean(options?.silent);
    const provider = (vehicle.provider || 'pks') as TransportProviderId;
    const cacheKey = vehicleRouteDetailsCacheKey(vehicle, provider, showInactive);
    const cached = vehicleDetailsCacheRef.current.get(cacheKey);
    if (!force && cached && cached.expiresAt > Date.now() && hasUsableRouteDetails(cached.vehicle)) {
      setSelectedBus((current) => current?.id === vehicle.id ? mergeVehicleDetails(current, cached.vehicle) : current);
      return cached.vehicle;
    }

    const requestSeq = vehicleDetailsRequestSeqRef.current + 1;
    vehicleDetailsRequestSeqRef.current = requestSeq;
    if (!silent) setSelectedBusDetailsLoading(true);
    try {
      const details = await fetchVehicleDetailsClient(provider, vehicle.id, showInactive, vehicle);
      if (details) {
        vehicleDetailsCacheRef.current.set(
          cacheKey,
          {
            vehicle: details,
            expiresAt: Date.now() + (hasUsableRouteDetails(details) ? 30 * 60_000 : 8_000),
          },
        );
        setSelectedBus((current) => current?.id === vehicle.id ? mergeVehicleDetails(current, details) : current);
      }
      return details;
    } catch (error) {
      console.warn('Vehicle details unavailable:', error);
      return null;
    } finally {
      if (!silent && vehicleDetailsRequestSeqRef.current === requestSeq) setSelectedBusDetailsLoading(false);
    }
  }, [mergeVehicleDetails, showInactive]);

  useEffect(() => {
    if (!selectedBus) return;
    let cancelled = false;

    const refreshSelectedBusDetails = () => {
      const latestVehicle = vehiclesRef.current.find((vehicle) => vehicle.id === selectedBus.id) || selectedBus;
      loadVehicleDetails(latestVehicle, { silent: true });
    };

    const initialTimer = window.setTimeout(() => {
      if (!cancelled) refreshSelectedBusDetails();
    }, 350);
    const intervalId = window.setInterval(() => {
      if (!cancelled) refreshSelectedBusDetails();
    }, 7000);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [loadVehicleDetails, selectedBus?.id, selectedBus?.provider]);

  const fetchVehicles = async (inactive = showInactive, force = false) => {
    if (!hasLoadedTransportProviders) {
      setIsLoading(false);
      return;
    }

    if (!isAppForegroundRef.current) {
      setIsLoading(false);
      return;
    }

    const requestProviders = activeProvidersRef.current;

    if (requestProviders.length === 0) {
      setVehicles([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const nowMs = Date.now();
      const shouldFetchPkpIntercity = requestProviders.includes('pkp_intercity')
        ? force || nowMs - lastPkpIntercityFetchAtRef.current >= PKP_INTERCITY_REFRESH_MS
        : false;
      const providersToRequest = requestProviders.filter(
        (provider) => provider !== 'pkp_intercity' || shouldFetchPkpIntercity,
      );
      if (providersToRequest.length === 0) {
        setIsLoading(false);
        return;
      }

      vehiclesFetchAbortRef.current?.abort();
      const controller = new AbortController();
      vehiclesFetchAbortRef.current = controller;
      timeoutId = setTimeout(() => controller.abort(), 30000);
      const applyProviderVehicles = (provider: TransportProviderId, providerVehicles: Vehicle[]) => {
        if (controller.signal.aborted) return;
        if (!activeProvidersRef.current.includes(provider)) return;
        setVehicles((currentVehicles) => {
          const providerSet = new Set(activeProvidersRef.current);
          const currentByKey = new Map(currentVehicles.map((vehicle) => [vehicleStableKey(vehicle), vehicle]));
          const incomingKeys = new Set<string>();
          const mergedIncoming = providerVehicles
            .filter((vehicle) => providerSet.has((vehicle.provider || 'pks') as TransportProviderId))
            .map((vehicle) => {
              const key = vehicleStableKey(vehicle);
              incomingKeys.add(key);
              return mergeLiveVehicleSnapshot(vehicle, currentByKey.get(key));
            });
          const lastNonEmptyAt = lastProviderNonEmptyAtRef.current.get(provider) || Date.now();
          const keepMissingProviderVehicles =
            mergedIncoming.length > 0 &&
            Date.now() - lastNonEmptyAt <= VEHICLE_PROVIDER_STALE_GRACE_MS;
          const nextVehicles = [
            ...currentVehicles.filter((vehicle) => {
              const providerId = (vehicle.provider || 'pks') as TransportProviderId;
              if (!providerSet.has(providerId)) return false;
              if (providerId !== provider) return true;
              return keepMissingProviderVehicles && !incomingKeys.has(vehicleStableKey(vehicle));
            }),
            ...mergedIncoming,
          ];
          const nextDataStr = vehicleListSignature(nextVehicles);
          if (nextDataStr === lastVehiclesRef.current) return currentVehicles;
          lastVehiclesRef.current = nextDataStr;
          return nextVehicles;
        });
      };
      const data = await fetchVehiclesClient(inactive, providersToRequest, {
        signal: controller.signal,
        pkpViewport: mapViewportRef.current || undefined,
        onProviderVehicles: applyProviderVehicles,
      }) as any;
      if (timeoutId) clearTimeout(timeoutId);
      if (vehiclesFetchAbortRef.current === controller) vehiclesFetchAbortRef.current = null;
      if (!sameTransportProviders(requestProviders, activeProvidersRef.current)) return;
      const loadedVehicles = Array.isArray(data) ? data : (data.vehicles || []);
      const requestProviderSet = new Set(requestProviders);
      const requestedProviderSet = new Set(providersToRequest);
      const freshVehicles = loadedVehicles.filter((vehicle: Vehicle) =>
        requestProviderSet.has((vehicle.provider || 'pks') as TransportProviderId),
      );
      const previousVehicles = vehiclesRef.current;
      const nowAfterFetch = Date.now();
      const stableFreshVehicles = [...freshVehicles];
      providersToRequest.forEach((provider) => {
        const freshForProvider = freshVehicles.filter((vehicle: Vehicle) => (vehicle.provider || 'pks') === provider);
        if (freshForProvider.length > 0) {
          lastProviderNonEmptyAtRef.current.set(provider, nowAfterFetch);
          return;
        }

        const previousForProvider = previousVehicles.filter((vehicle) => (vehicle.provider || 'pks') === provider);
        const lastNonEmptyAt = lastProviderNonEmptyAtRef.current.get(provider) || 0;
        const canKeepStale =
          previousForProvider.length > 0 &&
          lastNonEmptyAt > 0 &&
          nowAfterFetch - lastNonEmptyAt <= VEHICLE_PROVIDER_STALE_GRACE_MS;
        if (canKeepStale) stableFreshVehicles.push(...previousForProvider);
      });
      const carriedVehicles = vehiclesRef.current.filter((vehicle) => {
        const providerId = (vehicle.provider || 'pks') as TransportProviderId;
        return requestProviderSet.has(providerId) && !requestedProviderSet.has(providerId);
      });
      const previousByKey = new Map(vehiclesRef.current.map((vehicle) => [vehicleStableKey(vehicle), vehicle]));
      const visibleVehicles = [...carriedVehicles, ...stableFreshVehicles.map((vehicle) =>
        mergeLiveVehicleSnapshot(vehicle, previousByKey.get(vehicleStableKey(vehicle))),
      )];
      const newDataStr = vehicleListSignature(visibleVehicles);
      if (newDataStr !== lastVehiclesRef.current) {
        setVehicles(visibleVehicles);
        lastVehiclesRef.current = newDataStr;
      }
      if (providersToRequest.includes('pkp_intercity')) {
        lastPkpIntercityFetchAtRef.current = Date.now();
      }
      setError(null);
      if (isOffline) setIsOffline(false);
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      if (vehiclesFetchAbortRef.current?.signal.aborted) vehiclesFetchAbortRef.current = null;
      if (err.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('abort')) {
        return;
      }
      const errorMessage = String(err?.message || '');
      const isPkpIntercityProviderError = errorMessage.toLowerCase().includes('pkp intercity niedostepne');
      console.error('Fetch vehicles error:', err);
      if (
        !isPkpIntercityProviderError &&
        (err.message === 'Failed to fetch' ||
        err.name === 'AbortError' ||
        String(err.message || '').toLowerCase().includes('network') ||
        (typeof navigator !== 'undefined' && !navigator.onLine))
      ) {
        setIsOffline(true);
      }
      if (vehicles.length === 0 || force) {
        if (isPkpIntercityProviderError) {
          setError(errorMessage);
        } else if (err.message === 'Failed to fetch') {
          setError('Brak połączenia z internetem lub serwerem');
        } else {
          setError(err.message || 'Wystąpił nieoczekiwany błąd');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!hasLoadedTransportProviders) return;

    if (activeProviders.length === 0) {
      setVehicles([]);
      setSelectedBus(null);
      setError(null);
      setIsLoading(false);
      setHasBootstrappedLiveVehicles(true);
      return;
    }

    setIsLoading(false);
    if (activeTab !== 'map') {
      setHasBootstrappedLiveVehicles(true);
      bootstrapCancelRef.current?.();
      bootstrapCancelRef.current = null;
      return;
    }

    setHasBootstrappedLiveVehicles(false);
    let cancelled = false;
    const cancelAfterPaint = scheduleAfterFirstPaint(() => {
      if (cancelled) return;
      const cancelIdle = scheduleClientIdle(() => {
        if (cancelled) return;
        void fetchVehicles(showInactive, true).finally(() => {
          if (!cancelled) setHasBootstrappedLiveVehicles(true);
        });
      }, 320);
      bootstrapCancelRef.current = cancelIdle;
    }, 80);

    return () => {
      cancelled = true;
      cancelAfterPaint();
      bootstrapCancelRef.current?.();
      bootstrapCancelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProviders, hasLoadedTransportProviders, activeTab]);

  useEffect(() => {
    if (!hasLoadedTransportProviders) return;
    if (!hasBootstrappedLiveVehicles) return;

    let timer: NodeJS.Timeout;
    const shouldPollVehicles = activeTab === 'map';
    
    const tick = async () => {
      if (shouldPollVehicles && isAppForegroundRef.current && !isOffline) {
        await fetchVehicles();
      }
      timer = setTimeout(tick, refreshInterval);
    };

    timer = setTimeout(tick, refreshInterval);

    const handleVisibility = () => {
      if (shouldPollVehicles && isAppForegroundRef.current && !isOffline) {
        fetchVehicles(showInactive, true);
      }
    };
    
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshInterval, showInactive, isOffline, activeProviders, hasLoadedTransportProviders, hasBootstrappedLiveVehicles, activeTab]);

  useEffect(() => {
    if (!hasLoadedTransportProviders) return;

    let cancelled = false;
    let nativeListenerPromise: Promise<{ remove: () => Promise<void> }> | null = null;

    const readOfflineState = async () => {
      let offline = !(await hasInternetReachability());

      if (Capacitor.isNativePlatform()) {
        try {
          const { Network } = await import('@capacitor/network');
          const status = await Network.getStatus();
          if (!status.connected) offline = true;
        } catch (err) {
          console.warn('Native network status unavailable', err);
        }
      }

      return offline;
    };

    const applyOnlineState = async () => {
      const offline = await readOfflineState();
      if (!cancelled) setIsOffline(offline);
      return offline;
    };

    applyOnlineState();

    if (Capacitor.isNativePlatform()) {
      nativeListenerPromise = import('@capacitor/network').then(({ Network }) =>
        Network.addListener('networkStatusChange', (status) => {
          setIsOffline(!status.connected);
          if (status.connected && isAppForegroundRef.current) fetchVehicles(showInactive, true);
        }),
      );
    }

    const handleOffline = () => {
      setIsOffline(true);
      applyOnlineState();
    };
    const handleOnline = () => {
      applyOnlineState().then((offline) => {
        if (!offline && isAppForegroundRef.current) fetchVehicles(showInactive, true);
      });
    };
    const syncOnlineState = async () => {
      const offline = await readOfflineState();
      if (cancelled) return;
      setIsOffline((wasOffline) => {
        if (wasOffline && !offline && isAppForegroundRef.current) {
          fetchVehicles(showInactive, true);
        }
        return offline;
      });
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', syncOnlineState);
    document.addEventListener('visibilitychange', syncOnlineState);
    const onlineStateTimer = window.setInterval(syncOnlineState, 2500);
    return () => {
      cancelled = true;
      nativeListenerPromise?.then((listener) => listener.remove()).catch(() => {});
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', syncOnlineState);
      document.removeEventListener('visibilitychange', syncOnlineState);
      window.clearInterval(onlineStateTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive, activeProviders, hasLoadedTransportProviders]);

  const loadStops = () => {
    setStopsLoadError(false);
    const mapStops = (d: Awaited<ReturnType<typeof fetchStopsClient>>) =>
      Object.entries(d).map(([id, val]: any) => ({
           id, 
           name: val.n, 
           areaId: val.areaId, 
           code: val.code,
           lat: val.lat,
           lon: val.lon
      })).sort((a,b) => a.name.localeCompare(b.name));
    fetchStopsClient()
      .then(d => {
        const cachedStops = mapStops(d);
        setStopsList(cachedStops);
      })
      .catch(e => {
        console.error('Fetch stops fail:', e);
        setStopsLoadError(true);
      });
  };

  useEffect(() => {
    let cancelIdle = () => {};
    const cancelPaint = scheduleAfterFirstPaint(() => {
      cancelIdle = scheduleClientIdle(loadStops, 1600);
    }, 250);
    return () => {
      cancelPaint();
      cancelIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedBus) {
      const updated = vehicles.find(v => v.id === selectedBus.id && v.provider === selectedBus.provider);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (updated && updated !== selectedBus) {
        setSelectedBus(mergeVehicleDetails(updated, selectedBus));
      }
      if (!updated && activeProviders.length > 0) setSelectedBus(null);
    }
  }, [vehicles, selectedBus?.id, activeProviders.length, mergeVehicleDetails]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredVehicles = useMemo(() => {
    if (!deferredFilterRoute) return vehicles;
    const f = deferredFilterRoute.toLowerCase();
    return vehicles.filter(v => 
      (v.routeShortName || '').toLowerCase().includes(f) || 
      (v.id || '').toLowerCase().includes(f) ||
      getVehicleDisplayNumber(v).toLowerCase().includes(f)
    );
  }, [vehicles, deferredFilterRoute]);

  const handleMapViewportChange = useCallback((payload: { bbox: [number, number, number, number]; center: [number, number]; zoom: number }) => {
    mapViewportRef.current = payload;

    if (!isAppForegroundRef.current) return;
    if (isOffline) return;
    if (!activeProvidersRef.current.includes('pkp_intercity')) return;

    const nowMs = Date.now();
    if (nowMs - lastViewportFetchAtRef.current < PKP_INTERCITY_REFRESH_MS) return;
    lastViewportFetchAtRef.current = nowMs;
    fetchVehicles(showInactive, true);
  }, [fetchVehicles, isOffline, showInactive]);

  const stopsDataMap = useMemo(() => {
    const map: Record<string, any> = {};
    stopsList.forEach(s => {
      if (s.lat !== undefined && s.lon !== undefined) {
         map[String(s.id)] = { n: s.name, lat: s.lat, lon: s.lon };
      }
    });
    if (selectedExternalStop?.lat !== undefined && selectedExternalStop.lon !== undefined) {
      map[String(selectedExternalStop.id)] = {
        n: selectedExternalStop.name,
        lat: selectedExternalStop.lat,
        lon: selectedExternalStop.lon,
      };
    }
    return map;
  }, [selectedExternalStop, stopsList]);

  // Keep live polling predictable and light. Details are fetched on demand after clicking a bus.
  useEffect(() => {
    if (refreshInterval !== 7000) setTimeout(() => setRefreshInterval(7000), 0);
  }, [refreshInterval]);

  const incomingToStop = (stopId: string) => {
    const now = new Date().getTime();
    const incoming: any[] = [];
    for (const v of vehicles) {
       if (!v.schedule) continue;
       const stopInfo = v.schedule.find((s: any) => String(s.id) === String(stopId));
       if (stopInfo) {
          const timeStr = stopInfo.real || stopInfo.planned;
          if (!timeStr) continue;
          const d = new Date(timeStr.replace(' ', 'T'));
          if (!isNaN(d.getTime())) {
             const diffMin = Math.floor((d.getTime() - now) / 60000);
             if (diffMin >= -2 && diffMin <= 1440) { // Check up to 24 hours
                 incoming.push({ bus: v, timeStr, diffMin, depTimeMs: d.getTime(), actualTimeStr: timeStr.substring(11, 16) });
             }
          }
       }
    }
    return incoming.sort((a,b) => a.depTimeMs - b.depTimeMs);
  };

  // Theme Helpers
  const actualTheme = appTheme === 'system' ? (systemIsDark ? 'dark' : 'light') : appTheme;
  const isDark = actualTheme.startsWith('dark');
  const isOled = actualTheme === 'dark-oled';
  const isAurora = actualTheme === 'dark-aurora';
  const isWarm = actualTheme === 'light-warm';

  const bgMain = isDark ? (isOled ? 'bg-black' : isAurora ? 'bg-[#120f24]' : 'bg-slate-900') : (isWarm ? 'bg-[#f8f5f0]' : 'bg-slate-50');
  const bgCard = transparentUI 
     ? (isDark ? (isOled ? 'bg-black/80 backdrop-blur-xl border-slate-800/50' : isAurora ? 'bg-[#1a1430]/84 backdrop-blur-xl border-fuchsia-400/20' : 'bg-slate-900/80 backdrop-blur-xl border-slate-700/50') : 'bg-white/90 backdrop-blur-md border-slate-100/50')
     : (isDark ? (isOled ? 'bg-[#0a0a0a] border-slate-800' : isAurora ? 'bg-[#1f1736] border-fuchsia-400/20' : 'bg-slate-900 border-slate-700') : 'bg-white border-slate-200');
  const mapGlassPanel = transparentUI
     ? (isDark
        ? isOled
          ? 'bg-black/24 backdrop-blur-2xl border-white/12 shadow-[0_18px_60px_rgba(0,0,0,0.28)]'
          : isAurora
            ? 'bg-[#120f24]/28 backdrop-blur-2xl border-fuchsia-300/18 shadow-[0_18px_60px_rgba(12,8,28,0.22)]'
            : 'bg-[#07131a]/26 backdrop-blur-2xl border-white/12 shadow-[0_18px_60px_rgba(0,0,0,0.22)]'
        : isWarm
          ? 'bg-[#faf7ef]/34 backdrop-blur-2xl border-[#8a7b5f]/20 shadow-[0_18px_55px_rgba(93,79,50,0.12)]'
          : 'bg-white/34 backdrop-blur-2xl border-slate-900/12 shadow-[0_18px_55px_rgba(15,23,42,0.10)]')
     : bgCard;
  const mapGlassInput = transparentUI
     ? (isDark
        ? 'bg-white/[0.045] text-white placeholder-slate-300/75 border border-white/12 backdrop-blur-xl'
        : isWarm
          ? 'bg-[#fffaf0]/36 text-[#272116] placeholder-[#746a58]/75 border border-[#8a7b5f]/16 backdrop-blur-xl'
          : 'bg-white/36 text-slate-950 placeholder-slate-500 border border-slate-900/12 backdrop-blur-xl')
     : (isDark ? 'bg-slate-800 text-white placeholder-slate-400' : 'bg-slate-100/50 text-slate-900 placeholder-slate-500');
  const mapDetailPanel = transparentUI
     ? (isDark
        ? isOled
          ? 'bg-black/88 backdrop-blur-3xl backdrop-saturate-150 border-white/12 shadow-[0_-28px_90px_rgba(0,0,0,0.72)]'
          : isAurora
            ? 'bg-[#151029]/90 backdrop-blur-3xl backdrop-saturate-150 border-fuchsia-300/18 shadow-[0_-28px_90px_rgba(10,6,26,0.66)]'
            : 'bg-[#07131a]/90 backdrop-blur-3xl backdrop-saturate-150 border-white/12 shadow-[0_-28px_90px_rgba(0,0,0,0.56)]'
        : isWarm
          ? 'bg-[#f7f0df]/94 backdrop-blur-3xl backdrop-saturate-150 border-[#8a7b5f]/18 shadow-[0_-24px_75px_rgba(93,79,50,0.24)]'
          : 'bg-white/94 backdrop-blur-3xl backdrop-saturate-150 border-white/70 shadow-[0_-24px_75px_rgba(15,23,42,0.18)]')
     : (isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100');
  const mapDetailContent = transparentUI
     ? (isDark
        ? isAurora
          ? 'bg-[#100d24]/92 backdrop-blur-3xl'
          : isOled
            ? 'bg-black/90 backdrop-blur-3xl'
            : 'bg-[#061017]/92 backdrop-blur-3xl'
        : isWarm
          ? 'bg-[#fff7e8]/94 backdrop-blur-3xl'
          : 'bg-white/94 backdrop-blur-3xl')
     : bgMain;
  const mapDetailCard = transparentUI
     ? (isDark
        ? 'bg-[#0d1622]/96 border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.16)]'
        : isWarm
          ? 'bg-[#fffaf0]/96 border-[#8a7b5f]/18 shadow-[0_8px_24px_rgba(93,79,50,0.12)]'
          : 'bg-white/96 border-white/65 shadow-[0_8px_24px_rgba(15,23,42,0.10)]')
     : (isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100');
  const mapDetailDivider = transparentUI
     ? (isDark ? 'border-white/10' : isWarm ? 'border-[#8a7b5f]/16' : 'border-white/55')
     : (isDark ? 'border-slate-700' : 'border-slate-100');
  const mapDetailLine = transparentUI
     ? (isDark ? 'bg-white/14' : isWarm ? 'bg-[#8a7b5f]/22' : 'bg-slate-900/12')
     : (isDark ? 'bg-slate-700' : 'bg-slate-200');
  const bottomGlassShell = transparentUI
     ? (isDark
        ? isOled
          ? 'border-white/10 bg-black/28 text-slate-300 shadow-[0_-18px_70px_rgba(0,0,0,0.34)] backdrop-blur-2xl'
          : isAurora
            ? 'border-fuchsia-300/16 bg-[#120f24]/32 text-violet-100/75 shadow-[0_-18px_70px_rgba(12,8,28,0.30)] backdrop-blur-2xl'
            : 'border-white/10 bg-[#07131a]/30 text-slate-300 shadow-[0_-18px_70px_rgba(0,0,0,0.30)] backdrop-blur-2xl'
        : isWarm
          ? 'border-[#8a7b5f]/18 bg-[#f2ede1]/42 text-[#746a58] shadow-[0_-18px_60px_rgba(93,79,50,0.14)] backdrop-blur-2xl'
          : 'border-slate-900/10 bg-white/44 text-slate-500 shadow-[0_-18px_60px_rgba(15,23,42,0.12)] backdrop-blur-2xl')
     : (isDark ? 'border-slate-800 bg-slate-900 text-slate-400 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]' : 'border-slate-200 bg-white text-slate-500 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]');
  const optionsOverlay = isDark ? 'bg-black/48 backdrop-blur-md' : 'bg-slate-950/20 backdrop-blur-md';
  const optionsSheet = transparentUI
     ? (isDark
        ? isAurora
          ? 'border-fuchsia-300/16 bg-[#111026]/88 text-white shadow-[0_-34px_100px_rgba(5,3,20,0.68)] backdrop-saturate-150'
          : isOled
            ? 'border-white/10 bg-black/88 text-white shadow-[0_-34px_100px_rgba(0,0,0,0.76)] backdrop-saturate-150'
            : 'border-white/10 bg-[#0d1425]/88 text-white shadow-[0_-34px_100px_rgba(4,8,18,0.68)] backdrop-saturate-150'
        : isWarm
          ? 'border-[#8a7b5f]/18 bg-[#f7f0df]/86 text-[#272116] shadow-[0_-30px_90px_rgba(93,79,50,0.24)] backdrop-saturate-150'
          : 'border-white/70 bg-white/86 text-slate-950 shadow-[0_-30px_90px_rgba(15,23,42,0.18)] backdrop-saturate-150')
     : (isDark ? 'border-slate-700/60 bg-slate-900 text-white shadow-2xl' : 'border-slate-200 bg-white text-slate-950 shadow-2xl');
  const optionsCard = transparentUI
     ? (isDark ? 'border-white/10 bg-white/[0.06]' : isWarm ? 'border-[#8a7b5f]/14 bg-white/38' : 'border-slate-900/10 bg-white/54')
     : (isDark ? 'border-slate-700/70 bg-slate-800/55' : 'border-slate-200 bg-slate-50');
  const optionsButton = transparentUI
     ? (isDark ? 'bg-white/[0.075] hover:bg-white/[0.11]' : isWarm ? 'bg-white/48 hover:bg-white/64' : 'bg-white/68 hover:bg-white/88')
     : (isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white hover:bg-slate-100 shadow-sm border border-slate-200/60');
  const textMain = isDark ? 'text-white' : 'text-slate-900';
  const textSub = isDark ? (isAurora ? 'text-violet-200/70' : 'text-slate-400') : 'text-slate-500';
  const selectedBusBreakUntil =
    selectedBus?.status === 'break'
      ? (Number.isFinite(selectedBus.nextTripStartAtMs)
          ? Number(selectedBus.nextTripStartAtMs)
          : selectedBus.schedule?.[0]?.planned
            ? new Date(selectedBus.schedule[0].planned).getTime()
            : NaN)
      : NaN;
  const breakCountdown =
    Number.isFinite(selectedBusBreakUntil)
      ? Math.max(0, Math.floor((selectedBusBreakUntil - now) / 1000))
      : null;
  const breakCountdownLabel = breakCountdown === null
    ? null
    : `${Math.floor(breakCountdown / 60)}:${String(breakCountdown % 60).padStart(2, '0')}`;
  const selectedBusStatusLabel =
    selectedBus?.status === 'break'
      ? 'Przerwa'
      : selectedBus?.status === 'cached'
        ? 'Ostatnia pozycja'
        : selectedBus?.statusText || null;
  const selectedBusGpsSignalClock = formatGpsSignalClock(selectedBus?.lastSignalTime);
  const selectedVehicleColor =
    selectedBus?.provider === 'mpk_rzeszow'
      ? MPK_RZESZOW_COLOR
      : selectedBus?.provider === 'marcel'
        ? MARCEL_COLOR
        : selectedBus?.provider === 'pkp_intercity'
          ? PKP_INTERCITY_COLOR
          : PKS_COLOR;
  const selectedVehicleIsTrain = selectedBus?.type === 'train' || selectedBus?.provider === 'pkp_intercity';
  const selectedBusIsWaitingForDeparture = Boolean(
    selectedBus?.status === 'break' ||
    selectedBus?.statusText?.toLowerCase().includes('przerwa do') ||
    selectedBus?.statusText?.toLowerCase().includes('odjazd za') ||
    selectedBusStatusLabel === 'Przerwa',
  );
  const selectedBusUpcomingSchedule = useMemo(() => {
    const schedule = (selectedBus?.schedule?.length || 0) > 1
      ? selectedBus?.schedule || []
      : selectedBus?.routeStops || selectedBus?.schedule || [];
    return schedule.filter((stop) => {
      if (!isScheduleStopUpcoming(stop, now)) return false;
      return true;
    });
  }, [now, selectedBus?.routeStops, selectedBus?.schedule]);
  const selectedBusScheduleLoading =
    Boolean(selectedBus) &&
    selectedBusDetailsLoading &&
    selectedBusUpcomingSchedule.length <= 1 &&
    (
      (selectedBus?.schedule?.length || 0) <= 1 ||
      !(selectedBus?.schedule || []).some((stop) => stop.planned || stop.real)
    );
  const selectedBusHeaderStyle = {
    background: transparentUI
      ? `linear-gradient(135deg, ${withAlpha(selectedVehicleColor, 0.9)}, ${withAlpha(selectedVehicleColor, 0.68)})`
      : selectedVehicleColor,
  } as React.CSSProperties;
  const showAlertDot = Boolean(error || isOffline);

  const transportOptions = useMemo<TransportOption[]>(() => {
    const options: TransportOption[] = [
      {
        id: 'pks',
        label: 'Autobusy PKS Rzeszów',
        color: '#14b8a6',
        enabled: true,
        type: 'bus',
        iconVariant: 'default_bus',
      },
      {
        id: 'mpk_rzeszow',
        label: 'Autobusy MPK Rzeszów',
        color: '#ff7a00',
        enabled: true,
        type: 'bus',
        iconVariant: 'mpk_rzeszow',
      },
      {
        id: 'marcel',
        label: 'Autobusy Marcel',
        color: MARCEL_COLOR,
        enabled: true,
        type: 'bus',
        iconVariant: 'marcel',
      },
    ];
    return options.filter((option) => !hiddenProvidersSet.has(option.id));
  }, [hiddenProvidersSet]);

  const openTransportPanel = useCallback(() => {
    setDraftProviders(activeProviders);
    setIsSettingsOpen(false);
    setIsTransportPanelOpen(true);
  }, [activeProviders]);

  const toggleDraftProvider = useCallback((providerId: TransportProviderId) => {
    if (hiddenProvidersSet.has(providerId)) return;
    setDraftProviders((current) =>
      current.includes(providerId)
        ? current.filter((value) => value !== providerId)
        : [...current, providerId],
    );
  }, [hiddenProvidersSet]);

  const applyDraftProviders = useCallback(() => {
    const nextProviders = sanitizeProvidersWithVisibility(draftProviders, hiddenProvidersSet);
    const nextProviderSet = new Set(nextProviders);
    setActiveProviders(nextProviders);
    activeProvidersRef.current = nextProviders;
    setVehicles((currentVehicles) => {
      const remainingVehicles = currentVehicles.filter((vehicle) =>
        nextProviderSet.has((vehicle.provider || 'pks') as TransportProviderId),
      );
      lastVehiclesRef.current = vehicleListSignature(remainingVehicles);
      return remainingVehicles;
    });
    localStorage.setItem('mks_transport_providers', JSON.stringify(nextProviders));
    setIsTransportPanelOpen(false);
    if (selectedBus && !nextProviderSet.has((selectedBus.provider || 'pks') as TransportProviderId)) {
      setSelectedBus(null);
      setSelectedStopId(null);
      setSelectedExternalStop(null);
    }
  }, [draftProviders, hiddenProvidersSet, selectedBus]);

  const handleVehicleClick = useCallback((v: Vehicle) => {
    if (!v) return;
    if (selectedBus?.id !== v.id || selectedBus?.provider !== v.provider) {
      setSelectedStopId(null);
      setSelectedExternalStop(null);
    }
    setSelectedBus(v);
    setIsBusPanelExpanded(true);
    setIsSettingsOpen(false);
    setIsTransportPanelOpen(false);
    loadVehicleDetails(v, { force: true });
  }, [loadVehicleDetails, selectedBus?.id, selectedBus?.provider]);
  
  // We force Google map Style, but we will apply a CSS invert filter for dark mode in the JSX if isDark

  return (
    <div className={`fixed inset-0 w-full ${bgMain} ${textMain} font-sans overflow-hidden flex flex-col ${isOled ? 'theme-oled' : ''} ${isWarm ? 'theme-warm' : ''} ${isAurora ? 'theme-aurora' : ''}`}>
      <style>{`
        .dark-mode-map .leaflet-layer,
        .dark-mode-map .leaflet-control-zoom-in,
        .dark-mode-map .leaflet-control-zoom-out,
        .dark-mode-map .leaflet-control-attribution {
          filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
        }
        
        /* OLED Theme Overrides */
        .theme-oled .bg-slate-900:not(.mks-bus-marker *) { background-color: #000000 !important; }
        .theme-oled .bg-slate-800:not(.mks-bus-marker *) { background-color: #050505 !important; }
        .theme-oled .bg-slate-700:not(.mks-bus-marker *) { background-color: #0a0a0a !important; }
        .theme-oled .border-slate-800:not(.mks-bus-marker *) { border-color: transparent !important; }
        .theme-oled .border-slate-700:not(.mks-bus-marker *) { border-color: transparent !important; }
        .theme-oled .border-slate-700\\/50 { border-color: transparent !important; }
        .theme-oled .border-b { border-bottom-color: transparent !important; }
        .theme-oled .border-t { border-top-color: transparent !important; }
        .theme-oled .bg-slate-900\\/60:not(.mks-bus-marker *) { background-color: rgba(0,0,0,0.6) !important; }
        .theme-oled .bg-slate-900\\/80:not(.mks-bus-marker *) { background-color: rgba(0,0,0,0.8) !important; }
        .theme-oled .bg-slate-900\\/85:not(.mks-bus-marker *) { background-color: rgba(0,0,0,0.85) !important; }
        .theme-oled .bg-slate-800\\/40:not(.mks-bus-marker *) { background-color: rgba(5,5,5,0.4) !important; }

        /* Aurora Theme Overrides */
        .theme-aurora .bg-slate-900:not(.mks-bus-marker *) { background-color: #120f24 !important; }
        .theme-aurora .bg-slate-800:not(.mks-bus-marker *) { background-color: #1b1630 !important; }
        .theme-aurora .bg-slate-700:not(.mks-bus-marker *) { background-color: #2a2146 !important; }
        .theme-aurora .bg-slate-900\\/80:not(.mks-bus-marker *) { background-color: rgba(26,20,48,0.84) !important; }
        .theme-aurora .bg-slate-900\\/85:not(.mks-bus-marker *) { background-color: rgba(26,20,48,0.9) !important; }
        .theme-aurora .bg-slate-800\\/40:not(.mks-bus-marker *) { background-color: rgba(31,23,54,0.48) !important; }
        .theme-aurora .border-slate-700\\/50 { border-color: rgba(232,121,249,0.18) !important; }
        .theme-aurora .border-slate-700:not(.mks-bus-marker *) { border-color: rgba(167,139,250,0.26) !important; }
        .theme-aurora .text-slate-400:not(.mks-bus-marker *) { color: #c4b5fd !important; }

        /* Warm (Piaskowy) Theme Overrides */
        .theme-warm .bg-slate-50:not(.mks-bus-marker *) { background-color: #f2ede1 !important; }
        .theme-warm .bg-white:not(.mks-bus-marker *) { background-color: #faf7ef !important; }
        .theme-warm .bg-slate-100:not(.mks-bus-marker *) { background-color: #e6e0cc !important; }
        .theme-warm .bg-slate-200:not(.mks-bus-marker *) { background-color: #dad4b6 !important; }
        .theme-warm .bg-slate-900:not(.mks-bus-marker *) { background-color: #f2ede1 !important; }
        .theme-warm .border-slate-50:not(.mks-bus-marker *) { border-color: #f2ede1 !important; }
        .theme-warm .border-slate-100:not(.mks-bus-marker *) { border-color: #dcd6ba !important; }
        .theme-warm .border-slate-200:not(.mks-bus-marker *) { border-color: #cfc89f !important; }
        .theme-warm .bg-white\\/90:not(.mks-bus-marker *) { background-color: rgba(250,247,239,0.9) !important; }
        .theme-warm .bg-white\\/85:not(.mks-bus-marker *) { background-color: rgba(250,247,239,0.85) !important; }
        .theme-warm .bg-white\\/80:not(.mks-bus-marker *) { background-color: rgba(250,247,239,0.8) !important; }
        .theme-warm .bg-white\\/50:not(.mks-bus-marker *) { background-color: rgba(250,247,239,0.5) !important; }
        .theme-warm .bg-slate-900\\/80:not(.mks-bus-marker *) { background-color: rgba(242,237,225,0.8) !important; }
        .theme-warm .bg-slate-900\\/60:not(.mks-bus-marker *) { background-color: rgba(242,237,225,0.6) !important; }
        .theme-warm .text-slate-900:not(.mks-bus-marker *) { color: #3d3a2e !important; }
        .theme-warm .text-slate-500:not(.mks-bus-marker *) { color: #736e56 !important; }
        .theme-warm .bg-slate-200\\/60:not(.mks-bus-marker *) { background-color: rgba(218,212,182,0.6) !important; }
        .theme-warm .bg-slate-100\\/50:not(.mks-bus-marker *) { background-color: rgba(230,224,204,0.5) !important; }
        .theme-warm *:not(.text-rose-500):not(.text-emerald-500):not(.text-amber-500):not(.mks-bus-marker *) > .text-slate-900 { color: #3d3a2e !important; }
        .theme-warm *:not(.text-rose-500):not(.text-emerald-500):not(.text-amber-500):not(.mks-bus-marker *) > .text-slate-500 { color: #736e56 !important; }
        .theme-warm *:not(.text-rose-500):not(.text-emerald-500):not(.text-amber-500):not(.mks-bus-marker *) > .text-slate-400 { color: #918b74 !important; }
        .theme-warm .border-slate-800:not(.mks-bus-marker *) { border-color: #cfc89f !important; }
        .theme-warm .bg-slate-800:not(.mks-bus-marker *) { background-color: #dad4b6 !important; }
        .theme-warm .bg-slate-800\\/80:not(.mks-bus-marker *) { background-color: rgba(218,212,182,0.8) !important; }
        .theme-warm .bg-slate-800\\/50:not(.mks-bus-marker *) { background-color: rgba(218,212,182,0.5) !important; }
        .theme-warm .bg-slate-800\\/40:not(.mks-bus-marker *) { background-color: rgba(218,212,182,0.4) !important; }
      `}</style>
      <AnimatePresence>
        {appLoadTimedOut && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-[10000] flex items-center justify-center p-6 ${isDark ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-950'}`}
          >
            <div className={`w-full max-w-md rounded-3xl border p-8 text-center shadow-2xl ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-rose-400/20 bg-rose-500/12 text-rose-500">
                <CloudOff size={38} strokeWidth={2.4} />
              </div>
              <h1 className="text-2xl font-black tracking-tight">Przekroczono czas połączenia</h1>
              <p className="hidden">
                Aplikacja ładuje dane zbyt długo. Sprawdź internet albo spróbuj ponownie.
              </p>
              <p className="mt-5 font-mono text-base font-bold text-rose-500">ConnectionTimeoutError</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mx-auto mt-7 inline-flex h-12 min-w-56 items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-6 text-sm font-black text-white shadow-lg transition-all active:scale-95"
              >
                <RefreshCw size={20} />
                Załaduj ponownie
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ opacity: 0, y: -18, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -18, x: '-50%' }}
            className={`fixed left-1/2 top-[calc(env(safe-area-inset-top)+5rem)] z-[11000] flex items-center gap-3 rounded-2xl border px-5 py-3 shadow-2xl pointer-events-auto backdrop-blur-2xl ${isDark ? 'border-rose-400/20 bg-slate-950/88 text-white' : 'border-rose-200 bg-white/92 text-slate-950'}`}
          >
            <CloudOff className="h-5 w-5 shrink-0 text-rose-500" />
            <span className="whitespace-nowrap text-sm font-black tracking-tight">Jesteś obecnie offline</span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Main Content Area */}
      <div className={`flex-1 relative min-h-0 overflow-hidden ${isDark ? 'dark-mode-map' : ''}`}>
         
         <AnimatePresence mode="wait">
            {activeTab === 'admin' && canOpenAdminEmbed && (
               <motion.div
                  key="admin-embed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`absolute inset-0 z-[25] flex min-h-0 flex-col ${isDark ? 'bg-[#040609]' : isWarm ? 'bg-[#f2ede1]' : 'bg-slate-50'}`}
               >
                  <AdminDashboard embedded themeColor={themeColor} isDarkTheme={isDark} onExit={() => setActiveTab(isMapTabDisabled ? 'stops' : 'map')} />
               </motion.div>
            )}
         </AnimatePresence>

         {/* ============== MAP VIEW ============== */}
         <div className="absolute inset-0 z-0">
            {activeTab === 'map' && !isMapTabDisabled && shouldMountMap ? (
              <BusMap
                 vehicles={mapVehiclesEnabled ? filteredVehicles : []}
                 onVehicleClick={handleVehicleClick}
                 selectedVehicleId={selectedBus?.id}
                 selectedVehicle={selectedBus}
                 stopsData={stopsDataMap}
                 themeColor={themeColor}
                 refreshInterval={refreshInterval}
                 forcedCenter={mapCenter}
                 onCenterComplete={() => setMapCenter(null)}
                 highlightedStopId={selectedStopId}
                 onStopClick={(stopId) => {
                    setSelectedExternalStop(null);
                    setSelectedStopId(stopId);
                    setIsStopPanelExpanded(true);
                    setIsTransportPanelOpen(false);
                 }}
                 onMapClick={() => {
                     setSelectedBus(null);
                     setSelectedBusDetailsLoading(false);
                     setSelectedStopId(null);
                     setSelectedExternalStop(null);
                     setIsTransportPanelOpen(false);
                  }}
                  onViewportChange={handleMapViewportChange}
               />
            ) : activeTab === 'map' && !isMapTabDisabled ? (
              <div className="pks-map-loading-screen h-full w-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="pks-map-loading-spinner h-10 w-10 rounded-full border-4 animate-spin"></div>
                  <p className="pks-map-loading-label text-sm font-black tracking-tight">Trwa wczytywanie mapy...</p>
                </div>
              </div>
            ) : null}

            {/* Overlays for Map */}
            <div className={`absolute top-0 left-0 right-0 z-10 p-2 md:p-4 pointer-events-none flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${activeTab === 'map' ? '' : 'hidden'}`}>
              
              {/* Top Box Mobile / Desktop */}
              <div className={`${mapGlassPanel} rounded-[1.4rem] border p-3 md:p-4 flex flex-col gap-3 pointer-events-auto w-full md:w-96 transition-all`}>
                <div className="flex items-center justify-between font-extrabold text-xl tracking-tight" style={{ color: themeColor }}>
                  <div className="flex items-center gap-2">
                     <Bus className="w-5 h-5 md:w-6 md:h-6" />
                     <span className="text-lg md:text-xl">PKS Live</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <button 
                        onClick={handleManualRefresh}
                        className={`p-1.5 rounded-xl transition-all active:scale-90 relative ${transparentUI ? 'hover:bg-white/10' : (isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100')} ${isManualRefreshing ? 'text-blue-500' : (isDark ? 'text-slate-400' : 'text-slate-500')}`}
                        title="Odśwież ręcznie"
                     >
                        <RefreshCw className={`w-4 h-4 ${isManualRefreshing ? 'animate-spin' : ''}`} />
                     </button>
                     {showAlertDot ? (
                        <span className="relative flex h-2.5 w-2.5" title={error || (isOffline ? 'Offline' : 'Błąd')}>
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                        </span>
                     ) : (
                        <span className="relative flex h-2.5 w-2.5" title="LIVE">
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                     )}
                  </div>
                </div>
                
                <div className="relative shrink-0">
                  <Search className={`absolute left-3 top-2.5 h-4 w-4 opacity-60 ${textSub}`} />
                  <input
                    type="text"
                    className={`w-full py-2 pl-10 pr-10 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all font-medium placeholder-opacity-60 ${mapGlassInput}`}
                    style={{ '--tw-ring-color': themeColor + '80' } as React.CSSProperties}
                    placeholder="Filtruj linię (np. 108)..."
                    value={filterRoute}
                    onPointerDown={closeMapPanelsForSearch}
                    onFocus={closeMapPanelsForSearch}
                    onChange={(e) => setFilterRoute(e.target.value)}
                  />
                  {filterRoute && (
                     <button onClick={() => setFilterRoute('')} className={`absolute right-3 top-2.5 opacity-60 hover:opacity-100 ${textSub}`}>
                        <X className="w-4 h-4" />
                     </button>
                  )}
                </div>

              </div>

              <div className="flex w-full justify-end md:hidden pointer-events-auto -mt-2 pr-1">
                <button
                  type="button"
                  onClick={openTransportPanel}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border shadow-lg transition-all active:scale-95 ${mapGlassPanel}`}
                  title="Przewoźnicy"
                  aria-label="Przewoźnicy"
                >
                  <Bus className="h-5 w-5" />
                </button>
              </div>

              {/* Desktop Settings & Refresh Pill (Hidden on Mobile) */}
              <div className={`hidden md:flex ${mapGlassPanel} rounded-full border px-4 py-2 pointer-events-auto items-center gap-4 transition-all`}>
                 <button
                    type="button"
                    onClick={openTransportPanel}
                    className={`flex items-center gap-2 text-sm font-bold transition-colors mr-2 ${isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
                 >
                    <Bus className="h-5 w-5" /> Przewoźnicy
                 </button>
                 <div className={`w-px h-4 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                 <button 
                    disabled={isStopsTabDisabled}
                    onClick={() => {
                       if (!isStopsTabDisabled) {
                          setShouldMountMap(false);
                          setMapVehiclesEnabled(false);
                          setActiveTab('stops');
                       }
                    }}
                    className={`flex items-center gap-2 text-sm font-bold transition-colors mr-2 ${isStopsTabDisabled ? 'cursor-not-allowed opacity-40 grayscale' : (isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
                 >
                    <StopTabIcon className="h-5 w-5" /> Przystanki
                 </button>
                 {canOpenAdminEmbed && (
                    <>
                       <div className={`w-px h-4 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                       <button
                          type="button"
                          onClick={() => {
                             setShouldMountMap(false);
                             setMapVehiclesEnabled(false);
                             setActiveTab('admin');
                             setSelectedBus(null);
                             setSelectedStopId(null);
                             setSelectedExternalStop(null);
                             setIsSettingsOpen(false);
                          }}
                          className={`flex items-center gap-2 text-sm font-bold transition-colors mr-2 ${activeTab === 'admin' ? '' : (isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
                          style={activeTab === 'admin' ? { color: themeColor } : {}}
                       >
                          <Shield className="w-4 h-4" /> Admin
                       </button>
                    </>
                 )}
                 <div className={`w-px h-4 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                 <button 
                    onClick={() => setIsSettingsOpen(true)}
                    className={`p-2 -mr-2 rounded-full transition-colors border ${isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-100 text-slate-500'}`}
                    title="Ustawienia"
                 >
                    <Settings className="w-4 h-4" />
                 </button>
              </div>
            </div>

            <TransportSelectorPanel
              open={isTransportPanelOpen}
              options={transportOptions}
              selectedIds={draftProviders}
              onClose={() => setIsTransportPanelOpen(false)}
              onToggle={toggleDraftProvider}
              onApply={applyDraftProviders}
              isDark={isDark}
              themeMode={actualTheme}
              transparentUI={transparentUI}
            />

            <AnimatePresence>
              {selectedBus && selectedVehicleIsTrain ? (
                <TrainDetailsPanel
                  vehicle={selectedBus}
                  expanded={isBusPanelExpanded}
                  loading={selectedBusScheduleLoading}
                  highlightedStopId={selectedStopId}
                  onToggleExpanded={() => setIsBusPanelExpanded(!isBusPanelExpanded)}
                  onClose={() => {
                    setSelectedBus(null);
                    setSelectedStopId(null);
                    setSelectedExternalStop(null);
                  }}
                  onStopSelect={(stopId) => {
                    setSelectedExternalStop(null);
                    setSelectedStopId(stopId);
                  }}
                />
              ) : selectedBus && (
                <motion.div
                  key="bus-panel-map"
                  initial={{ y: "100%", opacity: 0.5 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "100%", opacity: 0.5 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className={`absolute bottom-[calc(64px+env(safe-area-inset-bottom))] left-0 right-0 md:bottom-4 md:left-4 md:right-auto md:w-[400px] rounded-t-3xl md:rounded-3xl border-t border-l border-r md:border z-50 overflow-hidden flex flex-col max-h-[calc(60vh-32px)] md:max-h-[85vh] md:mb-0 ${mapDetailPanel}`}
                >
                  <motion.div 
                     className="p-3 pb-5 md:p-6 md:pb-8 text-white relative shrink-0 cursor-pointer touch-none overflow-hidden" 
                     style={selectedBusHeaderStyle}
                     onClick={() => setIsBusPanelExpanded(!isBusPanelExpanded)}
                     drag="y"
                     dragConstraints={{ top: 0, bottom: 0 }}
                     dragElastic={0.1}
                     onDragEnd={(e, info) => {
                        if (info.offset.y > 20) setIsBusPanelExpanded(false);
                        else if (info.offset.y < -20) setIsBusPanelExpanded(true);
                     }}
                  >
                     <div 
                        className="w-12 h-1.5 rounded-full bg-white/40 hover:bg-white/60 mx-auto mb-3 transition-colors"
                     />
                     
                     <div className="flex items-baseline gap-2 mb-1 md:mb-1.5">
                        <span className="text-3xl md:text-5xl font-black tracking-tighter drop-shadow-sm">{selectedBus.routeShortName || '-'}</span>
                        <span className="uppercase tracking-widest text-[10px] md:text-xs font-bold text-white/90">{selectedVehicleIsTrain ? 'Pociag' : 'Linia'}</span>
                     </div>
                     <div className="pr-12 relative z-20 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm md:text-[17px] font-medium leading-tight opacity-100 drop-shadow-sm">
                       <h2 className="min-w-0">
                         {selectedVehicleIsTrain ? 'Relacja' : 'Kierunek'}: <span className="font-bold">{normalizeVehicleText(selectedBus.direction) || 'Nieustalony'}</span>
                       </h2>
                       {selectedBus.provider === 'marcel' && selectedBusStatusLabel && (
                         <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] md:text-[11px] font-black leading-none tracking-wide ${selectedBus.status === 'break' ? 'bg-amber-400 text-slate-950' : selectedBus.status === 'cached' ? 'bg-white/20 text-white' : selectedBus.status === 'technical' ? 'bg-indigo-500/80 text-white' : 'bg-white/[0.18] text-white'}`}>
                           {normalizeVehicleText(selectedBusStatusLabel)}
                         </span>
                       )}
                     </div>
                     <h3 className="text-[10px] md:text-xs font-medium leading-tight opacity-90 drop-shadow-sm mt-0.5 md:mt-1 relative z-20 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {getVehicleDisplayNumber(selectedBus) && (
                          <span className="text-white/80 uppercase tracking-[0.18em] font-semibold">
                            {selectedVehicleIsTrain ? 'Nr pociagu' : 'Nr pojazdu'}: {getVehicleDisplayNumber(selectedBus)}
                          </span>
                        )}
                        {selectedBus.provider !== 'marcel' && selectedBusStatusLabel && (
                          <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-black leading-none tracking-wide ${selectedBus.status === 'break' ? 'bg-amber-400 text-slate-950' : selectedBus.status === 'cached' ? 'bg-white/20 text-white' : selectedBus.status === 'technical' ? 'bg-indigo-500/80 text-white' : 'bg-white/[0.18] text-white'}`}>
                            {normalizeVehicleText(selectedBusStatusLabel)}
                          </span>
                        )}
                        {selectedBus.model && (
                          <span className="basis-full text-[12px] md:text-sm font-semibold leading-tight text-white/95">Model: {selectedBus.model}</span>
                        )}
                        {selectedVehicleIsTrain && selectedBusGpsSignalClock && (
                          <span className="basis-full text-[10px] md:text-xs font-semibold leading-tight text-white/85">
                            Ostatnia aktualizacja: <span className="font-black text-white">{selectedBusGpsSignalClock}</span>
                          </span>
                        )}
                        {((!selectedVehicleIsTrain && selectedBusGpsSignalClock) || (selectedBus.status === 'break' && breakCountdownLabel)) && (
                          <span className="basis-full flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] md:text-xs font-semibold leading-tight text-white/85">
                            {selectedBusGpsSignalClock && (
                              <span>Ostatni sygnał GPS: <span className="font-black text-white">{selectedBusGpsSignalClock}</span></span>
                            )}
                            {selectedBus.status === 'break' && breakCountdownLabel && (
                              <span className="inline-flex items-center rounded bg-black/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-tight text-white">
                                Odjazd za: {breakCountdownLabel}
                              </span>
                            )}
                          </span>
                        )}
                     </h3>
                  </motion.div>
                  
                  <AnimatePresence initial={false}>
                    {isBusPanelExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 35 }}
                        className="flex flex-col min-h-0 overflow-hidden"
                      >
                        <div className={`p-2.5 md:p-4 flex flex-col gap-2.5 md:gap-4 overflow-y-auto mt-1.5 md:mt-2 rounded-t-xl md:rounded-t-2xl relative z-10 ${mapDetailContent}`}>
                        <div className="grid grid-cols-2 gap-2 md:gap-4 shrink-0">
                        <div className={`flex flex-col justify-center p-2.5 md:p-3 rounded-xl md:rounded-2xl border ${mapDetailCard} ${selectedBusIsWaitingForDeparture ? 'col-span-2' : ''}`}>
                           <div className={`flex items-center gap-1.5 md:gap-2 text-[9px] md:text-[10px] font-bold uppercase tracking-wider mb-0.5 md:mb-1 ${textSub}`}>
                              <Navigation className="w-3 h-3 md:w-3.5 md:h-3.5" /> Prędkość
                           </div>
                           <span className={`text-base md:text-lg font-medium tracking-tight ${textMain}`}>
                              {selectedVehicleIsTrain
                                ? (Number.isFinite(selectedBus.speed)
                                    ? `${Math.round(selectedBus.speed || 0)} km/h`
                                    : 'Brak danych')
                                : Number.isFinite(selectedBus.speed)
                                  ? `${Math.round(selectedBus.speed || 0)} km/h`
                                  : 'Brak danych'}
                           </span>
                        </div>
                        
                        {!selectedBusIsWaitingForDeparture && (
                        <div className={`flex flex-col justify-center p-2.5 md:p-3 rounded-xl md:rounded-2xl border ${mapDetailCard}`}>
                              <div className={`flex items-center gap-1.5 md:gap-2 text-[9px] md:text-[10px] font-bold uppercase tracking-wider mb-0.5 md:mb-1 ${textSub}`}>
                                 <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" /> Punktualność
                              </div>
                              {(() => {
                                 let d = selectedBus.delay || 0;
                                 if (Math.abs(d) > 18000) d = 0; // Ignore absurd delays (e.g. > 5 hours) to prevent UI breakage
                                 const m = Math.floor(Math.abs(d) / 60);
                                 if (m === 0) return (
                                   <div className={`flex flex-col items-start ${textMain}`}>
                                     <span className="text-sm md:text-base font-bold leading-tight">Zgodnie z planem</span>
                                   </div>
                                 );
                                 if (d < 0) return (
                                   <div className="flex flex-col text-emerald-500 items-start">
                                     <div className="flex items-baseline gap-1">
                                       <span className="text-xl font-bold leading-none">{m}</span>
                                       <span className="text-sm font-medium">min</span>
                                     </div>
                                     <span className="text-[10px] font-bold uppercase tracking-wider mt-1 opacity-90">Przed czasem</span>
                                   </div>
                                 );
                                 return (
                                   <div className="flex flex-col text-rose-500 items-start">
                                     <div className="flex items-baseline gap-1">
                                       <span className="text-xl font-bold leading-none">{m}</span>
                                       <span className="text-sm font-medium">min</span>
                                     </div>
                                     <span className="text-[10px] font-bold uppercase tracking-wider mt-1 opacity-90">Opóźniony</span>
                                   </div>
                                 );
                              })()}
                           </div>
                        )}
                      </div>
                      
                      {(selectedBusScheduleLoading || selectedBusUpcomingSchedule.length > 0) && (
                       <div className={`flex flex-col gap-2 mt-1 border-t pt-4 ${mapDetailDivider}`}>
                          <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${textSub}`}>
                            <MapPin className="w-4 h-4" /> Nadchodzące przystanki
                          </h3>
                          <div className="flex flex-col gap-0 relative">
                             <div className={`absolute left-[9px] top-4 bottom-4 w-0.5 ${mapDetailLine}`}></div>
                             {selectedBusScheduleLoading ? (
                                [0, 1, 2].map((idx) => (
                                  <div key={`mpk-stops-loading-${idx}`} className="flex items-start gap-4 py-2 relative z-10 px-2 -mx-2">
                                     <div className="w-5 h-5 rounded-full border-4 shrink-0 mt-0.5 shadow-sm animate-pulse" style={{ backgroundColor: selectedVehicleColor, borderColor: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.85)' }}></div>
                                     <div className={`flex flex-col flex-1 pb-2 border-b ${mapDetailDivider}`}>
                                        <div className={`h-3.5 w-36 rounded-full animate-pulse ${isDark ? 'bg-white/12' : 'bg-slate-200'}`}></div>
                                        <div className={`mt-2 h-2.5 w-16 rounded-full animate-pulse ${isDark ? 'bg-white/8' : 'bg-slate-100'}`}></div>
                                     </div>
                                  </div>
                                ))
                             ) : selectedBusUpcomingSchedule.map((sch: any, idx: number) => {
                                const parsedRealTime = sch.real ? new Date(sch.real) : null;
                                const realTimeRaw = parsedRealTime && !Number.isNaN(parsedRealTime.getTime()) ? parsedRealTime : null;
                                const parsedPlannedTime = sch.planned ? new Date(sch.planned) : null;
                                const plannedTime = parsedPlannedTime && !Number.isNaN(parsedPlannedTime.getTime()) ? parsedPlannedTime : null;
                                const busDelaySec = Number(selectedBus.delay);
                                const canUseBusDelay =
                                   selectedBus.status !== 'break' &&
                                   selectedBus.status !== 'inactive' &&
                                   Number.isFinite(busDelaySec) &&
                                   Math.abs(busDelaySec) <= 18000;
                                const computedDelayTime = plannedTime && canUseBusDelay && busDelaySec !== 0 ? new Date(plannedTime.getTime() + (busDelaySec * 1000)) : null;
                                const rawLooksPlanned = Boolean(realTimeRaw && plannedTime && Math.abs(realTimeRaw.getTime() - plannedTime.getTime()) < 60_000);
                                const realTime = rawLooksPlanned ? (computedDelayTime || realTimeRaw) : (realTimeRaw || computedDelayTime);
                                const displayTime = realTime || plannedTime;
                                let delayMin = 0;
                                if (realTime && plannedTime) delayMin = Math.round((realTime.getTime() - plannedTime.getTime()) / 60000);
                                const busDelayMin = canUseBusDelay && busDelaySec !== 0
                                  ? Math.round(busDelaySec / 60)
                                  : delayMin;
                                const formatTime = (time: Date) => {
                                   const isTomorrow = time.getDate() !== new Date().getDate();
                                   const mm = time.getMinutes().toString().padStart(2, '0');
                                   const hh = time.getHours().toString().padStart(2, '0');
                                   if (isTomorrow) {
                                      const dd = time.getDate().toString().padStart(2, '0');
                                      const mo = (time.getMonth() + 1).toString().padStart(2, '0');
                                      return `${dd}.${mo} ${hh}:${mm}`;
                                   }
                                   return `${hh}:${mm}`;
                                };
                                const timeStr = displayTime ? formatTime(displayTime) : '';
                                const timeClass = busDelayMin > 0 ? 'text-rose-500' : busDelayMin < 0 ? 'text-emerald-500' : textMain;
                                const isHighlighted = sch.id?.toString() === selectedStopId;
                                const isPastStop = Boolean(sch.isPast);
                                const stopName = formatScheduleStopName(sch.name, selectedBus.provider);
                                if (!stopName) {
                                  return (
                                    <div key={`stop-name-loading-${sch.id || idx}-${idx}`} className="flex items-start gap-4 py-2 relative z-10 px-2 -mx-2">
                                       <div className="w-5 h-5 rounded-full border-4 shrink-0 mt-0.5 shadow-sm animate-pulse" style={{ backgroundColor: selectedVehicleColor, borderColor: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.85)' }}></div>
                                       <div className={`flex flex-col flex-1 pb-2 border-b ${mapDetailDivider}`}>
                                          <div className={`h-3.5 w-40 rounded-full animate-pulse ${isDark ? 'bg-white/12' : 'bg-slate-200'}`}></div>
                                          <div className={`mt-2 h-2.5 w-16 rounded-full animate-pulse ${isDark ? 'bg-white/8' : 'bg-slate-100'}`}></div>
                                       </div>
                                    </div>
                                  );
                                }
                                return (
                                  <div 
                                     key={`${sch.id || idx}-${idx}`} 
                                     onClick={() => {
                                       if (sch.id) {
                                         setSelectedExternalStop(null);
                                         setSelectedStopId(sch.id.toString());
                                       }
                                     }}
                                     className={`flex items-start gap-4 py-2 relative z-10 cursor-pointer transition-colors hover:bg-slate-500/10 rounded-xl px-2 -mx-2 ${isHighlighted ? (isDark ? 'bg-amber-500/20' : 'bg-amber-100') : ''} ${isPastStop ? 'opacity-50' : ''}`}
                                  >
                                     <div className={`w-5 h-5 rounded-full border-4 shrink-0 mt-0.5 shadow-sm leading-none transition-colors ${isHighlighted ? 'border-red-500' : (isDark ? 'border-slate-800/80' : 'border-white/85')}`} style={{ backgroundColor: isHighlighted ? selectedVehicleColor : (isPastStop ? '#94a3b8' : selectedVehicleColor) }}></div>
                                     <div className={`flex flex-col flex-1 pb-2 border-b ${mapDetailDivider} ${isHighlighted ? 'border-transparent' : ''}`}>
                                        <span className={`text-[13px] font-semibold leading-tight pr-2 ${textMain}`}>{stopName}</span>
                                        {timeStr && (
                                          <div className="flex items-center gap-2 mt-1">
                                             <span className={`text-xs font-bold font-mono ${timeClass}`}>{timeStr}</span>
                                          </div>
                                        )}
                                     </div>
                                  </div>
                                );
                              })}
                          </div>
                       </div>
                     )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

              {/* New Stop Overlay on Map */}
              <AnimatePresence>
                {activeTab === 'map' && selectedStopId && !selectedBus && (
                  <motion.div
                    key="stop-panel-map"
                    initial={{ y: "100%", opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: "100%", opacity: 0 }}
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    drag="y"
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={0.2}
                    onDragEnd={(e, info) => {
                       const swipeThreshold = 50;
                       if (info.offset.y > swipeThreshold) {
                          if (isStopPanelExpanded) setIsStopPanelExpanded(false);
                          else {
                            setSelectedStopId(null);
                            setSelectedExternalStop(null);
                          }
                       } else if (info.offset.y < -swipeThreshold) {
                          if (!isStopPanelExpanded) setIsStopPanelExpanded(true);
                       }
                    }}
                    className={`absolute bottom-[calc(64px+env(safe-area-inset-bottom))] left-0 right-0 md:bottom-4 md:left-4 md:right-auto md:w-[380px] rounded-t-[32px] md:rounded-[32px] border-t border-l border-r md:border z-40 overflow-hidden flex flex-col max-h-[calc(55vh-32px)] md:max-h-[85vh] ${mapDetailPanel}`}
                  >
                     {/* Header */}
                     <motion.div 
                        className="p-4 pb-6 text-white relative shrink-0 cursor-pointer" 
                        style={{
                          background: transparentUI
                            ? `linear-gradient(135deg, ${withAlpha(themeColor, 0.9)}, ${withAlpha(themeColor, 0.68)})`
                            : themeColor,
                        }}
                        onClick={() => setIsStopPanelExpanded(!isStopPanelExpanded)}
                     >
                        <div 
                           className="w-12 h-1.5 rounded-full bg-white/30 hover:bg-white/50 mx-auto mb-4 transition-colors relative z-[51]"
                        />
                        <div className="flex justify-between items-start mt-2 px-1">
                           <h2 className="text-2xl md:text-3xl font-black leading-tight drop-shadow-md pr-4">
                              {selectedExternalStop?.name || stopsList.find(s => s.id === selectedStopId)?.name || 'Przystanek'}
                           </h2>

                           <div className="flex items-center gap-2 relative z-[51]"></div>
                        </div>
                     </motion.div>

                     {/* Content */}
                     <AnimatePresence initial={false}>
                       {isStopPanelExpanded && (
                         <motion.div
                           initial={{ height: 0, opacity: 0 }}
                           animate={{ height: 'auto', opacity: 1 }}
                           exit={{ height: 0, opacity: 0 }}
                           transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                           className="flex flex-col min-h-0 overflow-hidden"
                         >
                            <div className={`flex flex-col overflow-hidden mt-3 rounded-[28px] relative z-10 shadow-2xl ${mapDetailContent}`}>
                               <div 
                                  className="overflow-y-auto custom-scrollbar px-4 md:px-5"
                                  onPointerDown={(e) => e.stopPropagation()}
                               >
                                  <div className="flex flex-col gap-2 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-5 md:pb-12">
                                     <div className={`mb-1 flex items-center gap-2 px-1 text-xs font-black uppercase tracking-[0.14em] ${textSub}`}>
                                       <Clock className="h-4 w-4" />
                                       Najbliższe odjazdy
                                     </div>
                                     {isFetchingDepartures ? (
                                        <div className="p-12 text-center flex flex-col items-center">
                                           <div className="w-10 h-10 mb-5 border-3 rounded-full animate-spin" style={{ borderColor: `${themeColor}20`, borderTopColor: themeColor }}></div>
                                           <p className={`text-sm font-bold tracking-tight ${textMain}`}>Pobieranie rozkładu...</p>
                                           <p className={`text-xs mt-1 ${textSub}`}>To może chwilę potrwać</p>
                                        </div>
                                     ) : processedDepartures.length === 0 ? (
                                        <div className={`p-10 rounded-[32px] border-2 border-dashed text-center ${transparentUI ? (isDark ? 'border-white/10 bg-[#05080c]/92' : 'border-slate-900/10 bg-white/94') : (isDark ? 'border-slate-800' : 'border-slate-200')}`}>
                                           <p className={`text-base font-bold ${textMain}`}>Brak odjazdów</p>
                                           <p className={`text-xs mt-1 ${textSub}`}>Sprawdź inne godziny lub dni</p>
                                         </div>
                                       ) : (
                                          (() => {
                                             const elements: any[] = [];
                                             let lastDayStr = '';
                                             const todayStr = new Date(now).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
                                             
                                             processedDepartures.slice(0, 40).forEach((inc: any, idx: number) => {
                                                const d = new Date(Number.isFinite(inc.plannedTimeMs) ? inc.plannedTimeMs : inc.depTimeMs);
                                                const dayStr = d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
                                                
                                                if (dayStr !== lastDayStr && dayStr !== todayStr.toUpperCase()) {
                                                   elements.push(
                                                      <div key={`day-marker-${idx}`} className={`mt-8 mb-5 text-[11px] font-black uppercase tracking-[0.15em] opacity-40 ml-1 ${textSub}`}>
                                                         {dayStr}
                                                      </div>
                                                   );
                                                }
                                                lastDayStr = dayStr;
                                                const lineColor = inc.providerId === 'mpk_rzeszow'
                                                   ? MPK_RZESZOW_COLOR
                                                   : inc.providerId === 'marcel'
                                                     ? MARCEL_COLOR
                                                     : PKS_COLOR;
                                                
                                                elements.push(
                                                   <div key={idx} className={`flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.97] ${mapDetailCard} ${transparentUI ? 'hover:bg-white/10' : (isDark ? 'hover:bg-slate-800/60' : 'hover:bg-white hover:shadow-md')}`}>
                                                      <div className="flex items-center gap-4">
                                                         <div className="min-w-[50px] px-3 py-1.5 rounded-xl text-white font-black text-sm text-center shadow-md grow-0" style={{ backgroundColor: lineColor }}>
                                                            {String(inc.bus.routeShortName || '').trim().replace(/^MKS\s+/, '')}
                                                         </div>
                                                         <div className="flex flex-col">
                                                            <span className={`text-[15px] font-bold leading-tight ${textMain} max-w-[190px] md:max-w-none truncate`}>{inc.bus.direction}</span>
                                                         </div>
                                                      </div>
                                                      <div className="flex flex-col items-end">
                                                         <span className={`text-base font-black ${inc.diffMin <= 5 && inc.diffMin >= -1 ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : textMain}`}>
                                                            {inc.diffMin <= 0 && inc.diffMin >= -1 ? 'Teraz' : (inc.diffMin > 0 && inc.diffMin <= 30 ? `${inc.diffMin} min` : inc.actualTimeStr)}
                                                         </span>
                                                      </div>
                                                   </div>
                                                );
                                             });
                                             return elements;
                                          })()
                                       )}
                                   </div>
                               </div>
                            </div>
                         </motion.div>
                       )}
                     </AnimatePresence>

                  </motion.div>
                )}
              </AnimatePresence>

            </div>
         {/* ============== NEW STOPS VIEW ============== */}
         <motion.div
            key="new-stops-panel"
            initial={false}
            animate={activeTab === 'stops' ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 14, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 700, damping: 35 }}
            className={`absolute inset-0 z-10 overflow-hidden ${activeTab === 'stops' ? 'pointer-events-auto' : 'pointer-events-none'} ${
               transparentUI
                 ? 'bg-slate-950/88 backdrop-blur-2xl backdrop-saturate-150 before:pointer-events-none before:absolute before:inset-0 before:bg-white/[0.025] before:content-[""]'
                 : 'bg-[#03060a]'
            }`}
            aria-hidden={activeTab !== 'stops'}
         >
            <StopsPanel
               stops={stopsList}
               isLoading={stopsList.length === 0 && !stopsLoadError}
               hasError={stopsLoadError}
               favorites={favsState}
               vehicles={vehicles}
               transparentUI={transparentUI}
               isDarkTheme={isDark}
               onRetry={loadStops}
               onClose={() => { if (!isMapTabDisabled) setActiveTab('map'); }}
               onToggleFavorite={toggleFavoriteStop}
               onShowOnMap={(stop) => {
                  if (isMapTabDisabled) return;
                  if (stop.lat !== undefined && stop.lon !== undefined) {
                     setMapCenter([stop.lat, stop.lon]);
                  }
                  setSelectedBus(null);
                  setSelectedExternalStop(stop);
                  setSelectedStopId(stop.id);
                  setActiveTab('map');
               }}
            />
         </motion.div>

      </div>

         {/* Bottom Navigation for Mobile */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[5000] md:hidden">
         <div className={`pointer-events-auto flex h-[calc(64px+env(safe-area-inset-bottom))] w-full items-center justify-around border-t pb-[env(safe-area-inset-bottom)] transition-colors ${bottomGlassShell}`}>
            <button 
               disabled={isMapTabDisabled}
               onClick={() => { if (!isMapTabDisabled) { setActiveTab('map'); setSelectedBus(null); setSelectedStopId(null); setSelectedExternalStop(null); } }}
               className={`relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1.5 transition-colors ${isMapTabDisabled ? 'cursor-not-allowed opacity-35 grayscale' : activeTab === 'map' ? '' : 'hover:text-current/90'}`}
               style={activeTab === 'map' ? { color: themeColor } : {}}
            >
               <MapIcon className="h-6 w-6" />
               <span className="text-[11px] font-semibold leading-none">Mapa</span>
               {activeTab === 'map' && <span className="absolute top-0 h-0.5 w-10 rounded-full" style={{ backgroundColor: themeColor }} />}
            </button>
            <button 
               disabled={isStopsTabDisabled}
               onClick={() => {
                  if (!isStopsTabDisabled) {
                     setShouldMountMap(false);
                     setMapVehiclesEnabled(false);
                     setActiveTab('stops');
                     setSelectedBus(null);
                  }
               }}
               className={`relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1.5 transition-colors ${isStopsTabDisabled ? 'cursor-not-allowed opacity-35 grayscale' : activeTab === 'stops' ? '' : 'hover:text-current/90'}`}
               style={activeTab === 'stops' ? { color: themeColor } : {}}
            >
               <StopTabIcon className="h-6 w-6" />
               <span className="text-[11px] font-semibold leading-none">Przystanki</span>
               {activeTab === 'stops' && <span className="absolute top-0 h-0.5 w-10 rounded-full" style={{ backgroundColor: themeColor }} />}
            </button>
            {canOpenAdminEmbed && (
               <button 
                  type="button"
                  onClick={() => {
                     setShouldMountMap(false);
                     setMapVehiclesEnabled(false);
                     setActiveTab('admin');
                     setSelectedBus(null);
                     setSelectedStopId(null);
                     setSelectedExternalStop(null);
                     setIsSettingsOpen(false);
                  }}
                  className={`relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1.5 transition-colors ${activeTab === 'admin' ? '' : 'hover:text-current/90'}`}
                  style={activeTab === 'admin' ? { color: themeColor } : {}}
               >
                  <Shield className="h-6 w-6" />
                  <span className="text-[11px] font-semibold leading-none">Admin</span>
                  {activeTab === 'admin' && <span className="absolute top-0 h-0.5 w-10 rounded-full" style={{ backgroundColor: themeColor }} />}
               </button>
            )}
            <button 
               onClick={() => setIsSettingsOpen(true)}
               className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1.5 transition-colors hover:text-current/90"
            >
               <Settings className="h-6 w-6" />
               <span className="text-[11px] font-semibold leading-none">Opcje</span>
            </button>
         </div>
      </div>

      {/* Settings Modal (Overlay) */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`absolute inset-0 z-[6000] flex items-end justify-center backdrop-blur-sm md:items-center md:p-6 ${optionsOverlay}`}
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div 
               initial={{ y: "100%", opacity: 0, scale: 0.98 }}
               animate={{ y: 0, opacity: 1, scale: 1 }}
               exit={{ y: "100%", opacity: 0, scale: 0.96 }}
               transition={{ type: "spring", stiffness: 700, damping: 35 }}
               className={`w-full max-w-2xl max-h-[92vh] pointer-events-auto overflow-hidden rounded-t-[2rem] border-t px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 backdrop-blur-3xl md:max-w-[560px] md:rounded-[1.75rem] md:border md:p-6 ${optionsSheet}`}
            >
               <div className="mb-5 flex items-center justify-between md:mb-6">
                  <h2 className="text-2xl font-light tracking-tight md:text-2xl">Opcje aplikacji</h2>
                  <button onClick={() => setIsSettingsOpen(false)} className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors md:h-11 md:w-11 ${isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-slate-900/8 hover:bg-slate-900/12'}`}>
                     <X className="h-6 w-6" />
                  </button>
               </div>
               
               <div className="flex max-h-[calc(92vh-7rem)] w-full flex-col gap-4 overflow-y-auto relative z-0 pr-1 md:max-h-[70vh]">
                  
                  {/* Appearance Bento Box */}
                  <div className={`rounded-[1.45rem] border p-4 md:p-5 ${optionsCard}`}>
                     <h3 className={`mb-4 px-1 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-violet-200' : isWarm ? 'text-[#746a58]' : 'text-slate-500'}`}>Wygląd i kolory</h3>
                     
                     <div className="mb-4 grid grid-cols-2 gap-3">
                        {[
                           { id: 'system', name: 'Systemowy', icon: <Monitor className="w-4 h-4 mr-1.5" /> },
                           { id: 'light', name: 'Jasny', icon: <Sun className="w-4 h-4 mr-1.5" /> },
                           { id: 'light-warm', name: 'Piaskowy', icon: <Sun className="w-4 h-4 mr-1.5" /> },
                           { id: 'dark', name: 'Ciemny', icon: <Moon className="w-4 h-4 mr-1.5" /> },
                           { id: 'dark-oled', name: 'AMOLED', icon: <Moon className="w-4 h-4 mr-1.5" /> },
                           { id: 'dark-aurora', name: 'Aurora', icon: <Sparkles className="w-4 h-4 mr-1.5" /> }
                        ].map(mode => (
                           <button
                              key={mode.id}
                              onClick={() => saveAppTheme(mode.id)}
                              className={`flex h-14 items-center justify-center rounded-2xl text-base font-semibold transition-all border md:h-12 md:text-sm ${appTheme === mode.id ? 'shadow-[0_0_24px_rgba(0,163,162,0.16)]' : 'border-transparent'} ${optionsButton}`}
                              style={appTheme === mode.id ? { borderColor: themeColor, color: themeColor } as React.CSSProperties : {}}
                           >
                              {mode.icon}
                              {mode.name}
                           </button>
                        ))}
                     </div>

                     <div className={`flex items-center justify-between rounded-3xl p-3 ${isDark ? 'bg-white/[0.04]' : 'bg-slate-900/[0.045]'}`}>
                        {[
                           { name: 'Teal', hex: '#00A3A2' },
                           { name: 'Blue', hex: '#3b82f6' },
                           { name: 'Purple', hex: '#8b5cf6' },
                           { name: 'Rose', hex: '#f43f5e' },
                           { name: 'Amber', hex: '#f59e0b' }
                        ].map(color => (
                           <button
                              key={color.name}
                              onClick={() => saveThemeColor(color.hex)}
                              className={`h-12 w-12 rounded-2xl transition-all md:h-10 md:w-10 ${themeColor === color.hex ? 'ring-4 ring-white scale-105 shadow-lg' : 'hover:scale-105'}`}
                              style={{ backgroundColor: color.hex, '--tw-ring-color': isDark ? '#ffffff' : color.hex, '--tw-ring-offset-color': isDark ? '#1e293b' : '#ffffff' } as React.CSSProperties}
                              title={color.name}
                           />
                        ))}
                     </div>
                  </div>

                  {/* Settings Bento Box */}
                  <div className="flex flex-col gap-5">
                     <label className={`flex cursor-pointer items-center justify-between rounded-[1.45rem] border p-4 transition-colors md:p-5 ${optionsCard}`}>
                        <div className="flex min-w-0 items-center gap-4 pr-4">
                           <Sparkles className="h-7 w-7 shrink-0" style={{ color: themeColor }} />
                           <div className="flex flex-col">
                              <span className="text-base font-semibold md:text-base">Efekt przezroczystości UI</span>
                              <span className={`mt-1.5 text-xs leading-relaxed ${textSub}`}>Rozmycie tła interfejsu (starsze urządzenia mogą zwolnić)</span>
                           </div>
                        </div>
                        <div className={`relative h-9 w-16 flex-shrink-0 rounded-full transition-colors ${transparentUI ? '' : (isDark ? 'bg-white/12' : 'bg-slate-300')}`} style={{ backgroundColor: transparentUI ? themeColor : '' }}>
                           <div className={`absolute left-1 top-1 h-7 w-7 rounded-full bg-white shadow-md transition-transform ${transparentUI ? 'translate-x-7' : ''}`}></div>
                        </div>
                        <input type="checkbox" className="hidden" checked={transparentUI} onChange={(e) => saveTransparentUI(e.target.checked)} />
                     </label>
                     
                     <label className={`flex cursor-pointer items-center justify-between rounded-[1.45rem] border p-4 transition-colors md:p-5 ${optionsCard}`}>
                        <div className="flex min-w-0 items-center gap-4 pr-4">
                           <Bus className={`h-7 w-7 shrink-0 ${isDark ? 'text-white/90' : 'text-slate-700'}`} />
                           <div className="flex flex-col">
                              <span className="text-base font-semibold md:text-base">Pokaż autobusy bez przypisanej linii</span>
                              <span className={`mt-1.5 text-xs leading-relaxed ${textSub}`}>Pojazdy bez aktywnego kursu oraz ich ostatnia zapisana pozycja</span>
                           </div>
                        </div>
                        <div className={`relative h-9 w-16 flex-shrink-0 rounded-full transition-colors ${showInactive ? '' : (isDark ? 'bg-white/12' : 'bg-slate-300')}`} style={{ backgroundColor: showInactive ? themeColor : '' }}>
                           <div className={`absolute left-1 top-1 h-7 w-7 rounded-full bg-white shadow-md transition-transform ${showInactive ? 'translate-x-7' : ''}`}></div>
                        </div>
                        <input type="checkbox" className="hidden" checked={showInactive} onChange={(e) => saveInactive(e.target.checked)} />
                     </label>
                  </div>

               </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
