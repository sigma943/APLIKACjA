'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import StopList from '@/Panel/src/components/StopList';
import BusStopDetail from '@/Panel/src/components/BusStopDetail';
import type { Carrier, Departure, Stop } from '@/Panel/src/types';
import {
  fetchDeparturesClient,
  fetchMarcelCoursesClient,
  fetchMarcelPublicCourseStopsClient,
  fetchMarcelRoutesClient,
  fetchMpkRzeszowDeparturesClient,
  fetchMpkRzeszowStopsClient,
  fetchPksStopLinesClient,
  fetchVehicleDetailsClient,
  type MarcelCourse,
  type MarcelCourseStopPublic,
  type TransportProviderId,
} from '@/lib/pks-client';
import type { Vehicle } from '@/components/BusMap';

type RawStop = {
  id: string;
  name: string;
  areaId?: string;
  code?: string;
  lat?: number;
  lon?: number;
  lines?: string[];
};

interface StopsPanelProps {
  stops: RawStop[];
  isLoading: boolean;
  hasError: boolean;
  favorites: string[];
  vehicles: Vehicle[];
  transparentUI: boolean;
  isDarkTheme: boolean;
  themeMode?: string;
  onRetry: () => void;
  onClose: () => void;
  onToggleFavorite: (stopId: string) => void;
  onShowOnMap: (stop: Stop) => void;
}

const PKS_CARRIER: Carrier = {
  id: 'pks',
  name: 'PKS Rzeszow',
  colorClass: 'text-teal-400',
  borderClass: 'border-teal-400/30',
  bgClass: 'bg-teal-400/10',
  dotClass: 'bg-teal-400',
};

const MARCEL_CARRIER: Carrier = {
  id: 'marcel',
  name: 'Marcel',
  colorClass: 'text-lime-400',
  borderClass: 'border-lime-400/30',
  bgClass: 'bg-lime-400/10',
  dotClass: 'bg-lime-400',
};

const MPK_CARRIER: Carrier = {
  id: 'mpk',
  name: 'MPK Rzeszow',
  colorClass: 'text-orange-500',
  borderClass: 'border-orange-500/30',
  bgClass: 'bg-orange-500/10',
  dotClass: 'bg-orange-500',
};

type MarcelIndexedStop = {
  id: string;
  name: string;
  matchName: string;
  matchKey: string;
  lat?: number;
  lon?: number;
  routeIds: string[];
};

type InternalStop = Stop & {
  lineSet: Set<string>;
  carrierMap: Map<string, Carrier>;
  baseNameKey: string;
  displayNamesByProvider: Record<string, string>;
};

type StopsSearchState = {
  inputValue: string;
  fullInputValue: string;
  carrierFilter: 'all' | 'pks' | 'mpk' | 'marcel';
  visibleFullCount: number;
};

const TOKEN_CACHE = new Map<string, string[]>();
const NUM_TOKEN_CACHE = new Map<string, Set<string>>();
const MARCEL_STOPS_INDEX_CACHE = new Map<string, Promise<MarcelIndexedStop[]>>();
const LIVE_DETAILS_TTL_MS = 90_000;
const LIVE_DELAY_LIMIT_SECONDS = 18_000;
const LIVE_DEPARTURE_MATCH_WINDOW_MS = 8 * 60_000;
const MPK_LIVE_DEPARTURE_MATCH_WINDOW_MS = 30 * 60_000;
const LIVE_DETAILS_CACHE = new Map<string, { expiresAt: number; promise: Promise<Vehicle | null> }>();
const STOP_CACHE_VERSION = 8;
const STOP_CACHE_TTL_MS = 15 * 60 * 1000;
const MARCEL_STOPS_PERSISTENT_PREFIX = 'pks-live:marcel-stops-index:v7:';
const PKS_LINES_INDEX_PERSISTENT_PREFIX = 'pks-live:pks-lines-index:v1:';
const MERGED_STOPS_RUNTIME_CACHE = new Map<string, Stop[]>();
const MERGED_STOPS_RUNTIME_CACHE_LIMIT = 3;
const GEO_BUCKET_PRECISION = 0.001;

type LiveDepartureProvider = 'pks' | 'mpk_rzeszow' | 'marcel';

type LiveDepartureCorrection = {
  key: string;
  provider: LiveDepartureProvider;
  line: string;
  stopId: string;
  plannedAtMs: number;
  realAtMs: number;
  delayMins: number;
  vehicleDesc?: string;
};

function cleanLine(value: unknown) {
  return String(value || '').trim().replace(/^MKS\s+/i, '');
}

function isHiddenMpkLine(value: unknown) {
  return /^N\d+[A-Z]?$/i.test(cleanLine(value));
}

function normalizeLineKey(value: unknown) {
  return cleanLine(value).toUpperCase().replace(/\s+/g, '');
}

function parseDateMs(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const parsed = new Date(raw.replace(' ', 'T')).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function providerFromVehicle(vehicle: Vehicle): LiveDepartureProvider | null {
  const provider = String(vehicle.provider || 'pks');
  if (provider === 'pks' || provider === 'mpk_rzeszow' || provider === 'marcel') return provider;
  return null;
}

function providerFromDeparture(departure: Departure): LiveDepartureProvider | null {
  if (departure.carrier?.id === 'pks') return 'pks';
  if (departure.carrier?.id === 'mpk') return 'mpk_rzeszow';
  if (departure.carrier?.id === 'marcel') return 'marcel';
  return null;
}

function stopIdsForLiveProvider(stop: Stop, provider: LiveDepartureProvider) {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    splitCsvValues(value).forEach((normalized) => ids.add(normalized));
  };

  add(stop.id);
  if (provider === 'pks') add(stop.providerStopIds?.pks);
  if (provider === 'mpk_rzeszow') add(stop.providerStopIds?.mpk_rzeszow);
  if (provider === 'marcel') add(stop.providerStopIds?.marcel);
  return ids;
}

function vehicleHasLiveStop(vehicle: Vehicle, stopIds: Set<string>) {
  return [...(vehicle.schedule || []), ...(vehicle.routeStops || [])].some((entry) =>
    stopIds.has(String(entry.id || '').trim()),
  );
}

function liveVehicleCandidateScore(vehicle: Vehicle, stopIds: Set<string>) {
  const hasStop = vehicleHasLiveStop(vehicle, stopIds) ? 1000 : 0;
  const hasDetails = (vehicle.schedule?.length || 0) + (vehicle.routeStops?.length || 0);
  const freshness = Math.max(0, 240 - Number(vehicle.dataAgeSec || 0));
  return hasStop + Math.min(hasDetails, 80) + freshness;
}

function vehicleDisplayNumber(vehicle: Vehicle) {
  return String(vehicle.vehicleNumber || vehicle.id || '')
    .replace(/^(mpk_rzeszow|marcel)_/, '')
    .trim();
}

function mergeVehicleSnapshot(base: Vehicle, details: Vehicle | null) {
  if (!details) return base;
  return {
    ...base,
    ...details,
    schedule: details.schedule?.length ? details.schedule : base.schedule,
    routeStops: details.routeStops?.length ? details.routeStops : base.routeStops,
    routePath: details.routePath?.length ? details.routePath : base.routePath,
    delay: Number.isFinite(Number(details.delay)) ? details.delay : base.delay,
  };
}

function fetchCachedVehicleDetails(provider: LiveDepartureProvider, vehicle: Vehicle) {
  const key = `${provider}:${vehicle.id}`;
  const now = Date.now();
  const cached = LIVE_DETAILS_CACHE.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchVehicleDetailsClient(provider as TransportProviderId, vehicle.id, true).catch(() => null);
  LIVE_DETAILS_CACHE.set(key, { expiresAt: now + LIVE_DETAILS_TTL_MS, promise });

  if (LIVE_DETAILS_CACHE.size > 160) {
    const firstKey = LIVE_DETAILS_CACHE.keys().next().value;
    if (firstKey) LIVE_DETAILS_CACHE.delete(firstKey);
  }

  return promise;
}

const TEXT_ENCODING_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Ăł/g, 'ó'],
  [/Ă“/g, 'Ó'],
  [/Ä…/g, 'ą'],
  [/Ä„/g, 'Ą'],
  [/Ä‡/g, 'ć'],
  [/Ä/g, 'ć'],
  [/ÄĆ/g, 'Ć'],
  [/Ä™/g, 'ę'],
  [/Ä/g, 'Ę'],
  [/Ĺ‚/g, 'ł'],
  [/Ĺ/g, 'Ł'],
  [/Ĺ„/g, 'ń'],
  [/Ĺ/g, 'Ń'],
  [/Ĺ›/g, 'ś'],
  [/Ĺš/g, 'Ś'],
  [/Ĺş/g, 'ź'],
  [/Ĺą/g, 'Ź'],
  [/ĹĽ/g, 'ż'],
  [/Ĺ»/g, 'Ż'],
  [/Â/g, ''],
];

function repairTextEncoding(value: unknown) {
  let text = String(value || '');
  TEXT_ENCODING_REPLACEMENTS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });
  return text;
}

function normalizeStopName(value: unknown) {
  return repairTextEncoding(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bdw\.\b/g, 'dworzec')
    .replace(/\bul\.\b/g, 'ulica')
    .replace(/\bal\.\b/g, 'aleja')
    .replace(/\bpl\.\b/g, 'plac')
    .replace(/\bos\.\b/g, 'osiedle')
    .replace(/\s+/g, ' ');
}

const TECHNICAL_TERMS = [
  'zjazd',
  'zajezd',
  'baza',
  'technicz',
  'technic',
  'serwis',
  'warsztat',
  'przejazd techn',
  'przejazd sluzbowy',
  'przejazd służbowy',
  'bez pasazer',
  'bez pasażer',
  'manewr',
  'rezerwowy',
  'out of service',
  'deadhead',
  'depot',
  'garaz',
  'garaż',
  'do bazy',
  'do zajezdni',
  'poza linia',
  'poza linią',
];

function normalizeTechnicalText(value: unknown) {
  return normalizeStopName(value)
    .replace(/[.,/\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTechnicalTerm(value: unknown) {
  const text = normalizeTechnicalText(value);
  if (!text) return false;
  return TECHNICAL_TERMS.some((term) => text.includes(normalizeTechnicalText(term)));
}

function isTechnicalDepartureData(line: unknown, direction: unknown, extras: unknown[] = []) {
  if (hasTechnicalTerm(line) || hasTechnicalTerm(direction)) return true;
  return extras.some((value) => hasTechnicalTerm(value));
}

function stableCacheString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCacheString).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCacheString((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashCacheString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stopCacheSignature(value: unknown) {
  const size = Array.isArray(value)
    ? value.length
    : value && typeof value === 'object'
      ? Object.keys(value as Record<string, unknown>).length
      : 0;
  return `${size}:${hashCacheString(stableCacheString(value))}`;
}

function stopCollectionSignature(items: unknown) {
  if (!Array.isArray(items)) return stopCacheSignature(items);
  const parts = items.map((item) => {
    if (!item || typeof item !== 'object') return String(item ?? '');
    const record = item as Record<string, unknown>;
    const lat = Number(record.lat);
    const lon = Number(record.lon);
    const lines = Array.isArray(record.lines) ? record.lines.join(',') : '';
    const routeIds = Array.isArray(record.routeIds) ? record.routeIds.join(',') : '';
    const providers = Array.isArray(record.sourceProviderIds) ? record.sourceProviderIds.join(',') : '';
    return [
      record.id,
      record.name,
      record.matchName,
      record.matchKey,
      record.areaId,
      record.code,
      Number.isFinite(lat) ? lat.toFixed(5) : '',
      Number.isFinite(lon) ? lon.toFixed(5) : '',
      lines,
      routeIds,
      providers,
    ].map((value) => repairTextEncoding(value)).join('\u001f');
  });
  return `${items.length}:${hashCacheString(parts.join('\u001e'))}`;
}

function stopLinesIndexSignature(index: Record<string, string[]>) {
  const parts = Object.keys(index)
    .sort()
    .map((key) => `${key}:${(index[key] || []).join(',')}`);
  return `${parts.length}:${hashCacheString(parts.join('|'))}`;
}

function mergeStopLinesIndexes(
  base: Record<string, string[]>,
  incoming: Record<string, string[]>,
) {
  let changed = false;
  const next: Record<string, string[]> = { ...base };
  Object.entries(incoming).forEach(([stopId, lines]) => {
    const cleaned = lines.map(cleanLine).filter(Boolean);
    if (!stopId || cleaned.length === 0) return;
    const merged = sortedLines(new Set([...(next[stopId] || []), ...cleaned]));
    if ((next[stopId] || []).join('|') === merged.join('|')) return;
    next[stopId] = merged;
    changed = true;
  });
  return changed ? next : base;
}

function readStopCache<T>(key: string): { savedAt: number; signature: string; data: T } | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null') as {
      version?: number;
      savedAt?: number;
      signature?: string;
      data?: T;
    } | null;
    if (!parsed || parsed.version !== STOP_CACHE_VERSION || !parsed.data || !parsed.savedAt || !parsed.signature) return null;
    return { savedAt: parsed.savedAt, signature: parsed.signature, data: parsed.data };
  } catch {
    return null;
  }
}

function writeStopCache<T>(key: string, data: T) {
  const signature = stopCacheSignature(data);
  if (typeof window === 'undefined') return signature;
  const current = readStopCache<T>(key);
  if (current?.signature === signature) return signature;
  try {
    window.localStorage.setItem(key, JSON.stringify({
      version: STOP_CACHE_VERSION,
      savedAt: Date.now(),
      signature,
      data,
    }));
  } catch {
    // Keep the current session data even if persistent storage is full.
  }
  return signature;
}

function stopDisplayName(value: unknown) {
  return repairTextEncoding(value)
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s+/g, ', ')
    .trim();
}

function normalizeMpkDisplayName(value: unknown) {
  const base = stopDisplayName(value).replace(/\bmatuszczka\b/gi, 'Matuszczaka');
  return base;
}

function hasKnownCityPrefix(value: unknown) {
  const firstToken = normalizeStopName(value).split(' ')[0] || '';
  if ([
    'rzeszow',
    'boguchwala',
    'babica',
    'czudec',
    'gwoznica',
    'wyzne',
    'lutoryz',
    'zarzecze',
    'polomia',
    'baryczka',
    'jasionka',
  ].includes(firstToken)) return true;
  return /^(rzeszow|rzeszów|boguchwala|boguchwała|babica|czudec|gwoznica|gwoźnica|wyzne|wyżne|lutoryz|lutoryż|zarzecze|polomia|połomia|baryczka|jasionka)\b/i
    .test(stopDisplayName(value));
}

function mpkStopDisplayName(stop: { stop_name?: string; zone_id?: string | number }) {
  const base = normalizeMpkDisplayName(stop.stop_name || '');
  const zone = String(stop.zone_id || '').trim().toUpperCase();
  if (base && zone === 'A' && !hasKnownCityPrefix(base)) return `Rzeszów ${base}`;
  return base;
}

function shouldPrefixAsRzeszow(lat?: number, lon?: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad((lat as number) - 50.0413);
  const dLon = toRad((lon as number) - 21.999);
  const lat1 = toRad(50.0413);
  const lat2 = toRad(lat as number);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distance = 2 * 6371000 * Math.asin(Math.sqrt(h));
  return Number.isFinite(distance) && distance <= 7_500;
}

function ensureMpkCityPrefix(value: unknown, lat?: number, lon?: number) {
  const base = normalizeMpkDisplayName(value);
  if (!base) return base;
  if (!shouldPrefixAsRzeszow(lat, lon)) return base;
  if (base && !hasKnownCityPrefix(base)) return `Rzesz\u00f3w ${base}`;
  return base;
}

function preferredStopDisplayName(displayNamesByProvider: Record<string, string>) {
  return stopDisplayName(
    displayNamesByProvider.pks ||
    displayNamesByProvider.mpk_rzeszow ||
    displayNamesByProvider.marcel ||
    '',
  );
}

function stopBaseNameKey(value: unknown) {
  return normalizeStopName(value)
    .replace(/\bpodkarp(?:acka)?\b/g, 'podkarpacka')
    .replace(/\bpodkar\b/g, 'podkarpacka')
    .replace(/\bmatuszczka\b/g, 'matuszczaka')
    .replace(/[()]/g, ' ')
    .replace(/\s*[-/]\s*/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\b(?:rzeszow|przystanek|przyst|autobusowy|autobusowa)\b/g, ' ')
    .replace(/\bdworzec\s+autobusowy\b/g, 'dworzec')
    .replace(/\b(?:st|skr)\.?\s*\d{1,3}[a-z]?\b/gi, (m) => m.replace(/\d{1,3}[a-z]?/i, ''))
    .replace(/\b\d{1,3}[a-z]?\b$/i, '')
    .replace(/\b\d{1,2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stopPreciseNameKey(value: unknown) {
  return normalizeStopName(stripMarcelStopName(value))
    .replace(/\bpodkarp\.\b/g, 'podkarpacka ')
    .replace(/\bpodkarp(?:acka)?\b/g, 'podkarpacka')
    .replace(/\bpodkarp\b/g, 'podkarpacka')
    .replace(/\bpodkar\b/g, 'podkarpacka')
    .replace(/\bmatuszczka\b/g, 'matuszczaka')
    .replace(/[()]/g, ' ')
    .replace(/\s*[-/]\s*/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\b(?:rzeszow|przystanek|przyst|autobusowy|autobusowa)\b/g, ' ')
    .replace(/\bdworzec\s+autobusowy\b/g, 'dworzec')
    .replace(/\b(?:st|skr)\.?\s*(\d{1,3}[a-z]?)\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeTokens(value: unknown) {
  const key = stopBaseNameKey(value);
  if (TOKEN_CACHE.has(key)) return TOKEN_CACHE.get(key) || [];
  const normalized = key
    .replace(/\b(?:rzeszow|jasionka|przystanek|przyst|ul|ulica|al|aleja|rondo|plac|miasto)\b/g, ' ')
    .replace(/\b(?:nz|n|z)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = normalized ? normalized.split(' ').filter(Boolean) : [];
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

function numericTokens(value: unknown) {
  const key = stopBaseNameKey(value);
  if (NUM_TOKEN_CACHE.has(key)) return NUM_TOKEN_CACHE.get(key) || new Set<string>();
  const tokens = new Set((key.match(/\b\d{1,3}[a-z]?\b/g) || []).map((token) => token.toLowerCase()));
  NUM_TOKEN_CACHE.set(key, tokens);
  return tokens;
}

function nameSimilarityScore(left: unknown, right: unknown) {
  const leftTokens = new Set(mergeTokens(left));
  const rightTokens = new Set(mergeTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function sharedStopTokenCount(left: unknown, right: unknown) {
  const rightTokens = new Set(mergeTokens(right));
  let shared = 0;
  mergeTokens(left).forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared;
}

function hasConflictingCityToken(left: unknown, right: unknown) {
  const knownCities = [
    'rzeszow',
    'boguchwala',
    'babica',
    'czudec',
    'gwoznica',
    'wyzne',
    'lutoryz',
    'zarzecze',
    'polomia',
    'baryczka',
    'jasionka',
  ];
  const cityFor = (value: unknown) => knownCities.find((city) => normalizeStopName(value).split(' ').includes(city));
  const leftCity = cityFor(left);
  const rightCity = cityFor(right);
  return Boolean(leftCity && rightCity && leftCity !== rightCity);
}

function stripMarcelStopName(value: unknown) {
  const cleaned = String(value || '')
    .replace(/^\(\d+[a-z]?\)\s*/i, '')
    .replace(/\s*\((?:\+|-|\/|\s)+\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^\d+[a-z]?$/i.test(cleaned)) return '';
  if (/^\(\d+[a-z]?\)$/i.test(cleaned)) return '';
  return cleaned;
}

function marcelStopDisplayName(cityValue: unknown, stopValue: unknown) {
  const city = stopDisplayName(cityValue);
  const stop = stripMarcelStopName(stopValue);
  if (!stop) return '';
  if (!city) return stopDisplayName(stop);
  if (normalizeStopName(stop).startsWith(`${normalizeStopName(city)} `)) return stopDisplayName(stop);
  return `${city} - ${stopDisplayName(stop)}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));

  return results;
}

function mergeCsvValues(...values: Array<string | undefined>) {
  const next = new Set<string>();
  values.forEach((value) => {
    splitCsvValues(value).forEach((part) => next.add(part));
  });
  return [...next].join(',');
}

function mergeDebugNames(current: string | undefined, nextName: string) {
  const next = new Set(
    String(current || '')
      .split(' | ')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const clean = stopDisplayName(nextName);
  if (clean) next.add(clean);
  return [...next].join(' | ');
}

function splitCsvValues(value: unknown) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function mergeStopArraysUnique(...arrays: Array<string[] | undefined>) {
  return [...new Set(arrays.flatMap((items) => items || []).filter(Boolean))];
}

function mergeStopProviderIds(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
) {
  const merged: Record<string, string> = { ...(left || {}) };
  Object.entries(right || {}).forEach(([key, value]) => {
    merged[key] = key.endsWith('Names')
      ? mergeDebugNames(merged[key], value)
      : mergeCsvValues(merged[key], value);
  });
  return merged;
}

function hasFinitePoint(lat?: number, lon?: number) {
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function distanceMeters(lat1?: number, lon1?: number, lat2?: number, lon2?: number) {
  if (!hasFinitePoint(lat1, lon1) || !hasFinitePoint(lat2, lon2)) return Number.POSITIVE_INFINITY;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad((lat2 as number) - (lat1 as number));
  const dLon = toRad((lon2 as number) - (lon1 as number));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1 as number)) *
      Math.cos(toRad(lat2 as number)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function geoBucketKeys(lat?: number, lon?: number) {
  if (!hasFinitePoint(lat, lon)) return [];
  const latBucket = Math.floor((lat as number) / GEO_BUCKET_PRECISION);
  const lonBucket = Math.floor((lon as number) / GEO_BUCKET_PRECISION);
  const keys: string[] = [];
  for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
    for (let lonOffset = -1; lonOffset <= 1; lonOffset += 1) {
      keys.push(`${latBucket + latOffset}:${lonBucket + lonOffset}`);
    }
  }
  return keys;
}


function normalizeStopMergeName(value: unknown) {
  return normalizeStopName(stopDisplayName(value))
    .replace(/\bpodkarp\.\b/g, 'podkarpacka ')
    .replace(/\bpodkarp(?:acka)?\b/g, 'podkarpacka')
    .replace(/\bpodkarp\b/g, 'podkarpacka')
    .replace(/\bpodkar\b/g, 'podkarpacka')
    .replace(/\bmatuszczka\b/g, 'matuszczaka')
    .replace(/\bskrzyzowanie\b/g, 'skr')
    .replace(/\bskrz\.\b/g, 'skr')
    .replace(/\bprzed\s+torami\b/g, 'przedtorami')
    .replace(/\s*[-/]\s*/g, ' ')
    .replace(/\bn[żz]\b/g, ' ')
    .replace(/\bna zadanie\b/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stopMergeTokenSet(value: unknown) {
  const tokens = normalizeStopMergeName(value).split(' ').map((token) => token.trim()).filter(Boolean);
  return new Set(tokens);
}

function stopMergeNumberSet(value: unknown) {
  return new Set((normalizeStopMergeName(value).match(/\b\d{1,3}[a-z]?\b/g) || []).map((token) => token.toLowerCase()));
}

function stopMergeNameScore(left: unknown, right: unknown) {
  const leftTokens = stopMergeTokenSet(left);
  const rightTokens = stopMergeTokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function stopMergeSharedTokenCount(left: unknown, right: unknown) {
  const leftTokens = stopMergeTokenSet(left);
  const rightTokens = stopMergeTokenSet(right);
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared;
}

function hasConflictingStopNumbers(left: unknown, right: unknown) {
  const leftNumbers = stopMergeNumberSet(left);
  const rightNumbers = stopMergeNumberSet(right);
  if (!leftNumbers.size || !rightNumbers.size) return false;
  for (const token of leftNumbers) {
    if (rightNumbers.has(token)) return false;
  }
  return true;
}

function providerValueSet(stop: Pick<Stop, 'providerStopIds'>, key: string) {
  return new Set(splitCsvValues(stop.providerStopIds?.[key]));
}

function setsOverlap(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function shouldKeepSameProviderStopsSeparate(left: Stop, right: Stop) {
  const leftProviders = new Set(left.sourceProviderIds || []);
  const rightProviders = new Set(right.sourceProviderIds || []);

  for (const provider of ['pks', 'mpk_rzeszow', 'marcel']) {
    if (!leftProviders.has(provider) || !rightProviders.has(provider)) continue;
    const leftIds = providerValueSet(left, provider);
    const rightIds = providerValueSet(right, provider);
    if (leftIds.size && rightIds.size && !setsOverlap(leftIds, rightIds)) return true;
  }

  const leftMarcelKeys = new Set([
    ...splitCsvValues(left.providerStopIds?.marcelMatchKeys),
    ...splitCsvValues(left.providerStopIds?.marcelMatchKey),
  ]);
  const rightMarcelKeys = new Set([
    ...splitCsvValues(right.providerStopIds?.marcelMatchKeys),
    ...splitCsvValues(right.providerStopIds?.marcelMatchKey),
  ]);
  return Boolean(leftMarcelKeys.size && rightMarcelKeys.size && !setsOverlap(leftMarcelKeys, rightMarcelKeys));
}

function shouldMergeStopsByGps(left: Stop, right: Stop) {
  if (hasConflictingStopNumbers(left.name, right.name)) return false;
  if (shouldKeepSameProviderStopsSeparate(left, right)) return false;
  const nameScore = stopMergeNameScore(left.name, right.name);
  const sharedTokens = stopMergeSharedTokenCount(left.name, right.name);
  const distance = distanceMeters(left.lat, left.lon, right.lat, right.lon);
  const lightNameMatch = sharedTokens >= 1 || nameScore >= 0.22;
  if (Number.isFinite(distance)) {
    if (distance <= 35 && lightNameMatch) return true;
    if (distance <= 70 && nameScore >= 0.56 && sharedTokens >= 2) return true;
    return false;
  }
  return nameScore >= 0.9 && sharedTokens >= 2;
}

function mergeStopsCluster(cluster: Stop[]) {
  const byProviderPriority = (stop: Stop) => {
    const providers = stop.sourceProviderIds || [];
    if (providers.includes('pks')) return 0;
    if (providers.includes('mpk_rzeszow')) return 1;
    if (providers.includes('marcel')) return 2;
    return 9;
  };

  const canonical = [...cluster].sort((left, right) => byProviderPriority(left) - byProviderPriority(right))[0];
  const mergedLines = new Set<string>();
  const mergedCarriers = new Map<string, Carrier>();

  cluster.forEach((stop) => {
    (stop.lines || []).forEach((line) => mergedLines.add(line));
    (stop.carriers || []).forEach((carrier) => mergedCarriers.set(carrier.id, carrier));
  });

  const bestName = cluster
    .map((stop) => stopDisplayName(stop.name))
    .sort((left, right) => right.length - left.length)[0] || canonical.name;

  return {
    ...canonical,
    name: ensureMpkCityPrefix(bestName, canonical.lat, canonical.lon),
    lines: sortedLines(mergedLines),
    carriers: [...mergedCarriers.values()],
    isFavorite: cluster.some((stop) => stop.isFavorite),
    sourceProviderIds: mergeStopArraysUnique(...cluster.map((stop) => stop.sourceProviderIds)),
    providerStopIds: cluster.reduce<Record<string, string>>(
      (acc, stop) => mergeStopProviderIds(acc, stop.providerStopIds),
      {},
    ),
  };
}

function mergeStopsByGpsAndName(stops: Stop[]) {
  if (stops.length <= 1) return stops;

  const precision = Math.min(GEO_BUCKET_PRECISION, 0.0015);
  const geoBuckets = new Map<string, number[]>();
  const nameBuckets = new Map<string, number[]>();
  const visited = new Array<boolean>(stops.length).fill(false);
  const merged: Stop[] = [];

  const geoKey = (lat: number, lon: number) =>
    `${Math.floor(lat / precision)}:${Math.floor(lon / precision)}`;

  const neighboringGeoKeys = (lat?: number, lon?: number) => {
    if (!hasFinitePoint(lat, lon)) return [];
    const latBucket = Math.floor((lat as number) / precision);
    const lonBucket = Math.floor((lon as number) / precision);
    const keys: string[] = [];
    for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
      for (let lonOffset = -1; lonOffset <= 1; lonOffset += 1) {
        keys.push(`${latBucket + latOffset}:${lonBucket + lonOffset}`);
      }
    }
    return keys;
  };

  stops.forEach((stop, index) => {
    const nameKey = stopBaseNameKey(stop.name);
    if (nameKey) {
      const bucket = nameBuckets.get(nameKey) || [];
      bucket.push(index);
      nameBuckets.set(nameKey, bucket);
    }

    if (hasFinitePoint(stop.lat, stop.lon)) {
      const key = geoKey(stop.lat as number, stop.lon as number);
      const bucket = geoBuckets.get(key) || [];
      bucket.push(index);
      geoBuckets.set(key, bucket);
    }
  });

  for (let seedIndex = 0; seedIndex < stops.length; seedIndex += 1) {
    if (visited[seedIndex]) continue;
    visited[seedIndex] = true;

    const queue = [seedIndex];
    const clusterIndices = [seedIndex];

    while (queue.length > 0) {
      const currentIndex = queue.pop() as number;
      const current = stops[currentIndex];
      const candidateIndices = new Set<number>();

      const nameKey = stopBaseNameKey(current.name);
      if (nameKey) {
        (nameBuckets.get(nameKey) || []).forEach((index) => candidateIndices.add(index));
      }
      neighboringGeoKeys(current.lat, current.lon).forEach((key) => {
        (geoBuckets.get(key) || []).forEach((index) => candidateIndices.add(index));
      });

      candidateIndices.forEach((candidateIndex) => {
        if (candidateIndex === currentIndex || visited[candidateIndex]) return;
        const candidate = stops[candidateIndex];
        if (!shouldMergeStopsByGps(current, candidate)) return;
        visited[candidateIndex] = true;
        queue.push(candidateIndex);
        clusterIndices.push(candidateIndex);
      });
    }

    const cluster = clusterIndices.map((index) => stops[index]);
    merged.push(cluster.length === 1 ? cluster[0] : mergeStopsCluster(cluster));
  }

  return merged;
}

function isMpkOnlyStop(stop: Stop) {
  const providers = stop.sourceProviderIds || [];
  return providers.includes('mpk_rzeszow') && !providers.includes('pks') && !providers.includes('marcel');
}

function shouldMergeMpkStops(left: Stop, right: Stop) {
  if (!isMpkOnlyStop(left) || !isMpkOnlyStop(right)) return false;
  if (hasConflictingStopNumbers(left.name, right.name)) return false;
  const distance = distanceMeters(left.lat, left.lon, right.lat, right.lon);
  const score = stopMergeNameScore(left.name, right.name);
  const sharedTokens = stopMergeSharedTokenCount(left.name, right.name);
  if (Number.isFinite(distance)) {
    if (distance <= 35 && sharedTokens >= 1) return true;
    if (distance <= 90 && score >= 0.58 && sharedTokens >= 2) return true;
    return false;
  }
  return score >= 0.92 && sharedTokens >= 2;
}

function mergeMpkStopsForList(stops: Stop[]) {
  const visited = new Set<number>();
  const result: Stop[] = [];

  for (let index = 0; index < stops.length; index += 1) {
    if (visited.has(index)) continue;
    const seed = stops[index];
    if (!isMpkOnlyStop(seed)) {
      visited.add(index);
      result.push(seed);
      continue;
    }

    const cluster = [seed];
    visited.add(index);
    for (let candidateIndex = index + 1; candidateIndex < stops.length; candidateIndex += 1) {
      if (visited.has(candidateIndex)) continue;
      const candidate = stops[candidateIndex];
      if (!shouldMergeMpkStops(seed, candidate)) continue;
      visited.add(candidateIndex);
      cluster.push(candidate);
    }

    result.push(cluster.length === 1 ? seed : mergeStopsCluster(cluster));
  }

  return result;
}

function pksLinesForStop(
  stop: Pick<Stop, 'id' | 'providerStopIds'>,
  pksLinesByStopId: Record<string, string[]>,
) {
  const lineSet = new Set<string>();
  const ids = splitCsvValues(stop.providerStopIds?.pks || stop.id);
  ids.forEach((id) => {
    (pksLinesByStopId[id] || []).forEach((line) => lineSet.add(line));
  });
  return sortedLines(lineSet);
}

function indexedLinesForStop(
  stop: Pick<Stop, 'id' | 'providerStopIds'>,
  linesByStopId: Record<string, string[]>,
) {
  const lineSet = new Set<string>();
  const ids = [
    stop.id,
    ...splitCsvValues(stop.providerStopIds?.pks),
    ...splitCsvValues(stop.providerStopIds?.mpk_rzeszow),
    ...splitCsvValues(stop.providerStopIds?.marcel),
  ].filter(Boolean);
  ids.forEach((id) => {
    (linesByStopId[id] || []).forEach((line) => lineSet.add(line));
  });
  return sortedLines(lineSet);
}

function marcelCourseStopMatchKey(stop: MarcelCourseStopPublic) {
  return stopPreciseNameKey(stripMarcelStopName(stop.nazPr)) || stopBaseNameKey(stripMarcelStopName(stop.nazPr));
}

function marcelCourseStopIndexKey(stop: MarcelCourseStopPublic) {
  return [normalizeStopName(stop.nazMi), marcelCourseStopMatchKey(stop)].filter(Boolean).join('|');
}

function getMarcelStopsIndex(dateIso: string, options?: { forceRefresh?: boolean }) {
  const cacheKey = `${MARCEL_STOPS_PERSISTENT_PREFIX}${dateIso}`;
  const cached = readStopCache<MarcelIndexedStop[]>(cacheKey);
  const isFresh = cached && Date.now() - cached.savedAt < STOP_CACHE_TTL_MS;
  if (cached && !options?.forceRefresh) {
    if (!isFresh) {
      getMarcelStopsIndex(dateIso, { forceRefresh: true }).catch(() => undefined);
    }
    return Promise.resolve(cached.data);
  }

  if (options?.forceRefresh) MARCEL_STOPS_INDEX_CACHE.delete(dateIso);
  if (!MARCEL_STOPS_INDEX_CACHE.has(dateIso)) {
    MARCEL_STOPS_INDEX_CACHE.set(dateIso, (async () => {
      const routes = await fetchMarcelRoutesClient();
      const routeCourses = await mapWithConcurrency(routes, 6, async (route) => ({
        routeId: String(route.idTr),
        courses: await fetchMarcelCoursesClient(route.idTr, dateIso).catch(() => []),
      }));
      const courseRefs = routeCourses.flatMap(({ routeId, courses }) =>
        courses.map((course) => ({ routeId, courseId: course.idKu })),
      );
      const uniqueCourseRefs = [...new Map(courseRefs.map((ref) => [String(ref.courseId), ref])).values()];
      const indexedStops = new Map<string, MarcelIndexedStop & { routeIdSet: Set<string> }>();

      await mapWithConcurrency(uniqueCourseRefs, 10, async ({ routeId, courseId }) => {
        const stopsForCourse = await fetchMarcelPublicCourseStopsClient(courseId).catch(() => []);
        stopsForCourse.forEach((courseStop) => {
          const matchName = stripMarcelStopName(courseStop.nazPr);
          const matchKey = marcelCourseStopMatchKey(courseStop);
          const displayName = marcelStopDisplayName(courseStop.nazMi, courseStop.nazPr);
          const key = marcelCourseStopIndexKey(courseStop);
          if (!displayName || !matchName || !matchKey || !key) return;

          const current = indexedStops.get(key);
          if (current) {
            current.routeIdSet.add(routeId);
            if (current.lat === undefined && Number.isFinite(Number(courseStop.szGps))) current.lat = Number(courseStop.szGps);
            if (current.lon === undefined && Number.isFinite(Number(courseStop.dlGps))) current.lon = Number(courseStop.dlGps);
            return;
          }

          indexedStops.set(key, {
            id: stableKeyId('marcel', key),
            name: stopDisplayName(displayName),
            matchName: stopDisplayName(matchName),
            matchKey,
            lat: Number.isFinite(Number(courseStop.szGps)) ? Number(courseStop.szGps) : undefined,
            lon: Number.isFinite(Number(courseStop.dlGps)) ? Number(courseStop.dlGps) : undefined,
            routeIds: [],
            routeIdSet: new Set([routeId]),
          });
        });
      });

      const stops = [...indexedStops.values()].map(({ routeIdSet, ...stop }) => ({
        ...stop,
        routeIds: [...routeIdSet],
      }));
      writeStopCache(cacheKey, stops);
      return stops;
    })());
  }
  return MARCEL_STOPS_INDEX_CACHE.get(dateIso)!.catch((error) => {
    if (cached) return cached.data;
    throw error;
  });
}

function canExposeStandaloneMarcelStop(value: unknown) {
  const display = stopDisplayName(value);
  if (!display) return false;
  const key = stopBaseNameKey(display);
  if (!key) return false;
  if (key.length < 3) return false;
  return /[a-z]/i.test(key);
}

function isWeakMarcelName(value: unknown) {
  const tokens = mergeTokens(value);
  if (tokens.length === 0) return true;
  if (tokens.length === 1) return true;
  const hasDigits = /\d/.test(stopBaseNameKey(value));
  return !hasDigits && tokens.length <= 2;
}

function stableKeyId(prefix: string, value: string) {
  const base = normalizeStopName(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'stop';
  return `${prefix}_${base}`;
}

function marcelDirectionDestination(value: unknown) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Marcel';
  const parts = normalized.split(/\s*(?:-|>)\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  return normalized;
}

function providerCarrier(provider: unknown): Carrier {
  if (provider === 'mpk_rzeszow') return MPK_CARRIER;
  if (provider === 'marcel') return MARCEL_CARRIER;
  return PKS_CARRIER;
}

function sortedLines(lines: Iterable<string>) {
  return [...lines]
    .map(cleanLine)
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index)
    .sort((left, right) => {
      const leftNumber = Number.parseInt(left, 10);
      const rightNumber = Number.parseInt(right, 10);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
      if (Number.isFinite(leftNumber)) return -1;
      if (Number.isFinite(rightNumber)) return 1;
      return left.localeCompare(right, 'pl');
    });
}

function selectedDateIso(dayIndex: number) {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, dayIndex));
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' });
}

function parseTimeOnDate(dateIso: string, timeValue: unknown) {
  const raw = String(timeValue || '').trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || '0');
  const date = new Date(`${dateIso}T00:00:00`);
  date.setHours(hours, minutes, seconds, 0);
  return date.getTime();
}

function parseMpkRealtimeMs(dateIso: string, value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const direct = new Date(raw.replace(' ', 'T')).getTime();
  if (Number.isFinite(direct)) return direct;
  return parseTimeOnDate(dateIso, raw);
}

function carrierForLine(line: string): Carrier {
  const normalized = line.toLowerCase();
  if (line.startsWith('M') || normalized.includes('marcel')) return MARCEL_CARRIER;
  const numericLine = Number.parseInt(line, 10);
  if (Number.isFinite(numericLine) && numericLine < 100) return MPK_CARRIER;
  return PKS_CARRIER;
}

function timestampFromJourney(journey: Record<string, unknown>) {
  const raw = String(journey.timetable_time || journey.plannedDeparture || '').replace(' ', 'T');
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function formatWarsawTime(ms: number | undefined, fallback?: unknown) {
  if (Number.isFinite(ms)) {
    return new Date(ms as number).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Warsaw',
    });
  }
  const raw = String(fallback || '').trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '--:--';
}

function mapJourneyToDeparture(journey: Record<string, unknown>, index: number): Departure | null {
  const line = cleanLine(journey.line_name || journey.line || '?') || '?';
  const plannedAtMs = timestampFromJourney(journey);
  const vehicleId = String(journey.vehicle_id || journey.vehicleId || journey.vehicle_number || '').trim();
  const hasRealtimeMarker = Boolean(
    vehicleId || journey.realDeparture || journey.real_departure_time,
  );
  const delayMinutes = hasRealtimeMarker ? Number(journey.deviation ?? journey.delayMinutes ?? 0) : 0;
  const hasDelay = hasRealtimeMarker && Number.isFinite(delayMinutes) && Math.abs(delayMinutes) > 1;
  const realAtMs = Number.isFinite(plannedAtMs) && Number.isFinite(delayMinutes)
    ? (plannedAtMs as number) + delayMinutes * 60_000
    : plannedAtMs;
  const direction = String(journey.route_description || journey.direction || journey.destination || 'Nieznany kierunek');
  if (
    isTechnicalDepartureData(line, direction, [
      journey.status,
      journey.trip_type,
      journey.service_type,
      journey.course_type,
      journey.note,
      journey.route_name,
    ])
  ) {
    return null;
  }
  const carrier = PKS_CARRIER;

  return {
    id: [line, plannedAtMs || journey.timetable_time || index, direction, vehicleId || 'schedule'].join(':'),
    line,
    direction,
    time: formatWarsawTime(realAtMs, journey.realDeparture || journey.plannedDeparture || journey.timetable_time),
    status: hasDelay ? 'delayed' : 'on_time',
    delayMins: hasDelay ? Math.round(delayMinutes) : 0,
    carrier,
    type: 'departure',
    plannedAtMs,
    realAtMs,
  };
}

function departureFromMpkSchedule(entry: Record<string, unknown>, dateIso: string, index: number): Departure | null {
  const line = cleanLine(entry.line);
  if (!line) return null;
  if (isHiddenMpkLine(line)) return null;
  const plannedAtMs = parseTimeOnDate(dateIso, entry.departure_time);
  const realFromEntryMs = parseMpkRealtimeMs(
    dateIso,
    entry.real_departure_time || entry.realDeparture || entry.real || entry.estimated_departure_time,
  );
  const rawDelayMinutes = Number(entry.deviation ?? entry.delayMinutes);
  const realAtMs = Number.isFinite(realFromEntryMs)
    ? realFromEntryMs
    : Number.isFinite(plannedAtMs) && Number.isFinite(rawDelayMinutes)
      ? (plannedAtMs as number) + rawDelayMinutes * 60_000
      : plannedAtMs;
  const delayMins = Number.isFinite(plannedAtMs) && Number.isFinite(realAtMs)
    ? Math.round(((realAtMs as number) - (plannedAtMs as number)) / 60_000)
    : 0;
  const hasLive = Boolean(entry.live || entry.real_departure_time || entry.realDeparture || entry.real || entry.vehicle || entry.vehicle_number);
  const direction = String(entry.trip_headsign || entry.end_stop_name || 'Nieznany kierunek').trim();
  if (
    isTechnicalDepartureData(line, direction, [
      entry.trip_type,
      entry.service_type,
      entry.route_desc,
      entry.note,
    ])
  ) {
    return null;
  }
  return {
    id: `mpk:${entry.trip_id || entry.block_id || index}:${plannedAtMs || entry.departure_time}:${entry.vehicle || entry.vehicle_number || 'schedule'}`,
    line,
    direction,
    time: formatWarsawTime(realAtMs, entry.real_departure_time || entry.departure_time),
    status: hasLive && Math.abs(delayMins) > 1 ? 'delayed' : 'on_time',
    delayMins: hasLive && Math.abs(delayMins) > 1 ? delayMins : 0,
    carrier: MPK_CARRIER,
    type: 'departure',
    plannedAtMs,
    realAtMs,
  };
}

function departureFromMarcelCourseStop(
  course: MarcelCourse,
  stop: MarcelCourseStopPublic,
  dateIso: string,
  index: number,
): Departure | null {
  if (
    isTechnicalDepartureData('M', course.nazTr || stop.nazTr || '', [
      (course as Record<string, unknown>).nazLin,
      stop.nazPr,
    ])
  ) {
    return null;
  }
  const plannedAtMs = parseTimeOnDate(dateIso, stop.godz || course.godz);
  return {
    id: `marcel:${course.idKu}:${stop.kol || index}:${plannedAtMs || stop.godz || course.godz}`,
    line: 'M',
    direction: marcelDirectionDestination(course.nazTr || stop.nazTr || 'Marcel'),
    time: formatWarsawTime(plannedAtMs, stop.godz || course.godz),
    status: 'on_time',
    delayMins: 0,
    carrier: MARCEL_CARRIER,
    type: 'departure',
    plannedAtMs,
    realAtMs: plannedAtMs,
  };
}

async function enrichVehiclesForLiveStop(
  vehicles: Vehicle[],
  stop: Stop,
  departures: Departure[],
) {
  const departureLines = new Set(departures.map((departure) => normalizeLineKey(departure.line)).filter(Boolean));
  const uniqueVehicles = new Map<string, Vehicle>();

  vehicles.forEach((vehicle) => {
    const provider = providerFromVehicle(vehicle);
    if (!provider) return;
    if (vehicle.status === 'break' || vehicle.status === 'inactive' || vehicle.status === 'technical') return;
    const line = normalizeLineKey(vehicle.routeShortName || vehicle.routeId);
    if (!line || !departureLines.has(line)) return;
    if (isTechnicalDepartureData(vehicle.routeShortName || line, vehicle.routeId, [vehicle.statusText, vehicle.name])) return;
    uniqueVehicles.set(`${provider}:${vehicle.id}`, vehicle);
  });

  const candidateStopIds = new Map<LiveDepartureProvider, Set<string>>([
    ['pks', stopIdsForLiveProvider(stop, 'pks')],
    ['mpk_rzeszow', stopIdsForLiveProvider(stop, 'mpk_rzeszow')],
    ['marcel', stopIdsForLiveProvider(stop, 'marcel')],
  ]);
  const candidates = [...uniqueVehicles.values()]
    .sort((left, right) => {
      const leftProvider = providerFromVehicle(left);
      const rightProvider = providerFromVehicle(right);
      const leftScore = leftProvider ? liveVehicleCandidateScore(left, candidateStopIds.get(leftProvider)!) : 0;
      const rightScore = rightProvider ? liveVehicleCandidateScore(right, candidateStopIds.get(rightProvider)!) : 0;
      return rightScore - leftScore;
    })
    .slice(0, 18);
  const enriched = await mapWithConcurrency(candidates, 4, async (vehicle) => {
      const provider = providerFromVehicle(vehicle);
      if (!provider) return vehicle;
      const stopIds = stopIdsForLiveProvider(stop, provider);
      if (vehicleHasLiveStop(vehicle, stopIds)) return vehicle;
      const details = await fetchCachedVehicleDetails(provider, vehicle);
      return mergeVehicleSnapshot(vehicle, details);
    });

  return enriched;
}

function correctionsFromLiveVehicles(vehicles: Vehicle[], stop: Stop): LiveDepartureCorrection[] {
  const corrections: LiveDepartureCorrection[] = [];

  vehicles.forEach((vehicle) => {
    const provider = providerFromVehicle(vehicle);
    if (!provider) return;
    if (vehicle.status === 'break' || vehicle.status === 'inactive' || vehicle.status === 'technical') return;
    if (vehicle.status !== 'active') return;

    const line = normalizeLineKey(vehicle.routeShortName || vehicle.routeId);
    if (!line) return;
    if (isTechnicalDepartureData(vehicle.routeShortName || line, vehicle.routeId, [vehicle.statusText, vehicle.name])) return;

    const rawDelaySeconds = Number(vehicle.delay || 0);
    const hasUsableVehicleDelay =
      Number.isFinite(rawDelaySeconds) &&
      Math.abs(rawDelaySeconds) <= LIVE_DELAY_LIMIT_SECONDS;
    const stopIds = stopIdsForLiveProvider(stop, provider);
    const stopsForVehicle = [...(vehicle.schedule || []), ...(vehicle.routeStops || [])].filter((entry) =>
      stopIds.has(String(entry.id || '').trim()),
    );

    stopsForVehicle.forEach((entry) => {
      if (entry.isPast) return;
      const plannedAtMs = parseDateMs(entry.planned);
      if (!Number.isFinite(plannedAtMs)) return;

      const rawRealAtMs = parseDateMs(entry.real);
      const rawRealLooksPlanned =
        Number.isFinite(rawRealAtMs) &&
        Math.abs(rawRealAtMs - plannedAtMs) < 60_000;
      const realAtMs =
        hasUsableVehicleDelay && rawDelaySeconds !== 0 && rawRealLooksPlanned
          ? plannedAtMs + rawDelaySeconds * 1000
          : Number.isFinite(rawRealAtMs)
            ? rawRealAtMs
            : hasUsableVehicleDelay
              ? plannedAtMs + rawDelaySeconds * 1000
              : Number.NaN;

      if (!Number.isFinite(realAtMs)) return;
      if (realAtMs < Date.now() - 30_000) return;
      const delayMins = Math.round((realAtMs - plannedAtMs) / 60_000);

      const vehicleNumber = vehicleDisplayNumber(vehicle);
      const vehicleModel = String(vehicle.model || '').trim();
      const vehicleDesc = vehicleNumber
        ? vehicleModel
          ? `Autobus ${vehicleNumber}, ${vehicleModel}`
          : `Autobus ${vehicleNumber}`
        : undefined;
      corrections.push({
        key: `${provider}:${vehicle.id}:${String(entry.id || '')}:${plannedAtMs}`,
        provider,
        line,
        stopId: String(entry.id || '').trim(),
        plannedAtMs,
        realAtMs,
        delayMins,
        vehicleDesc,
      });
    });
  });

  return corrections;
}

async function applyLiveDepartureCorrections(
  departures: Departure[],
  stop: Stop,
  vehicles: Vehicle[],
  dayIndex: number,
) {
  if (dayIndex !== 0 || departures.length === 0 || vehicles.length === 0) return departures;

  const enrichedVehicles = await enrichVehiclesForLiveStop(vehicles, stop, departures);
  const corrections = correctionsFromLiveVehicles(enrichedVehicles, stop);
  if (corrections.length === 0) return departures;
  const usedCorrectionKeys = new Set<string>();

  return departures.map((departure) => {
    const provider = providerFromDeparture(departure);
    const plannedAtMs = Number(departure.plannedAtMs);
    if (!provider || !Number.isFinite(plannedAtMs)) return departure;

    const line = normalizeLineKey(departure.line);
    let selectedCorrection: LiveDepartureCorrection | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;

    for (const correction of corrections) {
      if (usedCorrectionKeys.has(correction.key)) continue;
      if (correction.provider !== provider) continue;
      if (correction.line !== line) continue;
      const diff = Math.abs(correction.plannedAtMs - plannedAtMs);
      const matchWindow = correction.provider === 'mpk_rzeszow'
        ? MPK_LIVE_DEPARTURE_MATCH_WINDOW_MS
        : LIVE_DEPARTURE_MATCH_WINDOW_MS;
      if (diff > matchWindow || diff >= bestDiff) continue;
      bestDiff = diff;
      selectedCorrection = correction;
    }

    if (!selectedCorrection) return departure;
    usedCorrectionKeys.add(selectedCorrection.key);

    return {
      ...departure,
      time: formatWarsawTime(selectedCorrection.realAtMs, departure.time),
      status: Math.abs(selectedCorrection.delayMins) > 0 ? 'delayed' as const : 'on_time' as const,
      delayMins: selectedCorrection.delayMins,
      realAtMs: selectedCorrection.realAtMs,
      vehicleDesc: selectedCorrection.vehicleDesc,
    };
  });
}

export default function StopsPanel({
  stops,
  isLoading,
  hasError,
  favorites,
  vehicles,
  transparentUI,
  isDarkTheme,
  themeMode,
  onRetry,
  onClose,
  onToggleFavorite,
  onShowOnMap,
}: StopsPanelProps) {
  const isOledTheme = themeMode === 'dark-oled';
  const isWarmTheme = themeMode === 'light-warm';
  const panelShellClass = transparentUI
    ? `absolute inset-0 z-10 overflow-hidden backdrop-blur-2xl backdrop-saturate-150 ${
        isOledTheme
          ? 'bg-black/88'
          : isWarmTheme
            ? 'bg-[#f8f2e4]/92'
            : isDarkTheme
              ? 'bg-slate-950/88'
              : 'bg-white/92'
      }`
    : `absolute inset-0 z-10 overflow-hidden ${
        isOledTheme
          ? 'bg-black'
          : isWarmTheme
            ? 'bg-[#f2ede1]'
            : isDarkTheme
              ? 'bg-[#03060a]'
              : 'bg-slate-50'
      }`;
  const errorShellClass = isOledTheme
    ? 'bg-black/84 text-slate-300'
    : isWarmTheme
      ? 'bg-[#f8f2e4]/86 text-[#3d3a2e]'
      : isDarkTheme
        ? 'bg-[#07111d]/70 text-slate-300'
        : 'bg-white/80 text-slate-700';
  const errorTextClass = isWarmTheme ? 'text-[#736e56]' : isDarkTheme ? 'text-slate-400' : 'text-slate-600';
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [mpkStops, setMpkStops] = useState<Array<{ id: string; name: string; lat?: number; lon?: number; lines: string[] }>>([]);
  const [marcelStops, setMarcelStops] = useState<MarcelIndexedStop[]>([]);
  const [pksLinesByStopId, setPksLinesByStopId] = useState<Record<string, string[]>>({});
  const [departureLinesByStopId, setDepartureLinesByStopId] = useState<Record<string, string[]>>({});
  const [mergedStopsBase, setMergedStopsBase] = useState<Stop[]>([]);
  const [isPreparingStops, setIsPreparingStops] = useState(false);
  const [stopsSearchState, setStopsSearchState] = useState<StopsSearchState>({
    inputValue: '',
    fullInputValue: '',
    carrierFilter: 'all',
    visibleFullCount: 40,
  });
  const mergedStopsCacheKey = useMemo(
    () =>
      [
        stopCollectionSignature(stops),
        stopCollectionSignature(mpkStops),
        stopCollectionSignature(marcelStops),
      ].join('|'),
    [marcelStops, mpkStops, stops],
  );
  const pksLinesCacheKey = useMemo(
    () => `${PKS_LINES_INDEX_PERSISTENT_PREFIX}${stopCollectionSignature(stops)}`,
    [stops],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const dateIso = selectedDateIso(0);
    const mapMpkStops = (data: Awaited<ReturnType<typeof fetchMpkRzeszowStopsClient>>) =>
      data
        .map((stop) => {
          const lat = Number.isFinite(Number(stop.stop_lat)) ? Number(stop.stop_lat) : undefined;
          const lon = Number.isFinite(Number(stop.stop_lon)) ? Number(stop.stop_lon) : undefined;
          return {
            id: String(stop.stop_id),
            name: ensureMpkCityPrefix(stop.stop_name || '', lat, lon),
            lat,
            lon,
            lines: sortedLines(String(stop.lines || '').split(',').map((line) => line.trim()).filter((line) => !isHiddenMpkLine(line))),
          };
        })
        .filter((stop) => stop.id && stop.name);
    const mpkSignature = (items: typeof mpkStops) => stopCollectionSignature(items);

    const loadMpkStopsSnapshot = async () => {
      try {
        const cachedStops = await fetchMpkRzeszowStopsClient({ signal: controller.signal }).then(mapMpkStops);
        if (!active) return;
        setMpkStops((current) => (mpkSignature(current) === mpkSignature(cachedStops) ? current : cachedStops));
      } catch (error) {
        if ((error as { name?: string })?.name !== 'AbortError') {
          console.warn('[StopsPanel] MPK stops unavailable', error);
        }
      }
    };

    const loadMarcelStopsSnapshot = async () => {
      try {
        const cachedStops = await getMarcelStopsIndex(dateIso);
        if (!active) return;
        setMarcelStops((current) => (stopCollectionSignature(current) === stopCollectionSignature(cachedStops) ? current : cachedStops));
      } catch (error) {
        console.warn('[StopsPanel] Marcel stops unavailable', error);
      }
    };

    loadMpkStopsSnapshot();
    loadMarcelStopsSnapshot();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const pksVehicles = vehicles.filter((vehicle) => {
      if (vehicle.type === 'train') return false;
      if (String(vehicle.provider || 'pks') !== 'pks') return false;
      if (vehicle.status === 'technical') return false;
      return true;
    });

    const buildIndex = (sourceVehicles: Vehicle[]) => {
      const next = new Map<string, Set<string>>();
      sourceVehicles.forEach((vehicle) => {
        if (vehicle.type === 'train') return;
        if (String(vehicle.provider || 'pks') !== 'pks') return;
        if (vehicle.status === 'technical') return;
        const line = cleanLine(vehicle.routeShortName);
        if (!line || line === '?') return;
        if (isTechnicalDepartureData(line, vehicle.routeId, [vehicle.statusText, vehicle.name])) return;
        const routeStops = [
          ...(vehicle.routePath || []).map((id) => ({ id })),
          ...(vehicle.routeStops || []),
          ...(vehicle.schedule || []),
        ];
        routeStops.forEach((routeStop) => {
          const stopId = String(routeStop?.id || '').trim();
          if (!stopId) return;
          const lineSet = next.get(stopId) || new Set<string>();
          lineSet.add(line);
          next.set(stopId, lineSet);
        });
      });

      const nextIndex: Record<string, string[]> = {};
      next.forEach((lineSet, stopId) => {
        nextIndex[stopId] = sortedLines(lineSet);
      });
      return nextIndex;
    };

    const applyIndex = (nextIndex: Record<string, string[]>) => {
      if (!active) return;
      setPksLinesByStopId((current) => mergeStopLinesIndexes(current, nextIndex));
    };

    const timeoutId = window.setTimeout(() => applyIndex(buildIndex(pksVehicles)), 0);

    const loadDetailedIndex = async () => {
      const detailedVehicles = await mapWithConcurrency(pksVehicles, 4, async (vehicle) => {
        const line = cleanLine(vehicle.routeShortName);
        if (!line || line === '?') return vehicle;
        const hasFullRoute = (vehicle.routePath?.length || 0) > 1 || (vehicle.routeStops?.length || 0) > 1;
        if (hasFullRoute) return vehicle;
        const details = await fetchCachedVehicleDetails('pks', vehicle).catch(() => null);
        return mergeVehicleSnapshot(vehicle, details);
      });
      applyIndex(buildIndex(detailedVehicles));
    };

    loadDetailedIndex().catch(() => undefined);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [vehicles]);

  useEffect(() => {
    let cancelled = false;
    const cached = readStopCache<Record<string, string[]>>(pksLinesCacheKey);
    if (cached?.data) {
      setPksLinesByStopId((current) => mergeStopLinesIndexes(current, cached.data));
    }
    if (!stops.length) return () => {
      cancelled = true;
    };

    const currentIndex = cached?.data || {};
    const missingStops = stops.filter((stop) => {
      const stopId = String(stop.id || '').trim();
      if (!stopId || !stop.areaId || !stop.code) return false;
      return !(currentIndex[stopId] || []).length;
    });
    if (!missingStops.length) return () => {
      cancelled = true;
    };

    const run = async () => {
      const dateIso = selectedDateIso(0);
      const discovered: Record<string, string[]> = {};
      await mapWithConcurrency(missingStops, 4, async (stop, index) => {
        if (cancelled) return;
        const stopId = String(stop.id || '').trim();
        if (!stopId) return;
        const lines = await fetchPksStopLinesClient(stop.areaId, stop.code, dateIso).catch(() => []);
        if (cancelled || !lines.length) return;
        discovered[stopId] = lines;
        if (index > 0 && index % 25 === 0) {
          setPksLinesByStopId((current) => mergeStopLinesIndexes(current, discovered));
        }
      });
      if (cancelled || !Object.keys(discovered).length) return;
      setPksLinesByStopId((current) => {
        const merged = mergeStopLinesIndexes(current, discovered);
        writeStopCache(pksLinesCacheKey, merged);
        return merged;
      });
    };

    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const start = () => {
      run().catch((error) => console.warn('[StopsPanel] PKS lines index unavailable', error));
    };
    if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
      idleId = (window as any).requestIdleCallback(start, { timeout: 1200 });
    } else if (typeof window !== 'undefined') {
      timeoutId = window.setTimeout(start, 250);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null && typeof (window as any).cancelIdleCallback === 'function') {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [pksLinesCacheKey, stops]);

  useEffect(() => {
    if (!Object.keys(pksLinesByStopId).length) return;
    const timeoutId = window.setTimeout(() => {
      writeStopCache(pksLinesCacheKey, pksLinesByStopId);
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [pksLinesByStopId, pksLinesCacheKey]);

  const buildMergedStopsBase = useCallback<() => Stop[]>(() => {
    const cached = MERGED_STOPS_RUNTIME_CACHE.get(mergedStopsCacheKey);
    if (cached) return cached;

    const byTechnical = new Map<string, InternalStop>();
    const baseBuckets = new Map<string, InternalStop[]>();
    const tokenBuckets = new Map<string, Set<InternalStop>>();
    const geoBuckets = new Map<string, Set<InternalStop>>();
    const crossMatchCache = new Map<string, InternalStop | null>();

    const technicalKey = (provider: string, id: string) => `${provider}:${String(id).trim()}`;

    const registerBucket = (stop: InternalStop) => {
      const list = baseBuckets.get(stop.baseNameKey) || [];
      if (!list.includes(stop)) list.push(stop);
      baseBuckets.set(stop.baseNameKey, list);

      const textTokens = mergeTokens(stop.name);
      textTokens.forEach((token) => {
        const bucket = tokenBuckets.get(token) || new Set<InternalStop>();
        bucket.add(stop);
        tokenBuckets.set(token, bucket);
      });
      const numbers = numericTokens(stop.name);
      numbers.forEach((token) => {
        const bucket = tokenBuckets.get(`num:${token}`) || new Set<InternalStop>();
        bucket.add(stop);
        tokenBuckets.set(`num:${token}`, bucket);
      });
      geoBucketKeys(stop.lat, stop.lon).forEach((key) => {
        const bucket = geoBuckets.get(key) || new Set<InternalStop>();
        bucket.add(stop);
        geoBuckets.set(key, bucket);
      });
    };

    const attachProvider = (
      target: InternalStop,
      raw: {
        id: string;
        name: string;
        areaId?: string;
        code?: string;
        lat?: number;
        lon?: number;
        provider: string;
        carrier: Carrier;
      },
    ) => {
      target.providerStopIds = {
        ...(target.providerStopIds || {}),
        [raw.provider]: mergeCsvValues(target.providerStopIds?.[raw.provider], String(raw.id)),
        [`${raw.provider}Names`]: mergeDebugNames(target.providerStopIds?.[`${raw.provider}Names`], raw.name),
      };
      if (raw.provider === 'pks') {
        target.providerStopIds.pksAreaIds = mergeCsvValues(target.providerStopIds.pksAreaIds, raw.areaId);
        target.providerStopIds.pksCodes = mergeCsvValues(target.providerStopIds.pksCodes, raw.code);
      }
      target.sourceProviderIds = [...new Set([...(target.sourceProviderIds || []), raw.provider])];
      target.displayNamesByProvider = {
        ...(target.displayNamesByProvider || {}),
        [raw.provider]: target.displayNamesByProvider?.[raw.provider] || stopDisplayName(raw.name),
      };
      target.name = preferredStopDisplayName(target.displayNamesByProvider) || target.name;
      target.baseNameKey = stopBaseNameKey(target.name);
      registerBucket(target);
      target.carrierMap.set(raw.carrier.id, raw.carrier);
      if (target.lat === undefined && raw.lat !== undefined) target.lat = raw.lat;
      if (target.lon === undefined && raw.lon !== undefined) target.lon = raw.lon;
      if (!target.areaId && raw.areaId) target.areaId = raw.areaId;
      if (!target.code && raw.code) target.code = raw.code;
    };

    const createStop = (raw: {
      id: string;
      name: string;
      areaId?: string;
      code?: string;
      lat?: number;
      lon?: number;
      provider: string;
      carrier: Carrier;
    }) => {
      const displayName = stopDisplayName(raw.name);
      const baseNameKey = stopBaseNameKey(displayName);
      const publicId = raw.provider === 'pks' ? String(raw.id) : `${raw.provider}:${String(raw.id)}`;
      const next: InternalStop = {
        id: publicId,
        name: displayName,
        type: 'bus',
        carriers: [raw.carrier],
        carrierMap: new Map([[raw.carrier.id, raw.carrier]]),
        lines: [],
        lineSet: new Set<string>(),
        displayNamesByProvider: { [raw.provider]: displayName },
        isFavorite: false,
        areaId: raw.areaId,
        code: raw.code,
        lat: raw.lat,
        lon: raw.lon,
        sourceProviderIds: [raw.provider],
        providerStopIds: {
          [raw.provider]: String(raw.id),
          [`${raw.provider}Names`]: displayName,
          ...(raw.provider === 'pks' ? { pksAreaIds: String(raw.areaId || ''), pksCodes: String(raw.code || '') } : {}),
        },
        baseNameKey,
      };
      byTechnical.set(technicalKey(raw.provider, raw.id), next);
      registerBucket(next);
      return next;
    };

    const ensureTechnicalStop = (raw: {
      id: string;
      name: string;
      areaId?: string;
      code?: string;
      lat?: number;
      lon?: number;
      provider: string;
      carrier: Carrier;
    }) => {
      const key = technicalKey(raw.provider, raw.id);
      const current = byTechnical.get(key);
      if (current) {
        attachProvider(current, raw);
        return current;
      }
      return createStop(raw);
    };

    const findSafeCrossProviderMatch = (
      raw: { name: string; lat?: number; lon?: number },
      candidateProviders = new Set(['pks', 'mpk_rzeszow']),
    ) => {
      const baseNameKey = stopBaseNameKey(raw.name);
      if (!baseNameKey) return null;
      const latKey = Number.isFinite(raw.lat) ? Number(raw.lat).toFixed(4) : 'x';
      const lonKey = Number.isFinite(raw.lon) ? Number(raw.lon).toFixed(4) : 'x';
      const providerKey = [...candidateProviders].sort().join('+');
      const cacheKey = `${providerKey}|${baseNameKey}|${latKey}|${lonKey}`;
      if (crossMatchCache.has(cacheKey)) return crossMatchCache.get(cacheKey) || null;

      const localGpsSet = new Set<InternalStop>();
      geoBucketKeys(raw.lat, raw.lon).forEach((key) => {
        const bucket = geoBuckets.get(key);
        if (bucket) bucket.forEach((candidate) => localGpsSet.add(candidate));
      });
      const lexicalSet = new Set<InternalStop>();
      const rawTokens = mergeTokens(raw.name).slice(0, 4);
      rawTokens.forEach((token) => {
        const bucket = tokenBuckets.get(token);
        if (bucket) bucket.forEach((candidate) => lexicalSet.add(candidate));
      });
      const rawNumbers = numericTokens(raw.name);
      rawNumbers.forEach((token) => {
        const bucket = tokenBuckets.get(`num:${token}`);
        if (bucket) bucket.forEach((candidate) => lexicalSet.add(candidate));
      });
      const exactCandidates = (baseBuckets.get(baseNameKey) || []).filter((candidate) => {
        const providers = candidate.sourceProviderIds || [];
        return providers.some((provider) => candidateProviders.has(provider));
      });

      const candidateSet = new Set<InternalStop>([...localGpsSet, ...lexicalSet, ...exactCandidates]);
      const pool = [...candidateSet].filter((candidate) => {
        const providers = candidate.sourceProviderIds || [];
        return providers.some((provider) => candidateProviders.has(provider));
      });
      if (pool.length === 0) return null;

      const weakName = isWeakMarcelName(raw.name);
      let bestCandidate: InternalStop | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestScore = -1;

      for (const candidate of pool) {
        const distance = distanceMeters(raw.lat, raw.lon, candidate.lat, candidate.lon);
        const hasGeo = Number.isFinite(distance);
        if (hasConflictingCityToken(raw.name, candidate.name)) continue;
        if (hasConflictingStopNumbers(raw.name, candidate.name)) continue;
        if (weakName && hasGeo && distance > 120) continue;
        const similarity = nameSimilarityScore(raw.name, candidate.name);
        const sharedTokens = sharedStopTokenCount(raw.name, candidate.name);
        const exactBaseBoost = candidate.baseNameKey === baseNameKey ? 0.34 : 0;
        if (hasGeo && distance > 550 && similarity < 0.95) continue;
        if (!hasGeo && candidate.baseNameKey !== baseNameKey && similarity < 0.92) continue;
        const distanceScore = hasGeo
          ? distance <= 35
            ? 1
            : distance <= 70
              ? 0.8
              : distance <= 140
                ? 0.56
                : distance <= 240
                  ? 0.2
                  : 0
          : 0;
        const gpsDominantBoost = hasGeo && sharedTokens > 0 && distance <= 35 ? 0.5 : 0;
        const score = similarity * 0.52 + distanceScore * 0.48 + exactBaseBoost + gpsDominantBoost;
        if (score > bestScore || (score === bestScore && distance < bestDistance)) {
          bestScore = score;
          bestDistance = distance;
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) {
        crossMatchCache.set(cacheKey, null);
        return null;
      }

      const sharedTokens = sharedStopTokenCount(raw.name, bestCandidate.name);
      if (weakName) {
        const weakMatch = Number.isFinite(bestDistance) && bestDistance <= 90 ? bestCandidate : null;
        crossMatchCache.set(cacheKey, weakMatch);
        return weakMatch;
      }

      if (Number.isFinite(bestDistance) && bestDistance <= 35 && (sharedTokens > 0 || bestScore >= 0.35)) {
        crossMatchCache.set(cacheKey, bestCandidate);
        return bestCandidate;
      }
      if (Number.isFinite(bestDistance) && bestScore >= 0.72 && bestDistance <= 70 && sharedTokens >= 2) {
        crossMatchCache.set(cacheKey, bestCandidate);
        return bestCandidate;
      }
      if (!Number.isFinite(bestDistance) && bestScore >= 0.95 && bestCandidate.baseNameKey === baseNameKey) {
        crossMatchCache.set(cacheKey, bestCandidate);
        return bestCandidate;
      }

      crossMatchCache.set(cacheKey, null);
      return null;
    };

    const mergeMarcelMetadata = (target: InternalStop, routeIds: string[], matchKey: string) => {
      target.providerStopIds = {
        ...(target.providerStopIds || {}),
        marcelRouteIds: mergeCsvValues(target.providerStopIds?.marcelRouteIds, routeIds.join(',')),
        marcelMatchKey: target.providerStopIds?.marcelMatchKey || matchKey,
        marcelMatchKeys: mergeCsvValues(target.providerStopIds?.marcelMatchKeys, matchKey),
      };
    };

    stops.forEach((stop) => {
      const raw = {
        ...stop,
        id: String(stop.id),
        name: stopDisplayName(stop.name),
        provider: 'pks',
        carrier: PKS_CARRIER,
      };
      const pksStop = ensureTechnicalStop(raw);
      (stop.lines || []).forEach((line) => pksStop.lineSet.add(line));
    });

    mpkStops.forEach((mpkStop) => {
      const raw = {
        ...mpkStop,
        id: String(mpkStop.id),
        name: ensureMpkCityPrefix(mpkStop.name, mpkStop.lat, mpkStop.lon),
        provider: 'mpk_rzeszow',
        carrier: MPK_CARRIER,
      };
      const matched =
        findSafeCrossProviderMatch(raw, new Set(['pks'])) ||
        findSafeCrossProviderMatch(raw, new Set(['mpk_rzeszow']));
      const stop = matched ? matched : ensureTechnicalStop(raw);
      if (matched) attachProvider(matched, raw);
      mpkStop.lines.forEach((line) => {
        if (!isHiddenMpkLine(line)) stop.lineSet.add(line);
      });
    });

    marcelStops.forEach((marcelStop) => {
      const displayName = stopDisplayName(marcelStop.name);
      const baseName = stopBaseNameKey(displayName);
      if (!baseName) return;
      const matched =
        findSafeCrossProviderMatch({ name: displayName, lat: marcelStop.lat, lon: marcelStop.lon }, new Set(['pks'])) ||
        findSafeCrossProviderMatch({ name: marcelStop.matchName, lat: marcelStop.lat, lon: marcelStop.lon }, new Set(['pks'])) ||
        findSafeCrossProviderMatch({ name: displayName, lat: marcelStop.lat, lon: marcelStop.lon }, new Set(['mpk_rzeszow', 'marcel'])) ||
        findSafeCrossProviderMatch({ name: marcelStop.matchName, lat: marcelStop.lat, lon: marcelStop.lon }, new Set(['mpk_rzeszow', 'marcel']));
      if (matched) {
        attachProvider(matched, {
          ...marcelStop,
          id: String(marcelStop.id),
          name: displayName,
          provider: 'marcel',
          carrier: MARCEL_CARRIER,
        });
        matched.lineSet.add('M');
        mergeMarcelMetadata(matched, marcelStop.routeIds, marcelStop.matchKey || baseName);
        return;
      }
      if (isWeakMarcelName(displayName)) return;
      if (!canExposeStandaloneMarcelStop(displayName)) return;
      const marcelStandalone = ensureTechnicalStop({
        ...marcelStop,
        id: String(marcelStop.id),
        name: displayName,
        provider: 'marcel',
        carrier: MARCEL_CARRIER,
      });
      marcelStandalone.lineSet.add('M');
      mergeMarcelMetadata(marcelStandalone, marcelStop.routeIds, marcelStop.matchKey || baseName);
    });

    const normalizedStops = [...byTechnical.values()]
      .filter((stop) => stop.id && stop.name)
      .map((stop) => {
        const { lineSet, carrierMap, baseNameKey, displayNamesByProvider, ...cleanStop } = stop;
        return {
          ...cleanStop,
          carriers: [...carrierMap.values()].sort((left, right) => ['pks', 'mpk', 'marcel'].indexOf(left.id) - ['pks', 'mpk', 'marcel'].indexOf(right.id)),
          lines: sortedLines(lineSet),
          isFavorite: false,
        };
      });

    const mergedMpkStops = mergeMpkStopsForList(normalizedStops);
    const mergedStops = mergeStopsByGpsAndName(mergedMpkStops).sort((left, right) => left.name.localeCompare(right.name, 'pl'));

    MERGED_STOPS_RUNTIME_CACHE.set(mergedStopsCacheKey, mergedStops);
    if (MERGED_STOPS_RUNTIME_CACHE.size > MERGED_STOPS_RUNTIME_CACHE_LIMIT) {
      const oldestKey = MERGED_STOPS_RUNTIME_CACHE.keys().next().value;
      if (oldestKey) MERGED_STOPS_RUNTIME_CACHE.delete(oldestKey);
    }
    return mergedStops;
  }, [marcelStops, mergedStopsCacheKey, mpkStops, stops]);

  useEffect(() => {
    const cached = MERGED_STOPS_RUNTIME_CACHE.get(mergedStopsCacheKey);
    const safeApplyCached = (snapshot: Stop[]) => {
      window.setTimeout(() => {
        setMergedStopsBase((current) => (stopCollectionSignature(current) === stopCollectionSignature(snapshot) ? current : snapshot));
        setIsPreparingStops(false);
      }, 0);
    };
    if (cached) {
      safeApplyCached(cached);
      return;
    }

    let cancelled = false;
    window.setTimeout(() => {
      if (!cancelled) setIsPreparingStops(true);
    }, 0);

    const applyMerge = () => {
      if (cancelled) return;
      const merged = buildMergedStopsBase();
      if (cancelled) return;
      setMergedStopsBase((current) => (stopCollectionSignature(current) === stopCollectionSignature(merged) ? current : merged));
      setIsPreparingStops(false);
    };

    let timeoutId: number | null = null;
    let idleId: number | null = null;
    if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
      idleId = (window as any).requestIdleCallback(applyMerge, { timeout: 350 });
    } else {
      timeoutId = window.setTimeout(applyMerge, 0);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null && typeof (window as any).cancelIdleCallback === 'function') {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [buildMergedStopsBase, mergedStopsCacheKey]);

  const baseUiStops = useMemo<Stop[]>(() => {
    if (!Object.keys(pksLinesByStopId).length && !Object.keys(departureLinesByStopId).length) return mergedStopsBase;
    let changed = false;
    const next = mergedStopsBase.map((stop) => {
      const pksLines = pksLinesForStop(stop, pksLinesByStopId);
      const departureLines = indexedLinesForStop(stop, departureLinesByStopId);
      if (!pksLines.length && !departureLines.length) return stop;
      const mergedLineSet = new Set<string>([...(stop.lines || []), ...pksLines, ...departureLines]);
      const lines = sortedLines(mergedLineSet);
      const providerStopIds = {
        ...(stop.providerStopIds || {}),
        pksLines: mergeCsvValues(stop.providerStopIds?.pksLines, pksLines.join(',')),
      };
      if (lines.length === stop.lines.length && lines.every((line, index) => line === stop.lines[index])) {
        const samePksLines = stop.providerStopIds?.pksLines === providerStopIds.pksLines;
        if (samePksLines) return stop;
        changed = true;
        return { ...stop, providerStopIds };
      }
      changed = true;
      return { ...stop, lines, providerStopIds };
    });
    return changed ? next : mergedStopsBase;
  }, [departureLinesByStopId, mergedStopsBase, pksLinesByStopId]);

  const uiStops = useMemo<Stop[]>(() => {
    if (!favorites.length) {
      return baseUiStops.every((stop) => !stop.isFavorite)
        ? baseUiStops
        : baseUiStops.map((stop) => (stop.isFavorite ? { ...stop, isFavorite: false } : stop));
    }
    const favoriteSet = new Set(favorites);
    return baseUiStops.map((stop) => {
      const isFavorite = favoriteSet.has(stop.id);
      return stop.isFavorite === isFavorite ? stop : { ...stop, isFavorite };
    });
  }, [baseUiStops, favorites]);

  const toggleFavorite = useCallback((stopId: string) => {
    onToggleFavorite(stopId);
    setSelectedStop((current) => (current?.id === stopId ? { ...current, isFavorite: !current.isFavorite } : current));
  }, [onToggleFavorite]);

  const loadDepartures = useCallback(async (stop: Stop, dayIndex = 0) => {
    const departures: Departure[] = [];
    const dateIso = selectedDateIso(dayIndex);

    if (stop.sourceProviderIds?.includes('pks') || !stop.sourceProviderIds?.length) {
      const pksStopIds = splitCsvValues(stop.providerStopIds?.pks || stop.id);
      const pksAreaIds = splitCsvValues(stop.providerStopIds?.pksAreaIds || stop.areaId);
      const pksCodes = splitCsvValues(stop.providerStopIds?.pksCodes || stop.code);
      const pksResponses = await Promise.all(
        pksStopIds.map((pksStopId, sourceIndex) =>
          fetchDeparturesClient(
            pksStopId,
            pksAreaIds[sourceIndex] || pksAreaIds[0] || stop.areaId,
            pksCodes[sourceIndex] || pksCodes[0] || stop.code || '',
            dateIso,
          ).catch(() => ({ journeys: [] })),
        ),
      );
      pksResponses.forEach((response) => {
        const journeys = Array.isArray(response?.journeys) ? response.journeys : [];
        journeys.forEach((journey: unknown, index: number) => {
          const mapped = mapJourneyToDeparture(journey as Record<string, unknown>, index);
          if (mapped) departures.push(mapped);
        });
      });
    }

    if (stop.sourceProviderIds?.includes('mpk_rzeszow') && stop.providerStopIds?.mpk_rzeszow) {
      const mpkResponses = await Promise.all(
        splitCsvValues(stop.providerStopIds.mpk_rzeszow).map((mpkStopId) =>
          fetchMpkRzeszowDeparturesClient(mpkStopId, dateIso).catch(() => []),
        ),
      );
      mpkResponses.flat().forEach((entry, index) => {
        const departure = departureFromMpkSchedule(entry as unknown as Record<string, unknown>, dateIso, index);
        if (departure) departures.push(departure);
      });
    }

    if (stop.sourceProviderIds?.includes('marcel')) {
      const routeIds = String(stop.providerStopIds?.marcelRouteIds || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      const routes = routeIds.length > 0
        ? routeIds
        : (await fetchMarcelRoutesClient().catch(() => [])).map((route) => String(route.idTr));
      const providerMatchKeys = splitCsvValues(
        mergeCsvValues(stop.providerStopIds?.marcelMatchKeys, stop.providerStopIds?.marcelMatchKey),
      );
      const fallbackMatchKeys = providerMatchKeys.length ? [] : [stopPreciseNameKey(stop.name)].filter(Boolean);
      const stopNameKeys = new Set([...providerMatchKeys, ...fallbackMatchKeys]);
      const marcelDepartures: Departure[] = [];
      await Promise.all(
        routes.map(async (routeId) => {
          const courses = await fetchMarcelCoursesClient(routeId, dateIso).catch(() => []);
          await Promise.all(
            courses.map(async (course) => {
              const stopsForCourse = await fetchMarcelPublicCourseStopsClient(course.idKu).catch(() => []);
              const matchIndex = stopsForCourse.findIndex((courseStop) => stopNameKeys.has(marcelCourseStopMatchKey(courseStop)));
              if (matchIndex < 0) return;
              const departure = departureFromMarcelCourseStop(course, stopsForCourse[matchIndex], dateIso, matchIndex);
              if (departure) marcelDepartures.push(departure);
            }),
          );
        }),
      );
      departures.push(...marcelDepartures);
    }

    const liveCorrectedDepartures = await applyLiveDepartureCorrections(
      departures,
      stop,
      vehicles,
      dayIndex,
    );
    const visibleDepartures = liveCorrectedDepartures.filter(
      (departure) => !isTechnicalDepartureData(departure.line, departure.direction, [departure.vehicleDesc]),
    );

    const unique = new Map<string, Departure>();
    visibleDepartures.forEach((departure) => unique.set(departure.id, departure));
    const uniqueDepartures = [...unique.values()];
    const allDepartureLines = sortedLines(uniqueDepartures.map((departure) => departure.line).filter(Boolean));
    const pksDepartureLines = sortedLines(
      uniqueDepartures
        .filter((departure) => departure.carrier?.id === 'pks')
        .map((departure) => departure.line)
        .filter(Boolean),
    );
    const indexStopIds = [
      stop.id,
      ...splitCsvValues(stop.providerStopIds?.pks),
      ...splitCsvValues(stop.providerStopIds?.mpk_rzeszow),
      ...splitCsvValues(stop.providerStopIds?.marcel),
    ].filter(Boolean);
    if (indexStopIds.length && allDepartureLines.length) {
      setDepartureLinesByStopId((current) => {
        let changed = false;
        const next = { ...current };
        indexStopIds.forEach((id) => {
          if ((next[id] || []).join('|') === allDepartureLines.join('|')) return;
          next[id] = allDepartureLines;
          changed = true;
        });
        return changed ? next : current;
      });
    }
    if (indexStopIds.length && pksDepartureLines.length) {
      setPksLinesByStopId((current) => {
        let changed = false;
        const next = { ...current };
        indexStopIds.forEach((id) => {
          const merged = sortedLines(new Set([...(next[id] || []), ...pksDepartureLines]));
          if ((next[id] || []).join('|') === merged.join('|')) return;
          next[id] = merged;
          changed = true;
        });
        return changed ? next : current;
      });
    }
    return uniqueDepartures.sort((left, right) => (left.realAtMs || left.plannedAtMs || 0) - (right.realAtMs || right.plannedAtMs || 0));
  }, [vehicles]);

  const handleSelectStop = useCallback((stop: Stop) => {
    setSelectedStop(stop);
  }, []);

  const currentSelectedStop = useMemo(() => {
    if (!selectedStop) return null;
    const latest = uiStops.find((stop) => stop.id === selectedStop.id);
    return latest || selectedStop;
  }, [selectedStop, uiStops]);

  if (hasError) {
    return (
      <div className={`flex h-full w-full items-center justify-center px-6 text-center backdrop-blur-2xl ${errorShellClass}`}>
        <div className="flex max-w-sm flex-col items-center gap-4">
          <p className={`text-sm ${errorTextClass}`}>Nie udalo sie pobrac przystankow.</p>
          <button
            type="button"
            onClick={onRetry}
            className={`rounded-2xl border px-5 py-3 text-xs font-black uppercase tracking-wider transition-colors ${
              isDarkTheme
                ? 'border-teal-400/30 bg-teal-400/10 text-teal-300 hover:bg-teal-400/20'
                : 'border-teal-500/35 bg-teal-500/10 text-teal-700 hover:bg-teal-500/15'
            }`}
          >
            Sprobuj ponownie
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={panelShellClass}>
      <div className="h-full w-full">
        {currentSelectedStop ? (
          <BusStopDetail
            stop={currentSelectedStop}
            onBack={() => setSelectedStop(null)}
            toggleFavorite={toggleFavorite}
            loadDepartures={loadDepartures}
            onShowOnMap={onShowOnMap}
            isDarkTheme={isDarkTheme}
            themeMode={themeMode}
          />
        ) : (
          <StopList
            stops={uiStops}
            isLoading={isLoading || isPreparingStops}
            onStopSelect={handleSelectStop}
            onClose={onClose}
            toggleFavorite={toggleFavorite}
            isFullScreen
            isDarkTheme={isDarkTheme}
            themeMode={themeMode}
            searchState={stopsSearchState}
            onSearchStateChange={(patch) => setStopsSearchState((current) => ({ ...current, ...patch }))}
          />
        )}
      </div>
    </div>
  );
}
