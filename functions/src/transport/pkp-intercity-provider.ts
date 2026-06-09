import { randomBytes } from 'node:crypto';
import * as signalR from '@microsoft/signalr';
import { getCachedValue } from './cache';
import type { GetVehiclesOptions, ProviderVehiclesResult, TransportProvider, TransportStopSchedule, TransportVehicle } from './types';

const API_BASE_URL = (process.env.PKP_INTERCITY_API_BASE_URL || 'https://pdp-api.plk-sa.pl').replace(/\/$/, '');
const API_KEY = process.env.PKP_INTERCITY_API_KEY || '';
const OPERATOR_NAME = 'PKP Intercity';
const ICON_VARIANTS = new Set(['IC', 'EIC', 'EIP']);
const PORTAL_PASAZERA_HUB_URL = process.env.PKP_INTERCITY_GPS_HUB_URL || 'https://mapa.portalpasazera.pl/alltrainshub';
const PORTAL_GPS_REQUEST_BBOX: [number, number, number, number] = [49.6, 15.0, 54.2, 24.9];
const PORTAL_GPS_REQUEST_ZOOM = 8;
const GPS_TIMEOUT_MS = 9_000;
const METADATA_LOOKUP_LIMIT = 80;

type StationLookup = Record<string, { id: number; name: string; lat?: number; lng?: number }>;

type PortalGpsTrain = {
  t?: number;
  s?: number;
  d?: number;
  o?: number;
  i?: number;
  p?: string;
  n?: string;
  c?: unknown;
  a?: number;
};

type PortalGpsPoint = {
  lat: number;
  lng: number;
  trainNumber: string;
  heading?: number;
};

type PkpRouteMetadata = {
  trainNumber?: string;
  category?: string;
  trainName?: string;
};

function requireApiKey() {
  if (!API_KEY) {
    throw new Error('PKP_INTERCITY_API_KEY is not configured');
  }
  return API_KEY;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson<T>(path: string, params?: Record<string, string | number | boolean | undefined>, retries = 2): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);

    try {
      const response = await fetch(buildUrl(path, params), {
        headers: {
          Accept: 'application/json',
          'X-API-Key': requireApiKey(),
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`PKP Intercity API HTTP ${response.status}: ${text.slice(0, 240)}`);
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function unwrapArray(payload: unknown, keys: string[]) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of keys) {
    const value = readPath(payload, key);
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readPath(source: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, source);
}

function readFirst(source: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function readString(source: Record<string, unknown>, paths: string[], fallback = '') {
  const value = readFirst(source, paths);
  return String(value ?? fallback).trim();
}

function readNumber(source: Record<string, unknown>, paths: string[]) {
  const value = readFirst(source, paths);
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function readDateMs(source: Record<string, unknown>, paths: string[]) {
  const value = readFirst(source, paths);
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const parsed = new Date(raw.replace(' ', 'T')).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function numericId(raw: unknown, fallbackSeed: string) {
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  let hash = 0;
  for (const char of fallbackSeed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return 900_000_000 + (hash % 90_000_000);
}

function normalizeTrainCategory(raw: string) {
  const category = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (category.includes('EIP')) return 'EIP';
  if (category.includes('EIC')) return 'EIC';
  if (category.includes('IC')) return 'IC';
  if (category.includes('TLK')) return 'TLK';
  return category || 'IC';
}

function getIconVariant(category: string) {
  return ICON_VARIANTS.has(category) ? category : 'IC';
}

function normalizeIso(ms: number) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function getRouteStops(operation: Record<string, unknown>) {
  return unwrapArray(operation, [
    'route',
    'fullRoute',
    'stops',
    'trainRoute',
    'operationStops',
    'stations',
    'stoppingPoints',
    'schedule.route',
    'plannedRoute',
  ]);
}

function stationLookupKey(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function stationNameFromRaw(stop: Record<string, unknown>) {
  return readString(stop, [
    'stationName',
    'station.name',
    'stopName',
    'name',
    'commercialStopName',
    'locationName',
  ]);
}

function stationIdFromRaw(stop: Record<string, unknown>) {
  return readFirst(stop, [
    'stationId',
    'station.id',
    'stopId',
    'stop.id',
    'locationId',
    'id',
  ]);
}

function routeStopTimeMs(stop: Record<string, unknown>, type: 'planned' | 'real') {
  const planned = type === 'planned';
  return readDateMs(stop, planned
    ? ['plannedDeparture', 'plannedArrival', 'plannedDepartureTime', 'plannedArrivalTime', 'timetableTime', 'scheduledTime']
    : ['actualDeparture', 'actualArrival', 'realDeparture', 'realArrival', 'estimatedDeparture', 'estimatedArrival', 'actualTime']);
}

function getStopDelayMinutes(stop: Record<string, unknown>, plannedMs: number, realMs: number) {
  const explicit = readNumber(stop, ['delayMinutes', 'delay', 'arrivalDelayMinutes', 'departureDelayMinutes']);
  if (Number.isFinite(explicit)) return explicit;
  if (Number.isFinite(plannedMs) && Number.isFinite(realMs)) return Math.round((realMs - plannedMs) / 60_000);
  return 0;
}

function buildScheduleStops(
  rawStops: Record<string, unknown>[],
  stations: StationLookup,
  now: number,
) {
  const routeStops: TransportStopSchedule[] = [];
  let previousPlannedMs = Number.NaN;

  rawStops.forEach((stop, index) => {
    const stationIdRaw = stationIdFromRaw(stop);
    const stationName = stationNameFromRaw(stop);
    const lookup =
      stations[String(stationIdRaw || '')] ||
      stations[stationLookupKey(stationName)];
    const name = stationName || lookup?.name || `Stacja ${index + 1}`;
    const id = lookup?.id ?? numericId(stationIdRaw, `${name}:${index}`);
    const plannedMs = routeStopTimeMs(stop, 'planned');
    const realMs = routeStopTimeMs(stop, 'real');
    const delayMinutes = getStopDelayMinutes(stop, plannedMs, realMs);
    const platform = readString(stop, ['departurePlatform', 'arrivalPlatform', 'platform', 'platformNumber', 'plannedPlatform']);
    const track = readString(stop, ['departureTrack', 'arrivalTrack', 'track', 'trackNumber', 'plannedTrack']);
    const timeType: 'arrival' | 'departure' = readFirst(stop, ['plannedDeparture', 'actualDeparture', 'departureDelayMinutes'])
      ? 'departure'
      : 'arrival';
    const effectiveRealMs = Number.isFinite(realMs)
      ? realMs
      : Number.isFinite(plannedMs)
        ? plannedMs + delayMinutes * 60_000
        : Number.NaN;
    const lat = readNumber(stop, ['lat', 'latitude', 'station.lat', 'station.latitude', 'location.lat']);
    const lng = readNumber(stop, ['lng', 'lon', 'long', 'longitude', 'station.lng', 'station.lon', 'station.longitude', 'location.lng']);
    const stopPlannedMs = Number.isFinite(plannedMs) ? plannedMs : previousPlannedMs;
    if (Number.isFinite(plannedMs)) previousPlannedMs = plannedMs;

    routeStops.push({
      id,
      name,
      planned: normalizeIso(stopPlannedMs),
      real: normalizeIso(effectiveRealMs),
      lat: Number.isFinite(lat) ? lat : lookup?.lat,
      lng: Number.isFinite(lng) ? lng : lookup?.lng,
      isPast: Number.isFinite(effectiveRealMs) ? effectiveRealMs < now - 2 * 60_000 : false,
      platform: platform || undefined,
      track: track || undefined,
      stopDelayMinutes: Number.isFinite(delayMinutes) ? delayMinutes : undefined,
      timeType,
    });
  });

  return routeStops;
}

function getTrainDelaySeconds(operation: Record<string, unknown>, stops: TransportStopSchedule[], now: number) {
  const explicitMinutes = readNumber(operation, ['delayMinutes', 'delay', 'currentDelayMinutes', 'maxDelayMinutes']);
  if (Number.isFinite(explicitMinutes) && Math.abs(explicitMinutes) <= 300) return Math.round(explicitMinutes * 60);

  const upcoming = stops.find((stop) => {
    const timeMs = new Date(String(stop.real || stop.planned || '')).getTime();
    return !stop.isPast && Number.isFinite(timeMs) && timeMs >= now - 2 * 60_000;
  });
  if (!upcoming?.planned || !upcoming.real) return 0;
  const plannedMs = new Date(upcoming.planned).getTime();
  const realMs = new Date(upcoming.real).getTime();
  if (!Number.isFinite(plannedMs) || !Number.isFinite(realMs)) return 0;
  const delaySeconds = Math.round((realMs - plannedMs) / 1000);
  return Math.abs(delaySeconds) <= 18_000 ? delaySeconds : 0;
}

function getDataAgeSec(operation: Record<string, unknown>, now: number) {
  const updateMs = readDateMs(operation, ['lastUpdate', 'updatedAt', 'generatedAt', 'operationUpdateTime', 'dataTimestamp']);
  if (!Number.isFinite(updateMs)) return undefined;
  return Math.max(0, Math.floor((now - updateMs) / 1000));
}

function relationFromOperation(operation: Record<string, unknown>, routeStops: TransportStopSchedule[]) {
  const explicit = readString(operation, ['relation', 'routeDescription', 'direction', 'destination', 'endStationName']);
  if (explicit) return explicit;
  const first = routeStops[0]?.name;
  const last = routeStops[routeStops.length - 1]?.name;
  if (first && last && first !== last) return `${first} - ${last}`;
  return last || 'W trasie';
}

function idsFromOperation(operation: Record<string, unknown>) {
  const scheduleId = readString(operation, ['scheduleId', 'sid', 'schedule.id']);
  const orderId = readString(operation, ['orderId', 'oid', 'order.id']);
  const operatingDate = readString(operation, ['operatingDate', 'date', 'serviceDate']);
  return { scheduleId, orderId, operatingDate };
}

function normalizeTrainNumber(raw: unknown) {
  const normalized = String(raw || '').trim();
  if (!normalized) return '';
  if (!/^[0-9A-Za-z-]+$/.test(normalized)) return '';
  const compact = normalized.replace(/\s+/g, '');
  if (/^\d+$/.test(compact)) {
    const clean = compact.replace(/^0+/, '');
    return clean || compact;
  }
  return compact.toUpperCase();
}

function canonicalTrainNumber(raw: unknown) {
  const normalized = normalizeTrainNumber(raw);
  if (!normalized) return '';
  if (/^\d+$/.test(normalized)) return normalized.replace(/^0+/, '') || normalized;
  return normalized.toUpperCase();
}

function operationTrainNumber(operation: Record<string, unknown>) {
  const direct = normalizeTrainNumber(readString(operation, [
    'nationalNumber',
    'commercialTrainNumber',
    'trainNumber',
    'number',
    'trainNo',
  ]));
  if (!direct) return '';
  const scheduleId = readString(operation, ['scheduleId', 'sid']);
  if (scheduleId && direct === scheduleId) return '';
  if (/^20\d{2}$/.test(direct) && direct === scheduleId) return '';
  return direct;
}

function randomGpsSessionToken() {
  return randomBytes(48).toString('base64url');
}

function buildGpsCacheKey() {
  return 'pkp_intercity:gps:poland';
}

function isValidPortalGpsTrain(value: unknown): value is PortalGpsTrain {
  return isRecord(value);
}

function parsePortalGpsPoints(payload: unknown) {
  const trains = Array.isArray(payload) ? payload.filter(isValidPortalGpsTrain) : [];
  const points: PortalGpsPoint[] = [];

  for (const train of trains) {
    const carrier = String(train.p || '').trim().toUpperCase();
    if (carrier !== 'IC') continue;
    const trainNumber = normalizeTrainNumber(train.n);
    if (!trainNumber) continue;
    const lat = Number(train.s);
    const lng = Number(train.d);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < 48 || lat > 55.5 || lng < 13.5 || lng > 25.5) continue;
    const heading = Number(train.a);

    points.push({
      lat,
      lng,
      trainNumber,
      heading: Number.isFinite(heading) ? heading : undefined,
    });
  }

  return points;
}

async function fetchPortalGpsSnapshot(bbox?: [number, number, number, number] | null) {
  void bbox;
  const bounds = PORTAL_GPS_REQUEST_BBOX;
  const cacheKey = buildGpsCacheKey();

  return getCachedValue(cacheKey, {
    ttlMs: 45_000,
    staleMs: 75_000,
    loader: async () => {
      const registerArgs = [
        'PL',
        PORTAL_GPS_REQUEST_ZOOM,
        bounds[0],
        bounds[1],
        bounds[2],
        bounds[3],
        0,
        true,
        'ATM',
        randomGpsSessionToken(),
      ];

      const connection = new signalR.HubConnectionBuilder()
        .withUrl(PORTAL_PASAZERA_HUB_URL, {
          withCredentials: false,
          transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling,
          headers: {
            Origin: 'https://mapa.portalpasazera.pl',
            Referer: 'https://mapa.portalpasazera.pl/',
            'User-Agent': 'Mozilla/5.0',
          },
        })
        .configureLogging(signalR.LogLevel.None)
        .build();

      try {
        const payload = await new Promise<unknown[]>((resolve, reject) => {
          let settled = false;
          let latest: unknown[] = [];
          const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            if (latest.length > 0) resolve(latest);
            else reject(new Error('Portal Pasazera GPS timeout'));
          }, GPS_TIMEOUT_MS);

          connection.on('TrainStatus', (...args: unknown[]) => {
            if (settled) return;
            const points =
              Array.isArray(args[1]) ? args[1]
                : (Array.isArray(args[0]) && Array.isArray((args[0] as unknown[])[1]))
                  ? ((args[0] as unknown[])[1] as unknown[])
                  : [];
            latest = Array.isArray(points) ? points : [];
            if (latest.length === 0) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(latest);
          });

          connection.start()
            .then(() => connection.invoke('RegisterParams', ...registerArgs))
            .catch((error) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              reject(error);
            });
        });

        return parsePortalGpsPoints(payload);
      } finally {
        try {
          await connection.stop();
        } catch {
          // ignore close errors
        }
      }
    },
  });
}

function inBoundingBox(lat: number, lng: number, bbox?: [number, number, number, number] | null) {
  if (!bbox) return true;
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function parseLookupVehicleId(vehicleId: string) {
  return String(vehicleId || '').replace(/^pkp_intercity_/, '');
}

function gpsVehicleId(point: PortalGpsPoint) {
  const numberKey = canonicalTrainNumber(point.trainNumber) || 'unknown';
  const latKey = Math.round(point.lat * 10_000);
  const lngKey = Math.round(point.lng * 10_000);
  return `pkp_intercity_gps_${numberKey}_${latKey}_${lngKey}`;
}

function trainNumberFromVehicleId(vehicleId: string) {
  const raw = parseLookupVehicleId(vehicleId);
  if (raw.startsWith('gps_')) {
    const parts = raw.split('_');
    return normalizeTrainNumber(parts[1]);
  }
  const parts = raw.split('_');
  if (parts.length >= 1 && /^\d+$/.test(parts[0])) return normalizeTrainNumber(parts[0]);
  return '';
}

function mapGpsPointToVehicle(point: PortalGpsPoint): TransportVehicle {
  const displayNumber = normalizeTrainNumber(point.trainNumber);
  const displayName = displayNumber ? `IC ${displayNumber}` : 'IC';
  return {
    id: gpsVehicleId(point),
    provider: 'pkp_intercity',
    operatorName: OPERATOR_NAME,
    type: 'train',
    iconVariant: 'IC',
    vehicleNumber: displayNumber || undefined,
    line: 'IC',
    displayName,
    name: displayName,
    lat: point.lat,
    lng: point.lng,
    bearing: point.heading,
    direction: 'PKP Intercity',
    delaySeconds: 0,
    delayMinutes: 0,
    schedule: [],
    routeStops: [],
    routePath: [],
    status: 'active',
    statusText: 'GPS',
    positionQuality: 'known',
    lastUpdate: new Date().toISOString(),
  };
}

async function loadStationsLookup() {
  return getCachedValue('pkp_intercity:stations', {
    ttlMs: 24 * 60 * 60 * 1000,
    staleMs: 24 * 60 * 60 * 1000,
    loader: async () => {
      const lookup: StationLookup = {};
      for (let page = 1; page <= 40; page += 1) {
        const payload = await fetchJson<unknown>('/api/v1/dictionaries/stations', { page, pageSize: 1000 });
        const stations = unwrapArray(payload, ['stations', 'items', 'data', 'results']);
        if (stations.length === 0) break;

        for (const station of stations) {
          const rawId = readFirst(station, ['id', 'stationId']);
          const name = readString(station, ['name', 'stationName']);
          if (!name && !rawId) continue;
          const id = numericId(rawId, name || String(rawId));
          const lat = readNumber(station, ['lat', 'latitude', 'location.lat']);
          const lng = readNumber(station, ['lng', 'lon', 'long', 'longitude', 'location.lng']);
          const item = {
            id,
            name: name || `Stacja ${id}`,
            lat: Number.isFinite(lat) ? lat : undefined,
            lng: Number.isFinite(lng) ? lng : undefined,
          };
          lookup[String(rawId || id)] = item;
          lookup[stationLookupKey(name)] = item;
        }

        if (stations.length < 1000) break;
      }
      return lookup;
    },
  });
}

async function loadOperations() {
  return getCachedValue('pkp_intercity:operations', {
    ttlMs: 45_000,
    staleMs: 90_000,
    loader: async () => {
      const operations: Record<string, unknown>[] = [];
      const pageSize = 500;

      for (let page = 1; page <= 20; page += 1) {
        const payload = await fetchJson<unknown>('/api/v1/operations', {
          carriersInclude: 'IC',
          fullRoutes: true,
          withPlanned: true,
          pageSize,
          page,
        });
        const items = unwrapArray(payload, ['operations', 'items', 'data', 'results', 'trains']);
        operations.push(...items);

        const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : null;
        const hasNextPage = pagination ? Boolean(pagination.hasNextPage) : items.length >= pageSize;
        if (!hasNextPage || items.length === 0) break;
      }

      return operations;
    },
  });
}

async function loadRouteMetadata(scheduleId: string, orderId: string): Promise<PkpRouteMetadata | null> {
  if (!scheduleId || !orderId) return null;

  const cacheKey = `pkp_intercity:route_meta:${scheduleId}:${orderId}`;
  const { value } = await getCachedValue(cacheKey, {
    ttlMs: 12 * 60 * 60 * 1000,
    staleMs: 36 * 60 * 60 * 1000,
    loader: async () => {
      const payload = await fetchJson<unknown>(`/api/v1/schedules/route/${encodeURIComponent(scheduleId)}/${encodeURIComponent(orderId)}`);
      if (!isRecord(payload)) return null;

      const stations = unwrapArray(payload, ['stations', 'route', 'items']);
      const stationNumber = stations
        .map((station) => readString(station, ['departureTrainNumber', 'arrivalTrainNumber', 'trainNumber']))
        .find(Boolean);
      const stationCategory = stations
        .map((station) => readString(station, ['departureCommercialCategory', 'arrivalCommercialCategory', 'commercialCategory']))
        .find(Boolean);

      const trainNumber = normalizeTrainNumber(
        readString(payload, ['nationalNumber', 'commercialTrainNumber', 'trainNumber', 'number']) || stationNumber,
      );
      const category = normalizeTrainCategory(
        readString(payload, ['commercialCategorySymbol', 'commercialCategory', 'category']) || stationCategory || 'IC',
      );
      const trainName = readString(payload, ['name', 'trainName']);

      return {
        trainNumber: trainNumber || undefined,
        category,
        trainName: trainName || undefined,
      } satisfies PkpRouteMetadata;
    },
  });

  return value;
}

function mapOperationToVehicle(
  operation: Record<string, unknown>,
  stations: StationLookup,
  now: number,
  gpsPoint: PortalGpsPoint,
  metadata: PkpRouteMetadata | null,
): TransportVehicle {
  const rawStops = getRouteStops(operation);
  const routeStops = buildScheduleStops(rawStops, stations, now);
  const ids = idsFromOperation(operation);
  const operationNumber = operationTrainNumber(operation);
  const trainNumber = metadata?.trainNumber || operationNumber || gpsPoint.trainNumber;
  const category = normalizeTrainCategory(metadata?.category || readString(operation, ['commercialCategory', 'category', 'trainCategory', 'kind'], 'IC'));
  const id = [
    ids.scheduleId || trainNumber,
    ids.orderId,
    ids.operatingDate,
  ].filter(Boolean).join('_') || `pkp_intercity_${trainNumber || Date.now()}`;
  const delaySeconds = getTrainDelaySeconds(operation, routeStops, now);
  const dataAgeSec = getDataAgeSec(operation, now);
  const speed = readNumber(operation, ['speed', 'position.speed']);
  const statusRaw = readString(operation, ['status', 'trainStatus', 'operationStatus']);
  const cancelled = /cancel|odwo|annul/i.test(statusRaw);
  const relation = relationFromOperation(operation, routeStops);
  const lastUpdateMs = readDateMs(operation, ['lastUpdate', 'updatedAt', 'generatedAt', 'operationUpdateTime', 'dataTimestamp']);
  const trainName = metadata?.trainName || readString(operation, ['trainName', 'compositionName', 'name']);
  const displayName = `${category} ${trainNumber}`.trim();

  return {
    id: `pkp_intercity_${id}`,
    provider: 'pkp_intercity',
    operatorName: OPERATOR_NAME,
    type: 'train',
    iconVariant: getIconVariant(category),
    vehicleNumber: trainNumber || undefined,
    line: category,
    displayName: displayName || category,
    name: displayName || category,
    routeId: relation,
    lat: gpsPoint.lat,
    lng: gpsPoint.lng,
    bearing: gpsPoint.heading,
    speed: Number.isFinite(speed) ? speed : undefined,
    direction: relation,
    delaySeconds,
    delayMinutes: Math.round(delaySeconds / 60),
    dataAgeSec,
    schedule: routeStops.filter((stop) => !stop.isPast),
    routeStops,
    routePath: routeStops.map((stop) => stop.id),
    model: readString(operation, ['model']) || undefined,
    trainName: trainName || undefined,
    lastUpdate: Number.isFinite(lastUpdateMs) ? new Date(lastUpdateMs).toISOString() : new Date(now).toISOString(),
    journeyId: ids.scheduleId || trainNumber,
    serviceId: ids.orderId || undefined,
    tripId: [ids.scheduleId, ids.orderId, ids.operatingDate].filter(Boolean).join('/') || undefined,
    brigadeName: trainNumber || undefined,
    status: cancelled ? 'inactive' : 'active',
    statusText: statusRaw || 'GPS',
    positionQuality: 'known',
  };
}

async function loadTrainDetails(vehicleId: string, stations: StationLookup, now: number) {
  const rawId = parseLookupVehicleId(vehicleId);
  const [scheduleId, orderId, operatingDate] = rawId.split('_');
  if (!scheduleId || !orderId || !operatingDate) return null;

  const [payload, metadata, gpsSnapshot] = await Promise.all([
    fetchJson<unknown>(
      `/api/v1/operations/train/${encodeURIComponent(scheduleId)}/${encodeURIComponent(orderId)}/${encodeURIComponent(operatingDate)}`,
    ),
    loadRouteMetadata(scheduleId, orderId).catch(() => null),
    fetchPortalGpsSnapshot(null).catch(() => ({ value: [] as PortalGpsPoint[], cache: 'miss' as const })),
  ]);

  const operation = isRecord(payload)
    ? (isRecord(payload.operation) ? payload.operation : isRecord(payload.train) ? payload.train : isRecord(payload.data) ? payload.data : payload)
    : unwrapArray(payload, ['operation', 'train', 'data'])[0];
  if (!operation) return null;

  const fallbackNumber = metadata?.trainNumber || operationTrainNumber(operation);
  const targetGps = gpsSnapshot.value.find((point) =>
    canonicalTrainNumber(point.trainNumber) === canonicalTrainNumber(fallbackNumber),
  );
  if (!targetGps) return null;

  return mapOperationToVehicle(operation, stations, now, targetGps, metadata);
}

export const pkpIntercityProvider: TransportProvider = {
  id: 'pkp_intercity',
  operatorName: OPERATOR_NAME,
  implemented: true,

  async getVehicles(options: GetVehiclesOptions): Promise<ProviderVehiclesResult> {
    const gpsResult = await fetchPortalGpsSnapshot(options.bbox)
      .catch(() => ({ value: [] as PortalGpsPoint[], cache: 'miss' as const }));

    const vehicles = gpsResult.value
      .filter((point) => inBoundingBox(point.lat, point.lng, options.bbox))
      .map((point) => mapGpsPointToVehicle(point));

    return { vehicles, cache: gpsResult.cache };
  },

  async getVehicleDetails(vehicleId: string): Promise<TransportVehicle | null> {
    const now = Date.now();
    const { value: stations } = await loadStationsLookup().catch(() => ({ value: {} as StationLookup, cache: 'miss' as const }));
    const targetNumber = canonicalTrainNumber(trainNumberFromVehicleId(vehicleId));

    const detailed = await loadTrainDetails(vehicleId, stations, now).catch(() => null);
    if (detailed) return detailed;

    const [{ value: operations }, { value: gpsPoints }] = await Promise.all([
      loadOperations().catch(() => ({ value: [] as Record<string, unknown>[], cache: 'miss' as const })),
      fetchPortalGpsSnapshot(null).catch(() => ({ value: [] as PortalGpsPoint[], cache: 'miss' as const })),
    ]);

    const gpsByNumber = new Map<string, PortalGpsPoint>();
    for (const point of gpsPoints) {
      const key = canonicalTrainNumber(point.trainNumber);
      if (key && !gpsByNumber.has(key)) gpsByNumber.set(key, point);
    }

    if (!targetNumber) {
      const fallbackPoint = gpsPoints[0];
      return fallbackPoint ? mapGpsPointToVehicle(fallbackPoint) : null;
    }

    for (const operation of operations) {
      const quickNumber = canonicalTrainNumber(operationTrainNumber(operation));
      if (quickNumber && quickNumber === targetNumber) {
        const gpsPoint = gpsByNumber.get(targetNumber);
        if (!gpsPoint) continue;
        return mapOperationToVehicle(operation, stations, now, gpsPoint, null);
      }
    }

    let metadataLookups = 0;
    for (const operation of operations) {
      if (metadataLookups >= METADATA_LOOKUP_LIMIT) break;
      const ids = idsFromOperation(operation);
      if (!ids.scheduleId || !ids.orderId) continue;
      metadataLookups += 1;

      const metadata = await loadRouteMetadata(ids.scheduleId, ids.orderId).catch(() => null);
      if (!metadata?.trainNumber) continue;
      if (canonicalTrainNumber(metadata.trainNumber) !== targetNumber) continue;

      const gpsPoint = gpsByNumber.get(targetNumber);
      if (!gpsPoint) return null;

      return mapOperationToVehicle(operation, stations, now, gpsPoint, metadata);
    }

    const point = gpsByNumber.get(targetNumber);
    return point ? mapGpsPointToVehicle(point) : null;
  },
};
