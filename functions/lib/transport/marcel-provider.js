"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.marcelProvider = void 0;
const cache_1 = require("./cache");
const API_BASE_URL = (process.env.MARCEL_API_BASE_URL || 'https://api-site.marcel-bus.pl').replace(/\/$/, '');
const VEHICLES_URL = process.env.MARCEL_VEHICLES_URL || `${API_BASE_URL}/client/api/trasy/lokalizacjaBusow?appVersion=v1.67`;
const API_TOKEN = process.env.MARCEL_API_TOKEN || process.env.MARCEL_BEARER_TOKEN || '';
const ICON_VARIANT = 'marcel';
const MARCEL_STALE_MS = 7 * 60 * 1000;
const positionFreshness = new Map();
const progressFreshness = new Map();
const speedHistory = new Map();
const REQUEST_HEADERS = {
    Accept: 'application/json',
    'Accept-Language': 'pl,en;q=0.9',
    Referer: 'https://ebus.marcel-bus.pl/',
    Origin: 'https://ebus.marcel-bus.pl',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(API_TOKEN ? { Authorization: API_TOKEN.startsWith('Bearer ') ? API_TOKEN : `Bearer ${API_TOKEN}` } : {}),
};
function readString(value) {
    return String(value ?? '').trim();
}
function readFirstString(source, keys) {
    for (const key of keys) {
        const value = readString(source[key]);
        if (value)
            return value;
    }
    return '';
}
function readFirstNumber(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.includes(',')) {
            const normalized = Number(value.replace(',', '.'));
            if (Number.isFinite(normalized))
                return normalized;
        }
        const numeric = Number(value);
        if (Number.isFinite(numeric))
            return numeric;
    }
    return Number.NaN;
}
function readDateMs(value) {
    const raw = readString(value);
    if (!raw)
        return Number.NaN;
    const parsed = new Date(raw.replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function getObservedSignalMs(vehicleKey, lat, lng, now) {
    const signature = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const existing = positionFreshness.get(vehicleKey);
    if (!existing || existing.signature !== signature) {
        positionFreshness.set(vehicleKey, { signature, signalMs: now, lastSeenMs: now });
        return now;
    }
    existing.lastSeenMs = now;
    if (positionFreshness.size > 400) {
        for (const [key, value] of positionFreshness) {
            if (now - value.lastSeenMs > 60 * 60 * 1000)
                positionFreshness.delete(key);
        }
    }
    return existing.signalMs;
}
function getProgressFreshness(vehicleKey, lat, lng, tripId, nextStopId, now) {
    const positionSignature = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const tripProgressSignature = `${readString(tripId)}:${readString(nextStopId)}`;
    const existing = progressFreshness.get(vehicleKey);
    if (!existing) {
        progressFreshness.set(vehicleKey, {
            positionSignature,
            positionSinceMs: now,
            tripProgressSignature,
            tripProgressSinceMs: now,
            lastSeenMs: now,
        });
        return { positionUnchangedMinutes: 0, tripProgressUnchangedMinutes: 0 };
    }
    if (existing.positionSignature !== positionSignature) {
        existing.positionSignature = positionSignature;
        existing.positionSinceMs = now;
    }
    if (existing.tripProgressSignature !== tripProgressSignature) {
        existing.tripProgressSignature = tripProgressSignature;
        existing.tripProgressSinceMs = now;
    }
    existing.lastSeenMs = now;
    if (progressFreshness.size > 500) {
        for (const [key, value] of progressFreshness) {
            if (now - value.lastSeenMs > 2 * 60 * 60 * 1000)
                progressFreshness.delete(key);
        }
    }
    return {
        positionUnchangedMinutes: Math.floor((now - existing.positionSinceMs) / 60000),
        tripProgressUnchangedMinutes: Math.floor((now - existing.tripProgressSinceMs) / 60000),
    };
}
function shouldHideDeadVehicle({ delaySeconds, speed, positionUnchangedMinutes, tripProgressUnchangedMinutes, isAtTerminalOrDepot, }) {
    const hugeDelay = delaySeconds / 60 >= 180;
    const samePlaceLong = positionUnchangedMinutes >= 20;
    const inferredSpeed = Number.isFinite(speed) ? speed : samePlaceLong ? 0 : Number.POSITIVE_INFINITY;
    const notMoving = inferredSpeed <= 2;
    const noTripProgress = tripProgressUnchangedMinutes >= 20;
    return hugeDelay && notMoving && samePlaceLong && (noTripProgress || isAtTerminalOrDepot);
}
function getWarsawDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const read = (type) => Number(parts.find((part) => part.type === type)?.value);
    return { year: read('year'), month: read('month'), day: read('day') };
}
function warsawWallTimeToUtcMs(year, month, day, hour, minute) {
    const guessedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(guessedUtc));
    const read = (type) => Number(parts.find((part) => part.type === type)?.value);
    const renderedAsUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
    return guessedUtc - (renderedAsUtc - guessedUtc);
}
function buildMarcelPlannedMs(timeValue, previousMs, now = new Date()) {
    const raw = readString(timeValue);
    const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!match)
        return Number.NaN;
    const { year, month, day } = getWarsawDateParts(now);
    let plannedMs = warsawWallTimeToUtcMs(year, month, day, Number(match[1]), Number(match[2]));
    if (previousMs !== null && plannedMs < previousMs - 6 * 60 * 60 * 1000)
        plannedMs += 24 * 60 * 60 * 1000;
    return plannedMs;
}
function inBoundingBox(lat, lng, bbox) {
    if (!bbox)
        return true;
    const [south, west, north, east] = bbox;
    return lat >= south && lat <= north && lng >= west && lng <= east;
}
function getVehicleSource(rawVehicle) {
    const position = rawVehicle.position && typeof rawVehicle.position === 'object' ? rawVehicle.position : {};
    const gps = rawVehicle.gps && typeof rawVehicle.gps === 'object' ? rawVehicle.gps : {};
    return { ...rawVehicle, ...position, ...gps };
}
function readVehicleCoordinates(rawVehicle) {
    const source = getVehicleSource(rawVehicle);
    const lat = readFirstNumber(source, ['lat', 'latitude', 'szGps', 'szerokosc', 'szer_geo', 'y']);
    const lng = readFirstNumber(source, ['lng', 'lon', 'long', 'longitude', 'dlGps', 'dlugosc', 'dl_geo', 'x']);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, source } : null;
}
function readVehicleLookupKeys(rawVehicle) {
    const coordinates = readVehicleCoordinates(rawVehicle);
    const source = coordinates?.source || getVehicleSource(rawVehicle);
    const tripId = readFirstString(source, ['trip_id', 'idKu', 'id_ku', 'kursId']);
    const rawVehicleId = readFirstString(source, ['vehicle_id', 'idPo', 'id_po', 'idPojazdu', 'pojazdId']) ||
        tripId ||
        (coordinates ? `${coordinates.lat.toFixed(5)}_${coordinates.lng.toFixed(5)}` : '');
    const vehicleNumber = readFirstString(source, ['nrRej', 'rejestracja', 'vehicleNumber', 'numerBoczny', 'nazwa']);
    return { rawVehicleId, vehicleNumber };
}
async function fetchJsonWithRetry(url, init, retries = 1) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(url, { ...init, signal: controller.signal });
            const text = await response.text();
            if (!response.ok)
                throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
            return JSON.parse(text);
        }
        catch (error) {
            lastError = error;
            if (attempt === retries)
                break;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
function unwrapVehiclesPayload(payload) {
    if (Array.isArray(payload))
        return payload.filter((item) => Boolean(item && typeof item === 'object'));
    if (!payload || typeof payload !== 'object')
        return [];
    const root = payload;
    const embedded = root._embedded && typeof root._embedded === 'object' ? root._embedded : {};
    const candidates = [
        root.items,
        root.content,
        root.data,
        root.vehicles,
        root.pojazdy,
        root.lokalizacje,
        embedded.pojazdy,
        embedded.vehicles,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.filter((item) => Boolean(item && typeof item === 'object'));
        }
    }
    return [];
}
function unwrapCourseStopsPayload(payload) {
    if (Array.isArray(payload))
        return payload.filter((item) => Boolean(item && typeof item === 'object'));
    if (!payload || typeof payload !== 'object')
        return [];
    const root = payload;
    for (const key of ['stops', 'przystanki', 'items', 'data', 'results']) {
        const value = root[key];
        if (Array.isArray(value))
            return value.filter((item) => Boolean(item && typeof item === 'object'));
    }
    return [];
}
function cleanStopName(value) {
    return readString(value)
        .replace(/\s*\([+\-/]+\)\s*$/g, '')
        .replace(/\s+[+-]\s*$/g, '')
        .trim();
}
function getDestination(routeName, fallback = 'W trasie') {
    const normalized = readString(routeName);
    if (!normalized)
        return fallback;
    const parts = normalized.split(/\s*[-–—]\s*/).map((part) => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : normalized;
}
function formatClock(ts) {
    if (!Number.isFinite(ts))
        return '--:--';
    return new Date(ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}
async function loadRawVehicles() {
    return (0, cache_1.getCachedValue)('marcel:raw_vehicles', {
        ttlMs: 10000,
        staleMs: 60000,
        loader: async () => unwrapVehiclesPayload(await fetchJsonWithRetry(VEHICLES_URL, { headers: REQUEST_HEADERS })),
    });
}
async function loadCourseStops(tripId) {
    const id = readString(tripId);
    if (!id)
        return { value: [], cache: 'miss' };
    return (0, cache_1.getCachedValue)(`marcel:course:${id}`, {
        ttlMs: 12 * 60 * 60 * 1000,
        staleMs: 24 * 60 * 60 * 1000,
        loader: async () => {
            let previousMs = null;
            const payload = await fetchJsonWithRetry(`${API_BASE_URL}/client/api/trasy/kurs/${encodeURIComponent(id)}?appVersion=v1.67`, {
                headers: REQUEST_HEADERS,
            });
            return unwrapCourseStopsPayload(payload)
                .map((stop, index) => {
                const lat = readFirstNumber(stop, ['szGps', 'lat', 'latitude', 'szerokosc']);
                const lng = readFirstNumber(stop, ['dlGps', 'lng', 'lon', 'longitude', 'dlugosc']);
                const plannedMs = buildMarcelPlannedMs(stop.godz || stop.godzPr || stop.godzina, previousMs);
                if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(plannedMs))
                    return null;
                previousMs = plannedMs;
                const idRaw = Number(stop.idPr ?? stop.id ?? stop.kol ?? index + 1);
                const city = readString(stop.nazMi || stop.nazwaMi);
                const stopName = cleanStopName(readString(stop.nazPr || stop.nazwaPr || stop.name));
                return {
                    id: Number.isFinite(idRaw) ? idRaw : index + 1,
                    name: [city, stopName].filter(Boolean).join(' - ') || `Przystanek ${index + 1}`,
                    lat,
                    lng,
                    plannedMs,
                    planned: new Date(plannedMs).toISOString(),
                    km: Number.isFinite(Number(stop.km)) ? Number(stop.km) : index,
                    order: Number.isFinite(Number(stop.kol)) ? Number(stop.kol) : index + 1,
                };
            })
                .filter((stop) => Boolean(stop))
                .sort((a, b) => a.order - b.order);
        },
    });
}
async function mapWithConcurrency(items, concurrency, mapper) {
    const results = [];
    for (let start = 0; start < items.length; start += concurrency) {
        const chunk = items.slice(start, start + concurrency);
        results.push(...await Promise.all(chunk.map(mapper)));
    }
    return results;
}
function squaredMetersDistanceToSegment(point, start, end) {
    const meanLat = ((point[0] + start[0] + end[0]) / 3) * Math.PI / 180;
    const metersPerLat = 111320;
    const metersPerLng = Math.cos(meanLat) * 111320;
    const px = point[1] * metersPerLng;
    const py = point[0] * metersPerLat;
    const ax = start[1] * metersPerLng;
    const ay = start[0] * metersPerLat;
    const bx = end[1] * metersPerLng;
    const by = end[0] * metersPerLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    return { distanceSq: (px - cx) * (px - cx) + (py - cy) * (py - cy), t };
}
function distanceMeters(a, b) {
    const meanLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
    const dLat = (a[0] - b[0]) * 111320;
    const dLng = (a[1] - b[1]) * Math.cos(meanLat) * 111320;
    return Math.sqrt(dLat * dLat + dLng * dLng);
}
function computeObservedSpeedKmh(vehicleKey, lat, lng, observedAtMs, rawSpeed) {
    if (Number.isFinite(rawSpeed) && rawSpeed > 0) {
        speedHistory.set(vehicleKey, { lat, lng, atMs: observedAtMs, lastSeenMs: Date.now() });
        return Math.max(0, rawSpeed);
    }
    const previous = speedHistory.get(vehicleKey);
    speedHistory.set(vehicleKey, { lat, lng, atMs: observedAtMs, lastSeenMs: Date.now() });
    if (!previous)
        return Number.isFinite(rawSpeed) ? Math.max(0, rawSpeed) : undefined;
    const elapsedSec = Math.max(0, (observedAtMs - previous.atMs) / 1000);
    const movedMeters = distanceMeters([lat, lng], [previous.lat, previous.lng]);
    if (elapsedSec < 3 || movedMeters < 8)
        return Number.isFinite(rawSpeed) ? Math.max(0, rawSpeed) : 0;
    const speed = (movedMeters / elapsedSec) * 3.6;
    if (!Number.isFinite(speed) || speed > 140)
        return Number.isFinite(rawSpeed) ? Math.max(0, rawSpeed) : undefined;
    return Math.round(speed);
}
function estimateDelaySeconds(lat, lng, stops, nowMs) {
    if (stops.length === 0)
        return 0;
    if (stops.length === 1)
        return Math.round((nowMs - stops[0].plannedMs) / 1000);
    let bestScheduledMs = stops[0].plannedMs;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (let i = 0; i < stops.length - 1; i += 1) {
        const start = stops[i];
        const end = stops[i + 1];
        const { distanceSq, t } = squaredMetersDistanceToSegment([lat, lng], [start.lat, start.lng], [end.lat, end.lng]);
        if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            bestScheduledMs = start.plannedMs + (end.plannedMs - start.plannedMs) * t;
        }
    }
    const delaySeconds = Math.round((nowMs - bestScheduledMs) / 1000);
    return Math.abs(delaySeconds) <= 18000 ? delaySeconds : 0;
}
function buildSchedule(stops, delaySeconds, nowMs) {
    return stops
        .map((stop) => {
        const predictedMs = stop.plannedMs + delaySeconds * 1000;
        return {
            id: stop.id,
            name: stop.name,
            planned: stop.planned,
            real: new Date(predictedMs).toISOString(),
            lat: stop.lat,
            lng: stop.lng,
            isPast: predictedMs < nowMs - 2 * 60 * 1000,
        };
    })
        .filter((stop) => !stop.isPast);
}
function buildRouteStops(stops, delaySeconds, nowMs) {
    return stops.map((stop) => {
        const predictedMs = stop.plannedMs + delaySeconds * 1000;
        return {
            id: stop.id,
            name: stop.name,
            planned: stop.planned,
            real: new Date(predictedMs).toISOString(),
            lat: stop.lat,
            lng: stop.lng,
            isPast: predictedMs < nowMs - 2 * 60 * 1000,
        };
    });
}
function inferStatus(hasLine, lat, lng, stops, delaySeconds, dataAgeSec, nowMs) {
    if (!hasLine)
        return { status: 'inactive', statusText: 'Pojazd bez przypisanej linii' };
    const firstStop = stops[0];
    const firstDepartureMs = firstStop ? firstStop.plannedMs + delaySeconds * 1000 : NaN;
    if (Number.isFinite(firstDepartureMs) && firstDepartureMs - nowMs > 2 * 60 * 1000) {
        return { status: 'break', statusText: `Przerwa do ${formatClock(firstDepartureMs)}` };
    }
    return { status: 'active', statusText: 'W trasie' };
}
async function toTransportVehicle(rawVehicle, now, includeInactive) {
    const coordinates = readVehicleCoordinates(rawVehicle);
    if (!coordinates)
        return null;
    const { lat, lng, source } = coordinates;
    const tripId = readFirstString(source, ['trip_id', 'idKu', 'id_ku', 'kursId']);
    const rawVehicleId = readFirstString(source, ['vehicle_id', 'idPo', 'id_po', 'idPojazdu', 'pojazdId']) ||
        tripId ||
        `${lat.toFixed(5)}_${lng.toFixed(5)}`;
    const vehicleNumber = readFirstString(source, ['nrRej', 'rejestracja', 'vehicleNumber', 'numerBoczny', 'nazwa']);
    const routeName = readFirstString(source, ['nazTr', 'routeName', 'trasa', 'relacja', 'opisTrasy']);
    const line = readFirstString(source, ['linia', 'line', 'lineName', 'nrLinii']) || 'M';
    const hasLine = line !== '?';
    if (!includeInactive && !hasLine)
        return null;
    const lastUpdateRaw = readFirstString(source, ['lastUpdate', 'position_date', 'dataGps', 'data_lokalizacji', 'czas', 'timestamp', 'updatedAt']);
    const lastUpdateMs = readDateMs(lastUpdateRaw);
    const serviceId = readFirstString(source, ['idOb', 'id_ob', 'obsadaId']);
    const signalMs = Number.isFinite(lastUpdateMs)
        ? lastUpdateMs
        : getObservedSignalMs(String(tripId || rawVehicleId), lat, lng, now);
    const dataAgeSec = Math.max(0, Math.floor((now - signalMs) / 1000));
    if (dataAgeSec > MARCEL_STALE_MS / 1000)
        return null;
    const { value: courseStops } = await loadCourseStops(tripId);
    const delaySeconds = estimateDelaySeconds(lat, lng, courseStops, now);
    const schedule = buildSchedule(courseStops, delaySeconds, now);
    const routeStops = buildRouteStops(courseStops, delaySeconds, now);
    const direction = getDestination(routeName || readFirstString(source, ['kierunek', 'direction', 'relacja', 'opisTrasy', 'routeDescription']));
    const vehicleStatus = inferStatus(hasLine, lat, lng, courseStops, delaySeconds, dataAgeSec, now);
    const rawSpeed = readFirstNumber(source, ['speed', 'predkosc', 'prędkość', 'v', 'velocity']);
    const speed = computeObservedSpeedKmh(`marcel:${rawVehicleId}`, lat, lng, signalMs, rawSpeed);
    const nextStopId = schedule[0]?.id ?? routeStops.find((stop) => !stop.isPast)?.id ?? '';
    const progress = getProgressFreshness(String(rawVehicleId), lat, lng, tripId, nextStopId, now);
    const firstStop = routeStops[0];
    const lastStop = routeStops[routeStops.length - 1];
    const isAtTerminalOrDepot = Boolean((firstStop && distanceMeters([lat, lng], [firstStop.lat, firstStop.lng]) <= 350) ||
        (lastStop && distanceMeters([lat, lng], [lastStop.lat, lastStop.lng]) <= 350));
    if (shouldHideDeadVehicle({
        delaySeconds,
        speed: speed ?? Number.NaN,
        positionUnchangedMinutes: progress.positionUnchangedMinutes,
        tripProgressUnchangedMinutes: progress.tripProgressUnchangedMinutes,
        isAtTerminalOrDepot,
    }))
        return null;
    return {
        id: `marcel_${rawVehicleId}`,
        provider: 'marcel',
        operatorName: 'Marcel',
        type: 'bus',
        iconVariant: ICON_VARIANT,
        vehicleNumber: vehicleNumber || undefined,
        line,
        displayName: routeName || line,
        name: `Marcel ${routeName || (line !== '?' ? line : vehicleNumber || rawVehicleId)}`,
        routeId: routeName || (line !== '?' ? line : undefined),
        lat,
        lng,
        bearing: readFirstNumber(source, ['bearing', 'heading', 'azymut', 'kierunekJazdy']),
        speed: Number.isFinite(speed) ? speed : undefined,
        computedSpeed: speed,
        direction,
        delaySeconds,
        delayMinutes: Math.round(delaySeconds / 60),
        dataAgeSec,
        schedule,
        routeStops,
        routePath: routeStops.map((stop) => stop.id),
        model: readFirstString(source, ['model', 'marka', 'typ']),
        lastUpdate: new Date(signalMs).toISOString(),
        previousTripEndedAtMs: vehicleStatus.status === 'break' ? now : undefined,
        nextTripStartAtMs: vehicleStatus.status === 'break' && courseStops[0] ? courseStops[0].plannedMs + delaySeconds * 1000 : undefined,
        nextTripFirstStopId: vehicleStatus.status === 'break' ? courseStops[0]?.id : undefined,
        journeyId: tripId || undefined,
        serviceId: serviceId || undefined,
        tripId: tripId || undefined,
        brigadeName: serviceId || undefined,
        status: vehicleStatus.status,
        statusText: vehicleStatus.statusText,
    };
}
function parseLookupVehicleId(vehicleId) {
    const raw = readString(vehicleId);
    return raw.startsWith('marcel_') ? raw.slice('marcel_'.length) : raw;
}
exports.marcelProvider = {
    id: 'marcel',
    operatorName: 'Marcel',
    implemented: true,
    async getVehicles(options) {
        const { value: rawVehicles, cache } = await loadRawVehicles();
        const now = Date.now();
        const rawVehiclesInScope = options.bbox
            ? rawVehicles.filter((rawVehicle) => {
                const coordinates = readVehicleCoordinates(rawVehicle);
                return coordinates ? inBoundingBox(coordinates.lat, coordinates.lng, options.bbox) : false;
            })
            : rawVehicles;
        const mapped = await mapWithConcurrency(rawVehiclesInScope, 6, (rawVehicle) => toTransportVehicle(rawVehicle, now, options.includeInactive));
        const vehicles = mapped
            .filter((vehicle) => Boolean(vehicle))
            .filter((vehicle) => inBoundingBox(vehicle.lat, vehicle.lng, options.bbox));
        return { vehicles, cache };
    },
    async getVehicleDetails(vehicleId, options) {
        const lookupVehicleId = parseLookupVehicleId(vehicleId);
        const { value: rawVehicles } = await loadRawVehicles();
        const now = Date.now();
        for (const rawVehicle of rawVehicles) {
            const keys = readVehicleLookupKeys(rawVehicle);
            if (keys.rawVehicleId !== lookupVehicleId && keys.vehicleNumber !== lookupVehicleId)
                continue;
            const vehicle = await toTransportVehicle(rawVehicle, now, options?.includeInactive ?? true);
            if (vehicle)
                return vehicle;
        }
        return null;
    },
};
