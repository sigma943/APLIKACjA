import type { Stop } from '@/Panel/src/types';

function normalizeAscii(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isRzeszowCityPoint(lat?: number, lon?: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad((lat as number) - 50.0413);
  const dLon = toRad((lon as number) - 21.999);
  const lat1 = toRad(50.0413);
  const lat2 = toRad(lat as number);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distance = 2 * 6371000 * Math.asin(Math.sqrt(h));
  return Number.isFinite(distance) && distance <= 7500;
}

function shouldKeepStopNumber(stop?: Pick<Stop, 'name' | 'lat' | 'lon' | 'sourceProviderIds'> | null) {
  const name = normalizeAscii(stop?.name);
  if (/^rzeszow\b/.test(name)) return true;
  return Boolean(stop?.sourceProviderIds?.includes('mpk_rzeszow') && isRzeszowCityPoint(stop.lat, stop.lon));
}

export function formatPublicStopName(stop: Pick<Stop, 'name' | 'lat' | 'lon' | 'sourceProviderIds'>) {
  const raw = String(stop.name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return raw;
  const providers = stop.sourceProviderIds || [];
  if (providers.includes('marcel') && !providers.includes('pks') && !providers.includes('mpk_rzeszow')) {
    return raw;
  }
  const normalizedRaw = normalizeAscii(raw);
  if (/\bd\.a\.?/.test(normalizedRaw) || /\bdworzec autobusowy\b/.test(normalizedRaw)) {
    return raw
      .replace(/\s+(?:st\.?\s*)?0*\d+[a-z]?\s*$/i, '')
      .replace(/(D\.A\.)\.+$/i, '$1')
      .replace(/^Rzeszow\b/i, 'Rzeszów')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (shouldKeepStopNumber(stop)) return raw;

  const formatted = raw
    .replace(/\s+\d{1,3}[a-z]?(?=\s+n[?z](?:\s|$))/i, '')
    .replace(/\b(st|skr)\.?\s+\d{1,3}[a-z]?\b$/i, '$1')
    .replace(/\s+\d{1,3}[a-z]?\b$/i, '')
    .replace(/\s+[-??]\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return formatted || raw.replace(/\s+[-??]\s*$/i, '').trim();
}
