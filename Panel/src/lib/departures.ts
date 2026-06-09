import { logger } from '../lib/logger';
import { getStopName } from '../lib/stops';
import { parseDelay, formatTime } from '../lib/time';

const CACHE_TTL_MS = 20 * 1000; // 20s cache

export interface AppDeparture {
  line: string;
  direction: string;
  destination: string;
  plannedDeparture: string | null;
  realDeparture: string | null;
  delayMinutes: number;
  status: 'on_time' | 'delayed' | 'early' | 'unknown';
  vehicleId: string | null;
}

interface DeparturesResponse {
  success: boolean;
  stopId: string;
  stopName: string;
  updatedAt: string;
  journeys: AppDeparture[];
  error?: string;
}

// Memory Cache
const departuresCache = new Map<string, { data: AppDeparture[], timestamp: number }>();

export async function getLiveDepartures(stopId: string): Promise<DeparturesResponse> {
  const stopName = getStopName(stopId);
  const now = Date.now();
  
  const cached = departuresCache.get(stopId);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return {
      success: true,
      stopId,
      stopName,
      updatedAt: new Date(cached.timestamp).toISOString(),
      journeys: cached.data
    };
  }

  try {
    const response = await fetch(`http://185.214.67.112/api/its/infoboard/nearest-departures/${stopId}`, {
      headers: {
        'Host': 'einfo.zgpks.rzeszow.pl',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const json = await response.json();
    const journeys: AppDeparture[] = [];

    if (json.journeys && Array.isArray(json.journeys)) {
      for (const j of json.journeys) {
        const plannedTime = formatTime(j.timetable_time) || null;
        let delayMinutes = 0;
        if (j.deviation) {
          delayMinutes = parseDelay(j.deviation);
        }
        
        let status: 'on_time' | 'delayed' | 'early' | 'unknown' = 'unknown';
        let realDeparture = plannedTime;
        
        if (plannedTime) {
          status = 'on_time';
          if (delayMinutes > 0) {
            status = 'delayed';
            // Compute real departure strictly based on planned + delay
            const [ph, pm] = plannedTime.split(':').map(Number);
            const totalMins = ph * 60 + pm + delayMinutes;
            const rh = Math.floor(totalMins / 60) % 24;
            const rm = totalMins % 60;
            realDeparture = `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
          } else if (delayMinutes < 0) {
            status = 'early';
          }
        }
        
        journeys.push({
          line: j.line_name || '?',
          direction: j.route_description || 'Nieznany',
          destination: j.route_description || 'Nieznany',
          plannedDeparture: plannedTime,
          realDeparture,
          delayMinutes,
          status,
          vehicleId: j.vehicle_id || null
        });
      }
    }

    departuresCache.set(stopId, { data: journeys, timestamp: now });
    logger.info(`Fetched real departures for stop ${stopId}`, { count: journeys.length });

    return {
      success: true,
      stopId,
      stopName,
      updatedAt: new Date().toISOString(),
      journeys
    };

  } catch (err: any) {
    logger.error(`Error fetching departures for stop ${stopId}`, err);
    return {
      success: false,
      stopId,
      stopName,
      updatedAt: new Date().toISOString(),
      journeys: cached ? cached.data : [],
      error: 'Nie udało się pobrać odjazdów'
    };
  }
}
