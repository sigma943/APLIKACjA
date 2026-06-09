"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__routeGeometryTestHooks = void 0;
exports.resolveRouteGeometry = resolveRouteGeometry;
const firestore_1 = require("firebase-admin/firestore");
const routeGeometryCache = new Map();
const routeGeometryInflight = new Map();
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_WAYPOINTS_PER_OSRM_REQUEST = 24;
const MAX_SEGMENT_DISTANCE_METERS = 350000;
const MAX_RAIL_SEGMENT_DISTANCE_METERS = 180000;
const MIN_SEGMENT_DISTANCE_METERS = 8;
const OVERPASS_API_URL = process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter';
const ROUTE_GEOMETRY_ALGORITHM_VERSION = 'hybrid-v2';
const FIRESTORE_ROUTE_GEOMETRY_COLLECTION = 'route_geometries';
function normalizeText(value, fallback = '') {
    return String(value ?? fallback).trim();
}
function slugCachePart(value) {
    return normalizeText(value, 'unknown')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 90) || 'unknown';
}
function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
function normalizeIdentityPart(value, fallback = 'unknown') {
    return slugCachePart(normalizeText(value, fallback).toLowerCase());
}
function endpointPart(stop, fallback) {
    if (!stop)
        return fallback;
    const id = normalizeText(stop.id);
    if (id)
        return `id-${slugCachePart(id)}`;
    const name = normalizeText(stop.name);
    if (name)
        return `name-${slugCachePart(name.toLowerCase())}`;
    return [
        Number(stop.lat).toFixed(5),
        Number(stop.lon).toFixed(5),
    ].join(',');
}
function stopFingerprint(stops) {
    return stops
        .map((stop) => [
        normalizeText(stop.id),
        Number(stop.lat).toFixed(5),
        Number(stop.lon).toFixed(5),
    ].join(':'))
        .join('|');
}
function cacheIdentityForRequest(request, stops) {
    const forwardFingerprint = stopFingerprint(stops);
    const reverseFingerprint = stopFingerprint([...stops].reverse());
    const forwardHash = stableHash(forwardFingerprint);
    const reverseHash = stableHash(reverseFingerprint);
    const canonicalHash = forwardHash <= reverseHash ? forwardHash : reverseHash;
    const shouldReverseStoredGeometry = canonicalHash !== forwardHash;
    const firstEndpoint = endpointPart(stops[0], 'start');
    const lastEndpoint = endpointPart(stops[stops.length - 1], 'end');
    const endpoints = [firstEndpoint, lastEndpoint].sort();
    const baseParts = [
        'routeGeometry',
        normalizeIdentityPart(request.mode || 'road'),
        normalizeIdentityPart(request.carrier),
        normalizeIdentityPart(request.line),
        endpoints[0],
        endpoints[1],
        normalizeIdentityPart(request.dataVersion || 'v1'),
        ROUTE_GEOMETRY_ALGORITHM_VERSION,
    ];
    const canonicalKey = [...baseParts, canonicalHash].join(':');
    const exactKey = [...baseParts, forwardHash].join(':');
    const readablePrefix = [
        normalizeIdentityPart(request.mode || 'road'),
        normalizeIdentityPart(request.carrier),
        normalizeIdentityPart(request.line),
    ].join('_').slice(0, 90);
    const firestoreDocId = `${readablePrefix}_${stableHash(canonicalKey)}`;
    return {
        exactKey,
        canonicalKey,
        firestoreDocId,
        forwardHash,
        reverseHash,
        canonicalHash,
        shouldReverseStoredGeometry,
        endpoints,
    };
}
function encodeSignedNumber(value) {
    let next = value < 0 ? ~(value << 1) : value << 1;
    let encoded = '';
    while (next >= 0x20) {
        encoded += String.fromCharCode((0x20 | (next & 0x1f)) + 63);
        next >>= 5;
    }
    encoded += String.fromCharCode(next + 63);
    return encoded;
}
function encodePolyline(points, precision = 5) {
    const factor = 10 ** precision;
    let previousLat = 0;
    let previousLon = 0;
    let encoded = '';
    for (const [lat, lon] of points) {
        const scaledLat = Math.round(lat * factor);
        const scaledLon = Math.round(lon * factor);
        encoded += encodeSignedNumber(scaledLat - previousLat);
        encoded += encodeSignedNumber(scaledLon - previousLon);
        previousLat = scaledLat;
        previousLon = scaledLon;
    }
    return encoded;
}
function decodePolyline(encoded, precision = 5) {
    const factor = 10 ** precision;
    const points = [];
    let index = 0;
    let lat = 0;
    let lon = 0;
    const decodeValue = () => {
        let result = 0;
        let shift = 0;
        let byte = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20 && index <= encoded.length);
        return (result & 1) ? ~(result >> 1) : (result >> 1);
    };
    while (index < encoded.length) {
        lat += decodeValue();
        lon += decodeValue();
        points.push([lat / factor, lon / factor]);
    }
    return points;
}
function distanceMeters(a, b) {
    const meanLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
    const dLat = (a[0] - b[0]) * 111320;
    const dLon = (a[1] - b[1]) * Math.cos(meanLat) * 111320;
    return Math.sqrt(dLat * dLat + dLon * dLon);
}
function isInServiceArea(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
        return false;
    if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001)
        return false;
    return lat >= 48 && lat <= 55.5 && lon >= 13.5 && lon <= 25.5;
}
function cleanStops(stops) {
    const sorted = [...stops].sort((left, right) => {
        const leftSeq = Number(left.sequence);
        const rightSeq = Number(right.sequence);
        if (Number.isFinite(leftSeq) && Number.isFinite(rightSeq))
            return leftSeq - rightSeq;
        return 0;
    });
    const clean = [];
    for (const stop of sorted) {
        const lat = Number(stop.lat);
        const lon = Number(stop.lon);
        if (!isInServiceArea(lat, lon))
            continue;
        const last = clean[clean.length - 1];
        if (last) {
            const sameId = normalizeText(last.id) && normalizeText(last.id) === normalizeText(stop.id);
            const samePoint = distanceMeters([last.lat, last.lon], [lat, lon]) < MIN_SEGMENT_DISTANCE_METERS;
            if (sameId || samePoint)
                continue;
        }
        clean.push({
            id: stop.id,
            name: normalizeText(stop.name),
            lat,
            lon,
            sequence: Number.isFinite(Number(stop.sequence)) ? Number(stop.sequence) : clean.length,
        });
    }
    return clean;
}
function appendPoints(target, points) {
    for (const point of points) {
        const last = target[target.length - 1];
        if (last && distanceMeters(last, point) < 1)
            continue;
        target.push(point);
    }
}
async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        if (!response.ok)
            throw new Error(`OSRM HTTP ${response.status}: ${text.slice(0, 180)}`);
        return JSON.parse(text);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function postTextWithTimeout(url, body, timeoutMs = 22000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const requestUrl = `${url}?data=${encodeURIComponent(body)}`;
        const response = await fetch(requestUrl, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'pks-live/2.1',
            },
            signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok)
            throw new Error(`Overpass HTTP ${response.status}: ${text.slice(0, 180)}`);
        return JSON.parse(text);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function fetchOsrmRoute(points) {
    if (points.length < 2)
        return [];
    const coordString = points.map(([lat, lon]) => `${lon},${lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&alternatives=false&steps=false&continue_straight=false`;
    const data = await fetchJsonWithTimeout(url);
    return data.routes?.[0]?.geometry?.coordinates?.map(([lon, lat]) => [lat, lon]) || [];
}
function decodeValhallaShape(shape) {
    const points = [];
    let index = 0;
    let lat = 0;
    let lon = 0;
    const precision = 1e6;
    while (index < shape.length) {
        let result = 1;
        let shift = 0;
        let byte = 0;
        do {
            byte = shape.charCodeAt(index++) - 63 - 1;
            result += byte << shift;
            shift += 5;
        } while (byte >= 0x1f && index < shape.length);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        result = 1;
        shift = 0;
        do {
            byte = shape.charCodeAt(index++) - 63 - 1;
            result += byte << shift;
            shift += 5;
        } while (byte >= 0x1f && index < shape.length);
        lon += (result & 1) ? ~(result >> 1) : (result >> 1);
        points.push([lat / precision, lon / precision]);
    }
    return points;
}
async function fetchValhallaRoute(points) {
    if (points.length < 2)
        return [];
    const query = {
        locations: points.map(([lat, lon]) => ({ lat, lon, type: 'break' })),
        costing: 'bus',
        directions_options: { units: 'kilometers' },
    };
    const url = `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(query))}`;
    const data = await fetchJsonWithTimeout(url, 14000);
    const routePoints = [];
    for (const leg of data.trip?.legs || []) {
        const decoded = leg.shape ? decodeValhallaShape(leg.shape) : [];
        appendPoints(routePoints, decoded);
    }
    return routePoints;
}
class MinHeap {
    constructor() {
        this.values = [];
    }
    push(value) {
        this.values.push(value);
        this.bubbleUp(this.values.length - 1);
    }
    pop() {
        if (this.values.length === 0)
            return undefined;
        const top = this.values[0];
        const end = this.values.pop();
        if (end && this.values.length > 0) {
            this.values[0] = end;
            this.sinkDown(0);
        }
        return top;
    }
    get size() {
        return this.values.length;
    }
    bubbleUp(index) {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.values[parent].distance <= this.values[index].distance)
                break;
            [this.values[parent], this.values[index]] = [this.values[index], this.values[parent]];
            index = parent;
        }
    }
    sinkDown(index) {
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let smallest = index;
            if (left < this.values.length && this.values[left].distance < this.values[smallest].distance)
                smallest = left;
            if (right < this.values.length && this.values[right].distance < this.values[smallest].distance)
                smallest = right;
            if (smallest === index)
                break;
            [this.values[smallest], this.values[index]] = [this.values[index], this.values[smallest]];
            index = smallest;
        }
    }
}
function railBboxForSegment(start, end) {
    const direct = distanceMeters(start, end);
    const bufferDeg = Math.max(0.055, Math.min(0.18, direct / 1000000));
    return {
        south: Math.max(48, Math.min(start[0], end[0]) - bufferDeg),
        west: Math.max(13.5, Math.min(start[1], end[1]) - bufferDeg),
        north: Math.min(55.5, Math.max(start[0], end[0]) + bufferDeg),
        east: Math.min(25.5, Math.max(start[1], end[1]) + bufferDeg),
    };
}
function buildOverpassRailQuery(start, end) {
    const bbox = railBboxForSegment(start, end);
    return `
    [out:json][timeout:18];
    (
      way["railway"~"^(rail|narrow_gauge)$"]["service"!~"^(yard|siding|spur)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    (._;>;);
    out body;
  `;
}
function buildRailGraph(payload) {
    const elements = (payload && typeof payload === 'object' && Array.isArray(payload.elements))
        ? payload.elements
        : [];
    const nodes = new Map();
    const ways = [];
    for (const element of elements) {
        if (element?.type === 'node' && Number.isFinite(element.id) && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
            nodes.set(Number(element.id), { id: Number(element.id), point: [Number(element.lat), Number(element.lon)] });
        }
        else if (element?.type === 'way' && Array.isArray(element.nodes)) {
            ways.push({ nodes: element.nodes.map((id) => Number(id)).filter((id) => Number.isFinite(id)) });
        }
    }
    const adjacency = new Map();
    const addEdge = (from, to) => {
        const a = nodes.get(from);
        const b = nodes.get(to);
        if (!a || !b)
            return;
        const weight = distanceMeters(a.point, b.point);
        if (!Number.isFinite(weight) || weight < 1)
            return;
        const list = adjacency.get(from) || [];
        list.push({ to, weight });
        adjacency.set(from, list);
    };
    for (const way of ways) {
        for (let index = 1; index < way.nodes.length; index += 1) {
            const prev = way.nodes[index - 1];
            const next = way.nodes[index];
            addEdge(prev, next);
            addEdge(next, prev);
        }
    }
    return { nodes, adjacency };
}
function nearestRailNode(graph, point) {
    let bestId = null;
    let bestDistance = Infinity;
    for (const node of graph.nodes.values()) {
        const distance = distanceMeters(point, node.point);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestId = node.id;
        }
    }
    return bestId === null ? null : { id: bestId, distance: bestDistance };
}
function shortestRailPath(graph, startId, endId) {
    const distances = new Map([[startId, 0]]);
    const previous = new Map();
    const heap = new MinHeap();
    heap.push({ id: startId, distance: 0 });
    while (heap.size > 0) {
        const current = heap.pop();
        if (!current)
            break;
        if (current.distance !== distances.get(current.id))
            continue;
        if (current.id === endId)
            break;
        const edges = graph.adjacency.get(current.id) || [];
        for (const edge of edges) {
            const nextDistance = current.distance + edge.weight;
            if (nextDistance >= (distances.get(edge.to) ?? Infinity))
                continue;
            distances.set(edge.to, nextDistance);
            previous.set(edge.to, current.id);
            heap.push({ id: edge.to, distance: nextDistance });
        }
    }
    if (!distances.has(endId))
        return [];
    const path = [];
    let cursor = endId;
    while (cursor !== undefined) {
        path.push(cursor);
        if (cursor === startId)
            break;
        cursor = previous.get(cursor);
    }
    return path.reverse();
}
async function fetchRailSegment(start, end) {
    const gap = distanceMeters(start, end);
    if (gap < MIN_SEGMENT_DISTANCE_METERS || gap > MAX_RAIL_SEGMENT_DISTANCE_METERS)
        return [];
    const payload = await postTextWithTimeout(OVERPASS_API_URL, buildOverpassRailQuery(start, end));
    const graph = buildRailGraph(payload);
    if (graph.nodes.size < 2)
        return [];
    const startNode = nearestRailNode(graph, start);
    const endNode = nearestRailNode(graph, end);
    if (!startNode || !endNode)
        return [];
    if (startNode.distance > 15000 || endNode.distance > 15000)
        return [];
    const pathIds = shortestRailPath(graph, startNode.id, endNode.id);
    const points = pathIds
        .map((id) => graph.nodes.get(id)?.point)
        .filter((point) => Boolean(point));
    if (points.length < 2)
        return [];
    const routedMeters = points.reduce((sum, point, index) => index === 0 ? 0 : sum + distanceMeters(points[index - 1], point), 0);
    if (!Number.isFinite(routedMeters) || routedMeters > Math.max(gap * 3.8, gap + 30000))
        return [];
    return points;
}
function routeableChunks(points) {
    const chunks = [];
    let current = [];
    for (const point of points) {
        const last = current[current.length - 1];
        if (last) {
            const gap = distanceMeters(last, point);
            if (gap > MAX_SEGMENT_DISTANCE_METERS) {
                if (current.length > 1)
                    chunks.push(current);
                current = [point];
                continue;
            }
        }
        current.push(point);
        if (current.length >= MAX_WAYPOINTS_PER_OSRM_REQUEST) {
            chunks.push(current);
            current = [point];
        }
    }
    if (current.length > 1)
        chunks.push(current);
    return chunks;
}
function squaredDistanceToSegmentMeters(point, start, end) {
    const meanLat = ((point[0] + start[0] + end[0]) / 3) * Math.PI / 180;
    const metersPerLat = 111320;
    const metersPerLon = Math.cos(meanLat) * 111320;
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
    const distX = px - cx;
    const distY = py - cy;
    return distX * distX + distY * distY;
}
function simplifyRdp(points, toleranceMeters) {
    if (points.length <= 2)
        return points;
    let maxDistanceSq = 0;
    let splitIndex = 0;
    const toleranceSq = toleranceMeters * toleranceMeters;
    for (let index = 1; index < points.length - 1; index += 1) {
        const distanceSq = squaredDistanceToSegmentMeters(points[index], points[0], points[points.length - 1]);
        if (distanceSq > maxDistanceSq) {
            maxDistanceSq = distanceSq;
            splitIndex = index;
        }
    }
    if (maxDistanceSq <= toleranceSq)
        return [points[0], points[points.length - 1]];
    const left = simplifyRdp(points.slice(0, splitIndex + 1), toleranceMeters);
    const right = simplifyRdp(points.slice(splitIndex), toleranceMeters);
    return left.slice(0, -1).concat(right);
}
function routeLengthMeters(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        total += distanceMeters(points[index - 1], points[index]);
    }
    return total;
}
function maxDeviationFromChordMeters(points, start, end) {
    if (points.length <= 2)
        return 0;
    let maxDistanceSq = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
        const distanceSq = squaredDistanceToSegmentMeters(points[index], start, end);
        if (distanceSq > maxDistanceSq)
            maxDistanceSq = distanceSq;
    }
    return Math.sqrt(maxDistanceSq);
}
function collapseHairpins(points, options) {
    if (points.length < 3)
        return points;
    const strict = Boolean(options?.strict);
    const closeBacktrackMeters = strict ? 70 : 45;
    const detourRatio = strict ? 3.2 : 4.5;
    const minLegMeters = strict ? 30 : 18;
    const next = [points[0]];
    for (let index = 1; index < points.length - 1; index += 1) {
        const a = next[next.length - 1];
        const b = points[index];
        const c = points[index + 1];
        const ab = distanceMeters(a, b);
        const bc = distanceMeters(b, c);
        const ac = distanceMeters(a, c);
        const via = ab + bc;
        if (ab >= minLegMeters && bc >= minLegMeters && ac <= closeBacktrackMeters && via > ac * detourRatio) {
            continue;
        }
        next.push(b);
    }
    next.push(points[points.length - 1]);
    return next;
}
function collapseLocalLoops(points, options) {
    if (points.length < 4)
        return points;
    const strict = Boolean(options?.strict);
    const joinDistanceMeters = strict ? 16 : 10;
    const maxLoopLengthMeters = strict ? 1400 : 800;
    const maxLoopChordMeters = strict ? 210 : 130;
    const result = [...points];
    let index = 0;
    while (index < result.length - 2) {
        let removed = false;
        for (let back = Math.max(0, index - 100); back < index - 1; back += 1) {
            const rejoin = distanceMeters(result[back], result[index]);
            if (rejoin > joinDistanceMeters)
                continue;
            const loop = result.slice(back, index + 1);
            const loopLength = routeLengthMeters(loop);
            const chord = distanceMeters(loop[0], loop[loop.length - 1]);
            if (loopLength <= maxLoopLengthMeters && chord <= maxLoopChordMeters) {
                result.splice(back + 1, index - back - 1);
                index = Math.max(0, back - 1);
                removed = true;
                break;
            }
        }
        if (!removed)
            index += 1;
    }
    return result;
}
async function generateRoadGeometry(points, options) {
    const merged = [];
    let skippedSegments = 0;
    let osrmSegments = 0;
    let valhallaSegments = 0;
    const isReasonableSegment = (segment, start, end) => {
        if (segment.length <= 1)
            return false;
        const direct = distanceMeters(start, end);
        if (direct < MIN_SEGMENT_DISTANCE_METERS)
            return false;
        const routed = routeLengthMeters(segment);
        const strict = Boolean(options?.strictShortSegments);
        const maxRatio = direct < 100
            ? (strict ? 2.25 : 4.2)
            : direct < 240
                ? (strict ? 2.8 : 3.8)
                : direct < 600
                    ? 3.4
                    : 3.2;
        const maxExtra = direct < 100
            ? (strict ? 130 : 260)
            : direct < 240
                ? (strict ? 220 : 420)
                : 900;
        if (routed > Math.max(direct * maxRatio, direct + maxExtra))
            return false;
        if (strict && direct <= 460) {
            const maxDeviation = maxDeviationFromChordMeters(segment, start, end);
            const allowedDeviation = Math.max(32, direct * 0.28);
            if (maxDeviation > allowedDeviation)
                return false;
        }
        if (strict && direct <= 700) {
            const maxDeviation = maxDeviationFromChordMeters(segment, start, end);
            const suspiciousDetour = routed > Math.max(direct * 2.15, direct + 180);
            const suspiciousLoop = maxDeviation > Math.max(55, direct * 0.42) && routed > direct * 1.55;
            if (suspiciousDetour || suspiciousLoop)
                return false;
        }
        return true;
    };
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const gap = distanceMeters(start, end);
        if (gap < MIN_SEGMENT_DISTANCE_METERS || gap > MAX_SEGMENT_DISTANCE_METERS) {
            skippedSegments += 1;
            continue;
        }
        const segment = await fetchOsrmRoute([start, end]).catch(() => []);
        if (isReasonableSegment(segment, start, end)) {
            appendPoints(merged, segment);
            osrmSegments += 1;
            continue;
        }
        const valhallaSegment = await fetchValhallaRoute([start, end]).catch(() => []);
        if (isReasonableSegment(valhallaSegment, start, end)) {
            appendPoints(merged, valhallaSegment);
            valhallaSegments += 1;
        }
        else {
            skippedSegments += 1;
        }
    }
    const strict = Boolean(options?.strictShortSegments);
    const hairpinCollapsed = collapseHairpins(merged, { strict });
    const loopCollapsed = collapseLocalLoops(hairpinCollapsed, { strict });
    const simplified = loopCollapsed.length > 1600 ? simplifyRdp(loopCollapsed, 7) : loopCollapsed;
    const source = valhallaSegments > 0
        ? osrmSegments > 0 ? 'mixed-osrm-valhalla' : 'valhalla'
        : 'osrm';
    return { points: simplified, skippedSegments, source };
}
async function generateRailGeometry(points) {
    const merged = [];
    let skippedSegments = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const segment = await fetchRailSegment(start, end).catch(() => []);
        if (segment.length > 1)
            appendPoints(merged, segment);
        else
            skippedSegments += 1;
    }
    const simplified = merged.length > 2200 ? simplifyRdp(merged, 6) : merged;
    return { points: simplified, skippedSegments, source: 'overpass-rail' };
}
function buildRouteResponse(request, identity, points, source, skippedSegments, cached) {
    return {
        carrier: request.carrier,
        line: request.line,
        direction: request.direction,
        variant: request.variant || 'default',
        stopsHash: identity.forwardHash,
        cacheKey: identity.canonicalKey,
        geometry: {
            type: 'LineString',
            coordinates: points.map(([lat, lon]) => [lon, lat]),
        },
        source,
        cached,
        skippedSegments,
    };
}
function isCacheableGeometry(points, stopCount, skippedSegments) {
    if (points.length < 2)
        return false;
    const lengthMeters = routeLengthMeters(points);
    if (!Number.isFinite(lengthMeters) || lengthMeters < 50)
        return false;
    const segmentCount = Math.max(0, stopCount - 1);
    if (segmentCount > 1 && skippedSegments >= segmentCount)
        return false;
    return true;
}
async function readStoredRouteGeometry(request, identity) {
    try {
        const snap = await (0, firestore_1.getFirestore)()
            .collection(FIRESTORE_ROUTE_GEOMETRY_COLLECTION)
            .doc(identity.firestoreDocId)
            .get();
        if (!snap.exists)
            return null;
        const data = snap.data();
        if (data.algorithmVersion !== ROUTE_GEOMETRY_ALGORITHM_VERSION)
            return null;
        if (data.canonicalKey !== identity.canonicalKey)
            return null;
        if (data.expiresAt && data.expiresAt.toMillis() <= Date.now())
            return null;
        if (!data.encodedPolyline || !Number.isFinite(Number(data.pointCount)) || Number(data.pointCount) < 2)
            return null;
        const decoded = decodePolyline(data.encodedPolyline);
        const points = identity.shouldReverseStoredGeometry ? [...decoded].reverse() : decoded;
        if (points.length < 2)
            return null;
        return buildRouteResponse(request, identity, points, data.source || (request.mode === 'rail' ? 'overpass-rail' : 'cached-road'), Number(data.skippedSegments || 0), true);
    }
    catch {
        return null;
    }
}
async function writeStoredRouteGeometry(request, identity, points, source, skippedSegments) {
    if (!isCacheableGeometry(points, request.stops.length, skippedSegments))
        return;
    const storedPoints = identity.shouldReverseStoredGeometry ? [...points].reverse() : points;
    try {
        await (0, firestore_1.getFirestore)()
            .collection(FIRESTORE_ROUTE_GEOMETRY_COLLECTION)
            .doc(identity.firestoreDocId)
            .set({
            cacheKey: identity.canonicalKey,
            canonicalKey: identity.canonicalKey,
            exactKey: identity.exactKey,
            carrier: request.carrier,
            line: request.line,
            mode: request.mode,
            dataVersion: request.dataVersion,
            algorithmVersion: ROUTE_GEOMETRY_ALGORITHM_VERSION,
            endpoints: identity.endpoints,
            forwardHash: identity.forwardHash,
            reverseHash: identity.reverseHash,
            canonicalHash: identity.canonicalHash,
            encodedPolyline: encodePolyline(storedPoints),
            pointCount: storedPoints.length,
            source,
            skippedSegments,
            routeLengthMeters: Math.round(routeLengthMeters(storedPoints)),
            createdAt: firestore_1.Timestamp.now(),
            expiresAt: firestore_1.Timestamp.fromMillis(Date.now() + CACHE_TTL_MS),
        });
    }
    catch {
        // Persistent cache is an optimization; route responses should still work if Firestore is unavailable.
    }
}
async function resolveRouteGeometry(input) {
    const requestInput = {
        carrier: normalizeText(input.carrier, 'unknown'),
        line: normalizeText(input.line, 'unknown'),
        direction: normalizeText(input.direction, 'unknown'),
        variant: normalizeText(input.variant, 'default'),
        dataVersion: normalizeText(input.dataVersion, 'v1'),
        stops: Array.isArray(input.stops) ? input.stops : [],
        mode: input.mode === 'rail' ? 'rail' : 'road',
    };
    const stops = cleanStops(requestInput.stops);
    const request = { ...requestInput, stops };
    const identity = cacheIdentityForRequest(request, stops);
    const cached = routeGeometryCache.get(identity.exactKey);
    if (cached && cached.expiresAt > Date.now()) {
        return { ...cached.response, cached: true };
    }
    const stored = await readStoredRouteGeometry(request, identity);
    if (stored) {
        routeGeometryCache.set(identity.exactKey, { expiresAt: Date.now() + CACHE_TTL_MS, response: stored });
        return stored;
    }
    const inflight = routeGeometryInflight.get(identity.exactKey);
    if (inflight)
        return inflight;
    const routePromise = (async () => {
        const routePoints = stops.map((stop) => [stop.lat, stop.lon]);
        const strictRoadSegments = request.carrier.toLowerCase() === 'mpk_rzeszow';
        const { points, skippedSegments, source } = routePoints.length > 1
            ? request.mode === 'rail'
                ? await generateRailGeometry(routePoints)
                : await generateRoadGeometry(routePoints, { strictShortSegments: strictRoadSegments })
            : { points: [], skippedSegments: 0, source: request.mode === 'rail' ? 'overpass-rail' : 'osrm' };
        const response = buildRouteResponse(request, identity, points, source, skippedSegments, false);
        if (isCacheableGeometry(points, stops.length, skippedSegments)) {
            routeGeometryCache.set(identity.exactKey, { expiresAt: Date.now() + CACHE_TTL_MS, response });
            if (routeGeometryCache.size > 500) {
                const firstKey = routeGeometryCache.keys().next().value;
                if (firstKey)
                    routeGeometryCache.delete(firstKey);
            }
            await writeStoredRouteGeometry(request, identity, points, source, skippedSegments);
        }
        return response;
    })()
        .finally(() => {
        routeGeometryInflight.delete(identity.exactKey);
    });
    routeGeometryInflight.set(identity.exactKey, routePromise);
    return routePromise;
}
exports.__routeGeometryTestHooks = {
    cacheIdentityForRequest,
    cleanStops,
    decodePolyline,
    encodePolyline,
};
