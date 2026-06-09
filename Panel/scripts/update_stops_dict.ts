import fs from 'fs';
import path from 'path';
import { logger } from '../src/lib/logger';
import { loadStopsDictionary, reloadStopsDictionary } from '../src/lib/stops';

const TEMP_PATH = path.join(process.cwd(), 'src', 'api', 'vehicles', 'stops-dictionary.tmp.json');
const DEST_PATH = path.join(process.cwd(), 'src', 'api', 'vehicles', 'stops-dictionary.json');

function normalizeStopName(raw: string): string {
  let niceName = String(raw).trim();
  // Capitalize nicely
  niceName = niceName.toLowerCase().replace(/(^|[^a-z0-9ąćęłńóśźż])([a-ząćęłńóśźż])/g, (_: any, p1: string, p2: string) => p1 + p2.toUpperCase());
  
  // Rules
  niceName = niceName.replace(/Rzeszow/ig, 'Rzeszów');
  niceName = niceName.replace(/\bDA\b/ig, 'D.A.');
  niceName = niceName.replace(/\bD\.a\./g, 'D.A.');
  niceName = niceName.replace(/\bD\.A\b/g, 'D.A.');
  niceName = niceName.replace(/stanowisko (\d+)/ig, 'st. $1');
  niceName = niceName.replace(/\s+/g, ' ').trim();
  
  return niceName;
}

export async function runStopsUpdate() {
  logger.info('Starting stops dictionary update...');
  
  try {
    const res = await fetch('http://einfo.zgpks.rzeszow.pl/api/stop-point', {
      headers: {
        'Accept': 'application/json',
        'Host': 'einfo.zgpks.rzeszow.pl'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.items)) {
      throw new Error('Invalid JSON format for stop points (missing items array)');
    }

    const dict: Record<string, any> = {};
    
    data.items.forEach((item: any) => {
      const id = item.stop_point_id;
      const rawName = item.stop_area_name || item.name || '';
      
      if (!id) return;
      
      const normalizedName = normalizeStopName(rawName);
      let finalName = normalizedName;
      if (item.stop_point_code) {
        finalName += ` ${item.stop_point_code}`;
      }

      dict[id.toString()] = {
        id: id.toString(),
        name: finalName,
        normalizedName,
        code: item.stop_point_code || '',
        areaId: item.stop_area_id ? item.stop_area_id.toString() : '',
        updatedAt: new Date().toISOString()
      };
    });

    const entriesCount = Object.keys(dict).length;
    if (entriesCount === 0) {
      throw new Error('Dictionary is empty, aborting update to protect existing cache.');
    }

    // Atomic write
    fs.mkdirSync(path.dirname(TEMP_PATH), { recursive: true });
    fs.writeFileSync(TEMP_PATH, JSON.stringify(dict, null, 2), 'utf-8');
    fs.renameSync(TEMP_PATH, DEST_PATH);
    
    logger.info(`Successfully updated stops dictionary`, { entriesCount });
    reloadStopsDictionary();

  } catch (err: any) {
    logger.error('Update stops dictionary failed. Retaining old valid config.', err);
  }
}

// Allow to be run directly via node/tsx
import.meta.url === `file://${process.argv[1]}` && runStopsUpdate().then(() => process.exit(0)).catch(() => process.exit(1));
