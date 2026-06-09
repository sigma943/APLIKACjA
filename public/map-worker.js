self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === 'route:validate') {
      self.postMessage({ id, ok: true, result: validateRoute(payload.points || [], payload.stops || []) });
      return;
    }
    if (type === 'markers:cluster') {
      self.postMessage({ id, ok: true, result: clusterMarkers(payload || {}) });
      return;
    }
    self.postMessage({ id, ok: false, error: `Unknown worker task: ${type}` });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};

function routeDistanceMeters(a, b) {
  const meanLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
  const metersPerLat = 111320;
  const metersPerLon = Math.cos(meanLat) * 111320;
  const dx = (a[1] - b[1]) * metersPerLon;
  const dy = (a[0] - b[0]) * metersPerLat;
  return Math.hypot(dx, dy);
}

function routeLengthMeters(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += routeDistanceMeters(points[index - 1], points[index]);
  }
  return total;
}

function distanceToRouteMeters(point, route) {
  if (!route.length) return Number.POSITIVE_INFINITY;
  if (route.length === 1) return routeDistanceMeters(point, route[0]);
  let best = Number.POSITIVE_INFINITY;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
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
    best = Math.min(best, Math.hypot(px - cx, py - cy));
  }

  return best;
}

function validateRoute(points, stops) {
  const route = points
    .filter((point) => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  const cleanStops = stops
    .map((stop, index) => ({
      id: stop?.id,
      sequence: Number.isFinite(Number(stop?.sequence)) ? Number(stop.sequence) : index,
      lat: Number(stop?.lat),
      lon: Number(stop?.lon),
    }))
    .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon))
    .sort((a, b) => a.sequence - b.sequence);

  if (route.length < 2 || cleanStops.length < 2) return { complete: false, missedStops: [], checkedStops: cleanStops.length };

  const start = [cleanStops[0].lat, cleanStops[0].lon];
  const end = [cleanStops[cleanStops.length - 1].lat, cleanStops[cleanStops.length - 1].lon];
  const firstPoint = route[0];
  const lastPoint = route[route.length - 1];
  const startDistance = Math.min(routeDistanceMeters(firstPoint, start), routeDistanceMeters(lastPoint, start));
  const endDistance = Math.min(routeDistanceMeters(firstPoint, end), routeDistanceMeters(lastPoint, end));
  const directDistance = routeDistanceMeters(start, end);
  const routeDistance = routeLengthMeters(route);
  const endpointTolerance = Math.max(450, Math.min(1400, directDistance * 0.08));
  const missedStops = [];

  for (let index = 1; index < cleanStops.length - 1; index += 1) {
    const stop = cleanStops[index];
    const distance = distanceToRouteMeters([stop.lat, stop.lon], route);
    const tolerance = cleanStops.length > 45 ? 320 : 240;
    if (distance > tolerance) {
      missedStops.push({ id: stop.id, sequence: stop.sequence, distance });
      if (missedStops.length > 8) break;
    }
  }

  return {
    complete: startDistance <= endpointTolerance &&
      endDistance <= endpointTolerance &&
      routeDistance >= directDistance * 0.72 &&
      missedStops.length === 0,
    startDistance,
    endDistance,
    routeDistance,
    directDistance,
    missedStops,
    checkedStops: cleanStops.length,
  };
}

function project(lat, lon, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  const sin = Math.sin(lat * Math.PI / 180);
  return {
    x: (lon + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function inBounds(vehicle, bounds) {
  if (!bounds) return true;
  return vehicle.lat >= bounds.south && vehicle.lat <= bounds.north && vehicle.lon >= bounds.west && vehicle.lon <= bounds.east;
}

function clusterMarkers(payload) {
  const vehicles = (payload.vehicles || [])
    .filter((vehicle) => Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon));
  const zoom = Number(payload.zoom || 13);
  const bounds = payload.bounds || null;
  const paddedVehicles = vehicles.length > 80 ? vehicles.filter((vehicle) => inBounds(vehicle, bounds)) : vehicles;
  const highVolume = vehicles.length > 35;
  const shouldCluster = paddedVehicles.length > 8 && (
    zoom <= 14 ||
    (highVolume && zoom <= 16) ||
    paddedVehicles.length > 60
  );

  if (!shouldCluster) {
    return {
      groups: paddedVehicles.map((vehicle) => ({
        vehicleKeys: [vehicle.key],
        lat: vehicle.lat,
        lon: vehicle.lon,
        provider: vehicle.provider || 'pks',
        visualOffset: 0,
        groupKey: vehicle.key,
      })),
    };
  }

  const gridSize = zoom <= 10 ? 104 : zoom <= 12 ? 86 : zoom <= 14 ? 66 : 54;
  const providerCells = new Map();
  const grouped = new Map();

  for (const vehicle of paddedVehicles) {
    const point = project(vehicle.lat, vehicle.lon, zoom);
    const provider = vehicle.provider || 'pks';
    const cellX = Math.floor(point.x / gridSize);
    const cellY = Math.floor(point.y / gridSize);
    const overlapKey = `${cellX}:${cellY}`;
    const key = `${provider}:${overlapKey}`;
    const providersInCell = providerCells.get(overlapKey) || new Set();
    providersInCell.add(provider);
    providerCells.set(overlapKey, providersInCell);

    const group = grouped.get(key);
    if (group) {
      group.vehicleKeys.push(vehicle.key);
      group.lat += vehicle.lat;
      group.lon += vehicle.lon;
    } else {
      grouped.set(key, { vehicleKeys: [vehicle.key], lat: vehicle.lat, lon: vehicle.lon, provider, overlapKey });
    }
  }

  return {
    groups: Array.from(grouped.values()).map((group) => {
      const providersCount = providerCells.get(group.overlapKey)?.size || 0;
      return {
        ...group,
        lat: group.lat / group.vehicleKeys.length,
        lon: group.lon / group.vehicleKeys.length,
        groupKey: `${group.provider}:${group.overlapKey}`,
        visualOffset: providersCount > 1
          ? group.provider === 'mpk_rzeszow' ? 7 : group.provider === 'marcel' ? 0 : group.provider === 'pkp_intercity' ? 14 : -7
          : 0,
      };
    }),
  };
}
