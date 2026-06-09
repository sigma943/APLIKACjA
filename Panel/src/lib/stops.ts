import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export interface StopDictRecord {
  id: string;
  name: string;
  normalizedName: string;
  code: string;
  areaId: string;
  updatedAt: string;
}

const STOPS_DICT_PATH = path.join(process.cwd(), 'src', 'api', 'vehicles', 'stops-dictionary.json');

let stopsDictionaryCache: Record<string, StopDictRecord> | null = null;

export function loadStopsDictionary(): Record<string, StopDictRecord> {
  if (stopsDictionaryCache) {
    return stopsDictionaryCache;
  }
  
  try {
    if (fs.existsSync(STOPS_DICT_PATH)) {
      const data = fs.readFileSync(STOPS_DICT_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      stopsDictionaryCache = parsed;
      logger.info('Stops dictionary loaded from local cache', { count: Object.keys(parsed).length });
      return parsed;
    }
  } catch (err) {
    logger.error('Failed to load stops dictionary JSON', err);
  }
  
  // Return empty dict, fallback will be used
  return {};
}

export function getStopName(stopId: string): string {
  const dict = loadStopsDictionary();
  const entry = dict[stopId];
  if (entry && entry.name) {
    return entry.name;
  }
  return `Przystanek ${stopId}`;
}

export function reloadStopsDictionary() {
  stopsDictionaryCache = null;
  loadStopsDictionary();
}
