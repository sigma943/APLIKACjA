import { logger } from './logger';
import { getStopName } from './stops';
import { parseDelay, formatTime } from './time';
import http from 'http';
import WebSocket from 'ws';

export interface VehicleSchedulePoint {
  stopPointId: string;
  name: string;
  planned: string | null;
  real: string | null;
  delayMinutes: number;
  status: 'on_time' | 'delayed' | 'early' | 'unknown';
}

export interface CachedVehicle {
  id: string;
  vehicleId: string;
  line: string;
  brigade: string | null;
  direction: string;
  lat: number | null;
  lng: number | null;
  bearing: number | null;
  speed: number | null;
  delayMinutes: number;
  status: 'on_time' | 'delayed' | 'early' | 'unknown';
  lastUpdate: string;
  source: 'rest' | 'websocket';
  schedule: VehicleSchedulePoint[];
}

const globalVehicles = new Map<string, CachedVehicle>();
const STALE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export function getActiveVehicles(): CachedVehicle[] {
  const now = Date.now();
  const active: CachedVehicle[] = [];
  
  for (const [id, vehicle] of globalVehicles.entries()) {
    const updateTime = new Date(vehicle.lastUpdate).getTime();
    if (now - updateTime <= STALE_TIMEOUT_MS) {
      if (vehicle.lat !== null && vehicle.lng !== null) {
        active.push(vehicle);
      }
    } else {
      globalVehicles.delete(id); // Clean up stale
    }
  }
  return active;
}

function parseVehicleFromITS(item: any, source: 'rest' | 'websocket'): CachedVehicle | null {
  if (!item || !item.vehicle_id || !item.location) return null;
  
  const idStr = String(item.vehicle_id);
  const now = new Date().toISOString();
  
  let delayMinutes = 0;
  if (item.deviation) {
    delayMinutes = parseDelay(item.deviation);
  }
  
  let status: 'on_time' | 'delayed' | 'early' | 'unknown' = 'unknown';
  if (typeof item.deviation !== 'undefined') {
    if (delayMinutes > 0) status = 'delayed';
    else if (delayMinutes < 0) status = 'early';
    else status = 'on_time';
  }

  const schedule: VehicleSchedulePoint[] = [];
  if (item.next_stop_points && Array.isArray(item.next_stop_points)) {
    for (const sp of item.next_stop_points) {
      if (!sp.stop_point_id) continue;
      const spId = String(sp.stop_point_id);
      
      let spDelay = 0;
      if (sp.deviation) spDelay = parseDelay(sp.deviation);
      
      let spStatus: 'on_time' | 'delayed' | 'early' | 'unknown' = 'on_time';
      if (spDelay > 0) spStatus = 'delayed';
      else if (spDelay < 0) spStatus = 'early';
      
      const planned = formatTime(sp.timetable_time);
      let real = planned;
      if (planned && spDelay > 0) {
        const [ph, pm] = planned.split(':').map(Number);
        const totalMins = ph * 60 + pm + spDelay;
        const rh = Math.floor(totalMins / 60) % 24;
        const rm = totalMins % 60;
        real = `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
      }

      schedule.push({
        stopPointId: spId,
        name: getStopName(spId),
        planned,
        real,
        delayMinutes: spDelay,
        status: spStatus
      });
    }
  }

  return {
    id: idStr,
    vehicleId: idStr,
    line: String(item.line_name || '?'),
    brigade: item.brigade || null,
    direction: item.route_description || 'Nieznany',
    lat: typeof item.location?.lat === 'number' ? item.location.lat : null,
    lng: typeof item.location?.lon === 'number' ? item.location.lon : null,
    bearing: typeof item.location?.bearing === 'number' ? item.location.bearing : null,
    speed: typeof item.location?.speed === 'number' ? item.location.speed : null,
    delayMinutes,
    status,
    lastUpdate: now,
    source,
    schedule
  };
}

export async function updateVehiclesFromREST() {
  try {
    const response = await fetch('http://185.214.67.112/api/its/vehicles', {
      headers: {
        'Host': 'einfo.zgpks.rzeszow.pl',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        // Quietly exit as this endpoint is not available and WS is the primary data source
        return;
      }
      throw new Error(`REST API returned ${response.status}`);
    }

    const data = await response.json();
    let updatedCount = 0;
    
    if (data && Array.isArray(data.items)) {
      data.items.forEach((item: any) => {
        const v = parseVehicleFromITS(item, 'rest');
        if (v) {
          // If we already have a recent websocket update, we only overwrite if the websocket update is > 15 seconds old
          const existing = globalVehicles.get(v.id);
          const now = Date.now();
          if (existing && existing.source === 'websocket' && now - new Date(existing.lastUpdate).getTime() < 15000) {
            return; // skip, WS is more fresh
          }
          globalVehicles.set(v.id, v);
          updatedCount++;
        }
      });
    }
    
    logger.info(`Vehicles REST snapshot updated`, { count: updatedCount });
  } catch (err: any) {
    logger.error('Failed to sync vehicles from REST', err);
  }
}

let wsRetries = 0;
let ws: WebSocket | null = null;
const MAX_WS_DELAY = 30000;

export function connectVehiclesWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return; // Already connecting or connected
  }

  try {
    logger.info('Connecting to ITS WebSocket...');
    ws = new WebSocket('ws://185.214.67.112:3000/rist');

    ws.on('open', () => {
      logger.info('ITS WebSocket connected successfully');
      wsRetries = 0;
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg && msg.items && Array.isArray(msg.items)) {
          let updatedCount = 0;
          msg.items.forEach((item: any) => {
             const v = parseVehicleFromITS(item, 'websocket');
             if (v) {
               globalVehicles.set(v.id, v);
               updatedCount++;
             }
          });
          if (updatedCount > 0) {
            // we can log if we want, but it might be too noisy
            // logger.info(`WS Update received`, { updated: updatedCount });
          }
        }
      } catch (err) {
         // silently ignore parse errors so we don't spam
      }
    });

    ws.on('close', () => {
      logger.info('ITS WebSocket disconnected');
      scheduleWsReconnect();
    });

    ws.on('error', (err) => {
      logger.error('ITS WebSocket error', err);
      // Close will be emitted after error typically
    });
  } catch (err) {
    logger.error('Failed to initiate WS connection', err);
    scheduleWsReconnect();
  }
}

function scheduleWsReconnect() {
  wsRetries++;
  let delay = 2000; // 1st try 2s
  if (wsRetries === 2) delay = 5000;
  else if (wsRetries === 3) delay = 10000;
  else if (wsRetries > 3) delay = MAX_WS_DELAY;

  logger.info(`ITS WebSocket will attempt reconnect in ${delay}ms (Attempt ${wsRetries})`);
  setTimeout(() => {
    connectVehiclesWebSocket();
  }, delay);
}

let restInterval: NodeJS.Timeout | null = null;
export function startVehicleSync() {
  // 1. Initial REST fetch
  updateVehiclesFromREST();
  
  // 2. Start REST polling (every 10s) as fallback
  if (!restInterval) {
    restInterval = setInterval(updateVehiclesFromREST, 10000);
  }

  // 3. Connect WebSocket
  connectVehiclesWebSocket();
}
