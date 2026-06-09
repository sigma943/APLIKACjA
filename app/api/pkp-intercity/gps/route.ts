import { randomBytes } from 'node:crypto';
import * as signalR from '@microsoft/signalr';
import { NextRequest, NextResponse } from 'next/server';

const IS_EXPORT_BUILD = process.env.NEXT_OUTPUT_MODE === 'export';
export const runtime = 'nodejs';
export const revalidate = 3600;

const HUB_URL = process.env.PKP_INTERCITY_GPS_HUB_URL || 'https://mapa.portalpasazera.pl/alltrainshub';
const REQUEST_BOUNDS: [number, number, number, number] = [49.6, 15.0, 54.2, 24.9];
const REQUEST_ZOOM = 8;
const GPS_TIMEOUT_MS = 9_000;
const CACHE_TTL_MS = 45_000;
const CACHE_STALE_MS = 120_000;

type PortalGpsTrain = {
  s?: number;
  d?: number;
  p?: string;
  n?: string;
  a?: number;
};

type PortalGpsPoint = {
  lat: number;
  lon: number;
  trainNumber: string;
  heading?: number;
};

let cachedGps:
  | {
      value: PortalGpsPoint[];
      expiresAt: number;
      staleUntil: number;
      inflight?: Promise<PortalGpsPoint[]>;
    }
  | null = null;

function normalizeTrainNumber(raw: unknown) {
  const value = String(raw || '').trim().replace(/\s+/g, '');
  if (!value) return '';
  return /^\d+$/.test(value) ? value.replace(/^0+/, '') || value : value.toUpperCase();
}

function parseBboxParam(value: string | null): [number, number, number, number] | null {
  if (!value) return null;
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

function inBoundingBox(point: PortalGpsPoint, bbox: [number, number, number, number] | null) {
  if (!bbox) return true;
  const [south, west, north, east] = bbox;
  return point.lat >= south && point.lat <= north && point.lon >= west && point.lon <= east;
}

function parseTrainStatusPayload(args: unknown[]) {
  if (Array.isArray(args[1])) return args[1] as unknown[];
  if (Array.isArray(args[0])) {
    const nested = args[0] as unknown[];
    if (Array.isArray(nested[1])) return nested[1] as unknown[];
  }
  return [];
}

function parsePortalGpsPoints(payload: unknown[]) {
  const points: PortalGpsPoint[] = [];

  for (const item of payload) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const train = item as PortalGpsTrain;
    if (String(train.p || '').trim().toUpperCase() !== 'IC') continue;

    const trainNumber = normalizeTrainNumber(train.n);
    const lat = Number(train.s);
    const lon = Number(train.d);
    if (!trainNumber || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < 48 || lat > 55.5 || lon < 13.5 || lon > 25.5) continue;

    const heading = Number(train.a);
    points.push({
      lat,
      lon,
      trainNumber,
      heading: Number.isFinite(heading) ? heading : undefined,
    });
  }

  return points;
}

async function loadPortalGpsPoints() {
  const registerArgs = [
    'PL',
    REQUEST_ZOOM,
    REQUEST_BOUNDS[0],
    REQUEST_BOUNDS[1],
    REQUEST_BOUNDS[2],
    REQUEST_BOUNDS[3],
    0,
    true,
    'ATM',
    randomBytes(48).toString('base64url'),
  ];

  const connection = new signalR.HubConnectionBuilder()
    .withUrl(HUB_URL, {
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
        latest = parseTrainStatusPayload(args);
        if (latest.length === 0) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(latest);
      });

      connection
        .start()
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
}

async function getCachedGpsPoints() {
  const now = Date.now();
  if (cachedGps && cachedGps.expiresAt > now) {
    return { value: cachedGps.value, cache: 'fresh' };
  }

  if (cachedGps?.inflight) {
    const value = await cachedGps.inflight;
    return { value, cache: 'fresh' };
  }

  const inflight = loadPortalGpsPoints();
  cachedGps = {
    value: cachedGps?.value || [],
    expiresAt: cachedGps?.expiresAt || 0,
    staleUntil: cachedGps?.staleUntil || 0,
    inflight,
  };

  try {
    const value = await inflight;
    cachedGps = {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
      staleUntil: Date.now() + CACHE_STALE_MS,
    };
    return { value, cache: 'fresh' };
  } catch (error) {
    if (cachedGps.value.length > 0 && cachedGps.staleUntil > now) {
      cachedGps.inflight = undefined;
      return { value: cachedGps.value, cache: 'stale' };
    }
    cachedGps = null;
    throw error;
  }
}

export async function GET(request: NextRequest) {
  if (IS_EXPORT_BUILD) {
    return NextResponse.json(
      {
        vehicles: [],
        providers: { pkp_intercity: 'disabled' },
        meta: { generatedAt: new Date().toISOString(), cache: 'static-export' },
      },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  }

  try {
    const bbox = parseBboxParam(request.nextUrl.searchParams.get('bbox'));
    const { value, cache } = await getCachedGpsPoints();
    const duplicateCounters = new Map<string, number>();
    const nowIso = new Date().toISOString();
    const vehicles = value
      .filter((point) => inBoundingBox(point, bbox))
      .map((point) => {
        const currentIndex = duplicateCounters.get(point.trainNumber) || 0;
        duplicateCounters.set(point.trainNumber, currentIndex + 1);
        const duplicateSuffix = currentIndex > 0 ? `_${currentIndex}` : '';
        const displayName = `IC ${point.trainNumber}`;

        return {
          id: `pkp_intercity_gps_${point.trainNumber}${duplicateSuffix}`,
          provider: 'pkp_intercity',
          operatorName: 'PKP Intercity',
          type: 'train',
          iconVariant: 'IC',
          vehicleNumber: point.trainNumber,
          line: 'IC',
          displayName,
          name: displayName,
          routeId: 'PKP Intercity',
          lat: point.lat,
          lng: point.lon,
          bearing: point.heading,
          direction: 'PKP Intercity',
          delaySeconds: 0,
          schedule: [],
          routeStops: [],
          routePath: [],
          status: 'active',
          statusText: 'GPS',
          positionQuality: 'known',
          lastUpdate: nowIso,
        };
      });

    return NextResponse.json(
      {
        vehicles,
        providers: { pkp_intercity: cache === 'stale' ? 'stale' : 'ok' },
        meta: { generatedAt: nowIso, cache },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        vehicles: [],
        providers: { pkp_intercity: 'error' },
        meta: { generatedAt: new Date().toISOString(), cache: 'miss' },
        error: message,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
