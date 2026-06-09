export interface PksStopInput {
  stop_point_id?: string | number;
  id?: string | number;
  stop_point_code?: string | number;
  code?: string | number;
  stop_area_id?: string | number;
  areaId?: string | number;
  location?: {
    lat?: string | number;
    lon?: string | number;
    lng?: string | number;
    longitude?: string | number;
  } | null;
  lat?: string | number;
  lon?: string | number;
  name?: string;
  stop_area_name?: string;
}

export interface MpkStopInput {
  stop_id?: string | number;
  id?: string | number;
  stop_name?: string;
  name?: string;
  stop_lat?: string | number;
  stop_lon?: string | number;
  lat?: string | number;
  lon?: string | number;
  zone_id?: string | number;
  lines?: string | string[];
}

export interface MarcelStopInput {
  id?: string | number;
  name?: string;
  city?: string;
  nazMi?: string;
  nazPr?: string;
  lat?: string | number;
  lon?: string | number;
  szGps?: string | number;
  dlGps?: string | number;
  routeIds?: string[];
  matchName?: string;
  matchKey?: string;
  nazTr?: string;
  godz?: string;
  kol?: number;
}

export interface ConsolidatedStop {
  id: string;
  official_name: string;
  normalized_name: string;
  lat?: number;
  lon?: number;
  providers: {
    pks?: PksStopInput[];
    mpk?: MpkStopInput[];
    marcel?: MarcelStopInput[];
  };
}

export interface ConsolidateRzeszowStopsOptions {
  pksStops: PksStopInput[];
  mpkStops: MpkStopInput[];
  marcelStops: MarcelStopInput[];
  similarityThreshold?: number;
  subsetSimilarityThreshold?: number;
  geoExactMeters?: number;
  geoNearMeters?: number;
  maxDistanceMeters?: number;
}

type ProviderKey = 'pks' | 'mpk' | 'marcel';

type NormalizedCandidate<TProvider extends ProviderKey, TRaw> = {
  provider: TProvider;
  id: string;
  displayName: string;
  normalizedName: string;
  orderedName: string;
  tokenSet: Set<string>;
  numberSet: Set<string>;
  citySet: Set<string>;
  lat?: number;
  lon?: number;
  routeIds: string[];
  raw: TRaw;
};

type GroupAccumulator = {
  officialName: string;
  normalizedName: string;
  names: Set<string>;
  latitudes: number[];
  longitudes: number[];
  providers: {
    pks: PksStopInput[];
    mpk: MpkStopInput[];
    marcel: MarcelStopInput[];
  };
};

const DEFAULT_SIMILARITY_THRESHOLD = 0.78;
const DEFAULT_SUBSET_SIMILARITY_THRESHOLD = 0.58;
const DEFAULT_GEO_EXACT_METERS = 45;
const DEFAULT_GEO_NEAR_METERS = 90;
const DEFAULT_MAX_DISTANCE_METERS = 650;

const CITY_TOKENS = new Set([
  'rzeszow',
  'boguchwala',
  'babica',
  'czudec',
  'gwoznica',
  'wyzne',
  'lutoryz',
  'zarzecze',
  'polomia',
  'baryczka',
  'jasionka',
]);

const TOKEN_ALIASES: Record<string, string> = {
  da: 'dworzecautobusowy',
  dworzecautobus: 'dworzecautobusowy',
  dworzecautobusowy: 'dworzecautobusowy',
  dworzec: 'dworzec',
  lokalny: 'lokalny',
  woj: 'wojewodzki',
  wojew: 'wojewodzki',
  wojewodzki: 'wojewodzki',
  urzad: 'urzad',
  urzed: 'urzad',
  urzedu: 'urzad',
  urzadwojewodzki: 'urzad wojewodzki',
  skrz: 'skrzyzowanie',
  skrzyz: 'skrzyzowanie',
  skrzyzow: 'skrzyzowanie',
  rondo: 'rondo',
  pl: 'plac',
  plac: 'plac',
  al: 'aleja',
  aleja: 'aleja',
  ul: 'ulica',
  ulica: 'ulica',
  kosciol: 'kosciol',
  pks: '',
  mpk: '',
  marcel: '',
};

function toAscii(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseNumber(value: unknown) {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function sanitizeStopText(value: unknown) {
  return toAscii(value)
    .toLowerCase()
    .replace(/\(marcel\)/g, ' ')
    .replace(/\bn\/z\b/g, ' ')
    .replace(/\bnz\b/g, ' ')
    .replace(/\bna zadanie\b/g, ' ')
    .replace(/\bd\.?\s*a\.?\b/g, ' dworzec autobusowy ')
    .replace(/\bdw\.?\b/g, ' dworzec ')
    .replace(/\bul\.?\b/g, ' ulica ')
    .replace(/\bal\.?\b/g, ' aleja ')
    .replace(/\bpl\.?\b/g, ' plac ')
    .replace(/\bos\.?\b/g, ' osiedle ')
    .replace(/\bskrz\.?\b/g, ' skrzyzowanie ')
    .replace(/\bu\.?\s+(?=urz)/g, ' ')
    .replace(/\burz\.?\b/g, ' urzad ')
    .replace(/\bwoj\.?\b/g, ' wojewodzki ')
    .replace(/\bstan\.?\b/g, ' stanowisko ')
    .replace(/\bkosc\.?\b/g, ' kosciol ')
    .replace(/\bpodkarp\.\b/g, ' podkarpacka ')
    .replace(/\bpodkar\b/g, ' podkarpacka ')
    .replace(/\bmatuszczka\b/g, ' matuszczaka ')
    .replace(/[()]/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s*[/-]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(token: string) {
  const aliased = TOKEN_ALIASES[token] ?? token;
  return aliased.trim();
}

function extractTokens(value: unknown) {
  return sanitizeStopText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .map(normalizeToken)
    .flatMap((token) => token.split(' '))
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^\d{1,3}[a-z]?$/.test(token))
    .filter((token) => token !== 'rzeszow')
    .filter((token) => token !== 'przystanek')
    .filter((token) => token !== 'stanowisko')
    .filter((token) => token !== 'slupek');
}

function normalizeOrderedStopName(value: unknown) {
  const tokens = extractTokens(value);
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

export function normalizeStopName(value: unknown) {
  const tokens = [...new Set(extractTokens(value))].sort((left, right) => left.localeCompare(right, 'pl'));
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

function bigrams(value: string) {
  if (!value) return [];
  if (value.length === 1) return [value];
  const pairs: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    pairs.push(value.slice(index, index + 2));
  }
  return pairs;
}

function diceCoefficient(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (!leftPairs.length || !rightPairs.length) return 0;

  const leftCounts = new Map<string, number>();
  leftPairs.forEach((pair) => leftCounts.set(pair, (leftCounts.get(pair) || 0) + 1));

  let overlap = 0;
  rightPairs.forEach((pair) => {
    const current = leftCounts.get(pair) || 0;
    if (current <= 0) return;
    overlap += 1;
    leftCounts.set(pair, current - 1);
  });

  return (2 * overlap) / (leftPairs.length + rightPairs.length);
}

export function getSimilarity(left: unknown, right: unknown) {
  const leftNormalized = normalizeStopName(left);
  const rightNormalized = normalizeStopName(right);
  if (!leftNormalized || !rightNormalized) return 0;

  const leftOrdered = normalizeOrderedStopName(left);
  const rightOrdered = normalizeOrderedStopName(right);
  return Math.max(
    diceCoefficient(leftNormalized, rightNormalized),
    diceCoefficient(leftOrdered, rightOrdered),
  );
}

function extractNumberSet(value: unknown) {
  return new Set((sanitizeStopText(value).match(/\b\d{1,3}[a-z]?\b/g) || []).map((token) => token.toLowerCase()));
}

function extractCitySet(value: unknown) {
  return new Set(
    sanitizeStopText(value)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => CITY_TOKENS.has(token)),
  );
}

function numberSetsConflict(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return false;
  for (const token of left) {
    if (right.has(token)) return false;
  }
  return true;
}

function citySetsConflict(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return false;
  for (const token of left) {
    if (right.has(token)) return false;
  }
  return true;
}

function tokenCoverage(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) shared += 1;
  });
  return shared / Math.min(left.size, right.size);
}

function distanceMeters(
  leftLat?: number,
  leftLon?: number,
  rightLat?: number,
  rightLon?: number,
) {
  if (
    !Number.isFinite(leftLat) ||
    !Number.isFinite(leftLon) ||
    !Number.isFinite(rightLat) ||
    !Number.isFinite(rightLon)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians((rightLat as number) - (leftLat as number));
  const dLon = toRadians((rightLon as number) - (leftLon as number));
  const lat1 = toRadians(leftLat as number);
  const lat2 = toRadians(rightLat as number);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(haversine));
}

function groupDistanceMeters(candidate: NormalizedCandidate<ProviderKey, unknown>, group: GroupAccumulator) {
  if (!group.latitudes.length || !group.longitudes.length) return Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < Math.min(group.latitudes.length, group.longitudes.length); index += 1) {
    const distance = distanceMeters(candidate.lat, candidate.lon, group.latitudes[index], group.longitudes[index]);
    if (distance < bestDistance) bestDistance = distance;
  }
  return bestDistance;
}

function scoreGroupMatch(
  candidate: NormalizedCandidate<ProviderKey, unknown>,
  group: GroupAccumulator,
  options: Required<
    Pick<
      ConsolidateRzeszowStopsOptions,
      'similarityThreshold' | 'subsetSimilarityThreshold' | 'geoExactMeters' | 'geoNearMeters' | 'maxDistanceMeters'
    >
  >,
) {
  let bestSimilarity = 0;
  let bestCoverage = 0;

  for (const groupName of group.names) {
    const similarity = getSimilarity(candidate.displayName, groupName);
    const coverage = tokenCoverage(candidate.tokenSet, new Set(normalizeStopName(groupName).split(' ').filter(Boolean)));
    if (similarity > bestSimilarity) bestSimilarity = similarity;
    if (coverage > bestCoverage) bestCoverage = coverage;
  }

  const groupCitySets = [
    ...group.providers.pks.map((stop) => extractCitySet(pksDisplayName(stop))),
    ...group.providers.mpk.map((stop) => extractCitySet(mpkDisplayName(stop))),
    ...group.providers.marcel.map((stop) => extractCitySet(marcelDisplayName(stop))),
  ];
  const groupNumberSets = [
    ...group.providers.pks.map((stop) => extractNumberSet(pksDisplayName(stop))),
    ...group.providers.mpk.map((stop) => extractNumberSet(mpkDisplayName(stop))),
    ...group.providers.marcel.map((stop) => extractNumberSet(marcelDisplayName(stop))),
  ];

  const cityConflict = groupCitySets.every((citySet) => citySetsConflict(candidate.citySet, citySet));
  if (cityConflict) return null;

  const numbersConflict = groupNumberSets.every((numberSet) => numberSetsConflict(candidate.numberSet, numberSet));
  if (numbersConflict) return null;

  const distance = groupDistanceMeters(candidate, group);
  const hasGeo = Number.isFinite(distance);

  const exactGeoMatch = hasGeo && distance <= options.geoExactMeters;
  const nearGeoMatch = hasGeo && distance <= options.geoNearMeters;
  const subsetMatch = bestCoverage >= 1 && bestSimilarity >= options.subsetSimilarityThreshold;
  const thresholdMatch = bestSimilarity >= options.similarityThreshold;

  if (!exactGeoMatch && !nearGeoMatch && hasGeo && distance > options.maxDistanceMeters) {
    return null;
  }
  if (!thresholdMatch && !subsetMatch && !(exactGeoMatch && bestCoverage >= 0.5)) {
    return null;
  }

  const distanceScore = !hasGeo
    ? 0
    : distance <= options.geoExactMeters
      ? 1
      : distance <= options.geoNearMeters
        ? 0.8
        : distance <= options.maxDistanceMeters
          ? 0.35
          : 0;

  const score =
    bestSimilarity * 0.68 +
    bestCoverage * 0.2 +
    distanceScore * 0.12 +
    (subsetMatch ? 0.08 : 0) +
    (exactGeoMatch ? 0.06 : 0);

  return {
    score,
    similarity: bestSimilarity,
    coverage: bestCoverage,
    distance,
  };
}

function selectBestGroup(
  candidate: NormalizedCandidate<ProviderKey, unknown>,
  groups: GroupAccumulator[],
  options: Required<
    Pick<
      ConsolidateRzeszowStopsOptions,
      'similarityThreshold' | 'subsetSimilarityThreshold' | 'geoExactMeters' | 'geoNearMeters' | 'maxDistanceMeters'
    >
  >,
) {
  let bestGroup: GroupAccumulator | null = null;
  let bestScore = -1;

  groups.forEach((group) => {
    const scored = scoreGroupMatch(candidate, group, options);
    if (!scored) return;
    if (scored.score > bestScore) {
      bestScore = scored.score;
      bestGroup = group;
    }
  });

  return bestGroup;
}

function average(values: number[]) {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stableSlug(value: string) {
  return normalizeStopName(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stop';
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function pksDisplayName(stop: PksStopInput) {
  const direct = String(stop.name || '').trim();
  if (direct) return direct;

  const areaName = String(stop.stop_area_name || '').trim();
  const pointName = String(stop.name || '').trim();
  if (!areaName) return pointName;
  return areaName;
}

function mpkDisplayName(stop: MpkStopInput) {
  return String(stop.name || stop.stop_name || '').trim();
}

function marcelDisplayName(stop: MarcelStopInput) {
  const direct = String(stop.name || '').trim();
  if (direct) return direct;
  const city = String(stop.city || stop.nazMi || '').trim();
  const place = String(stop.nazPr || '').trim();
  if (!city) return place;
  if (!place) return city;
  return `${city} - ${place}`;
}

function createGroupFromCandidate(candidate: NormalizedCandidate<ProviderKey, unknown>): GroupAccumulator {
  const group: GroupAccumulator = {
    officialName: candidate.displayName,
    normalizedName: candidate.normalizedName,
    names: new Set([candidate.displayName]),
    latitudes: candidate.lat === undefined ? [] : [candidate.lat],
    longitudes: candidate.lon === undefined ? [] : [candidate.lon],
    providers: {
      pks: [],
      mpk: [],
      marcel: [],
    },
  };

  if (candidate.provider === 'pks') group.providers.pks.push(candidate.raw as PksStopInput);
  if (candidate.provider === 'mpk') group.providers.mpk.push(candidate.raw as MpkStopInput);
  if (candidate.provider === 'marcel') group.providers.marcel.push(candidate.raw as MarcelStopInput);

  return group;
}

function refreshOfficialName(group: GroupAccumulator) {
  const pksNames = uniqueStrings(group.providers.pks.map((stop) => pksDisplayName(stop)));
  const mpkNames = uniqueStrings(group.providers.mpk.map((stop) => mpkDisplayName(stop)));
  const marcelNames = uniqueStrings(group.providers.marcel.map((stop) => marcelDisplayName(stop)));
  const preferredNames = pksNames.length > 0 ? pksNames : mpkNames.length > 0 ? mpkNames : marcelNames;
  group.officialName = [...preferredNames].sort((left, right) => right.length - left.length)[0] || group.officialName;
  group.normalizedName = normalizeStopName(group.officialName);
}

function attachCandidateToGroup(group: GroupAccumulator, candidate: NormalizedCandidate<ProviderKey, unknown>) {
  group.names.add(candidate.displayName);
  if (candidate.lat !== undefined) group.latitudes.push(candidate.lat);
  if (candidate.lon !== undefined) group.longitudes.push(candidate.lon);

  if (candidate.provider === 'pks') group.providers.pks.push(candidate.raw as PksStopInput);
  if (candidate.provider === 'mpk') group.providers.mpk.push(candidate.raw as MpkStopInput);
  if (candidate.provider === 'marcel') group.providers.marcel.push(candidate.raw as MarcelStopInput);

  refreshOfficialName(group);
}

function buildGroupId(group: GroupAccumulator) {
  const pksAreaIds = uniqueStrings(group.providers.pks.map((stop) => String(stop.stop_area_id ?? stop.areaId ?? '')));
  const pksIds = uniqueStrings(group.providers.pks.map((stop) => String(stop.stop_point_id ?? stop.id ?? '')));
  const mpkIds = uniqueStrings(group.providers.mpk.map((stop) => String(stop.stop_id ?? stop.id ?? '')));
  const marcelIds = uniqueStrings(group.providers.marcel.map((stop) => String(stop.id ?? '')));
  const providerIdentity =
    (pksAreaIds[0] && `pks-area-${pksAreaIds.join('_')}`) ||
    (pksIds[0] && `pks-${pksIds.join('_')}`) ||
    (mpkIds[0] && `mpk-${mpkIds.join('_')}`) ||
    (marcelIds[0] && `marcel-${marcelIds.join('_')}`) ||
    stableSlug(group.officialName);
  return `${stableSlug(group.officialName)}-${providerIdentity}`;
}

function toPksCandidate(stop: PksStopInput): NormalizedCandidate<'pks', PksStopInput> | null {
  const displayName = pksDisplayName(stop);
  const normalizedName = normalizeStopName(displayName);
  if (!displayName || !normalizedName) return null;

  const lat = parseNumber(stop.lat ?? stop.location?.lat);
  const lon = parseNumber(stop.lon ?? stop.location?.lon ?? stop.location?.lng ?? stop.location?.longitude);
  return {
    provider: 'pks',
    id: String(stop.stop_point_id ?? stop.id ?? '').trim(),
    displayName,
    normalizedName,
    orderedName: normalizeOrderedStopName(displayName),
    tokenSet: new Set(normalizedName.split(' ').filter(Boolean)),
    numberSet: extractNumberSet(displayName),
    citySet: extractCitySet(displayName),
    lat,
    lon,
    routeIds: [],
    raw: stop,
  };
}

function toMpkCandidate(stop: MpkStopInput): NormalizedCandidate<'mpk', MpkStopInput> | null {
  const displayName = mpkDisplayName(stop);
  const normalizedName = normalizeStopName(displayName);
  if (!displayName || !normalizedName) return null;

  const lat = parseNumber(stop.lat ?? stop.stop_lat);
  const lon = parseNumber(stop.lon ?? stop.stop_lon);
  return {
    provider: 'mpk',
    id: String(stop.stop_id ?? stop.id ?? '').trim(),
    displayName,
    normalizedName,
    orderedName: normalizeOrderedStopName(displayName),
    tokenSet: new Set(normalizedName.split(' ').filter(Boolean)),
    numberSet: extractNumberSet(displayName),
    citySet: extractCitySet(displayName),
    lat,
    lon,
    routeIds: [],
    raw: stop,
  };
}

function toMarcelCandidate(stop: MarcelStopInput): NormalizedCandidate<'marcel', MarcelStopInput> | null {
  const displayName = marcelDisplayName(stop);
  const normalizedName = normalizeStopName(displayName);
  if (!displayName || !normalizedName) return null;

  const lat = parseNumber(stop.lat ?? stop.szGps);
  const lon = parseNumber(stop.lon ?? stop.dlGps);
  return {
    provider: 'marcel',
    id: String(stop.id ?? '').trim(),
    displayName,
    normalizedName,
    orderedName: normalizeOrderedStopName(displayName),
    tokenSet: new Set(normalizedName.split(' ').filter(Boolean)),
    numberSet: extractNumberSet(displayName),
    citySet: extractCitySet(displayName),
    lat,
    lon,
    routeIds: stop.routeIds || [],
    raw: stop,
  };
}

export function consolidateRzeszowStops({
  pksStops,
  mpkStops,
  marcelStops,
  similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  subsetSimilarityThreshold = DEFAULT_SUBSET_SIMILARITY_THRESHOLD,
  geoExactMeters = DEFAULT_GEO_EXACT_METERS,
  geoNearMeters = DEFAULT_GEO_NEAR_METERS,
  maxDistanceMeters = DEFAULT_MAX_DISTANCE_METERS,
}: ConsolidateRzeszowStopsOptions): ConsolidatedStop[] {
  const options = {
    similarityThreshold,
    subsetSimilarityThreshold,
    geoExactMeters,
    geoNearMeters,
    maxDistanceMeters,
  };

  const groups: GroupAccumulator[] = [];

  pksStops
    .map(toPksCandidate)
    .filter((candidate): candidate is NormalizedCandidate<'pks', PksStopInput> => Boolean(candidate))
    .forEach((candidate) => {
      const match = selectBestGroup(candidate, groups, options);
      if (match) attachCandidateToGroup(match, candidate);
      else groups.push(createGroupFromCandidate(candidate));
    });

  mpkStops
    .map(toMpkCandidate)
    .filter((candidate): candidate is NormalizedCandidate<'mpk', MpkStopInput> => Boolean(candidate))
    .forEach((candidate) => {
      const match = selectBestGroup(candidate, groups, options);
      if (match) attachCandidateToGroup(match, candidate);
      else groups.push(createGroupFromCandidate(candidate));
    });

  marcelStops
    .map(toMarcelCandidate)
    .filter((candidate): candidate is NormalizedCandidate<'marcel', MarcelStopInput> => Boolean(candidate))
    .forEach((candidate) => {
      const match = selectBestGroup(candidate, groups, options);
      if (match) attachCandidateToGroup(match, candidate);
      else groups.push(createGroupFromCandidate(candidate));
    });

  return groups
    .map((group) => ({
      id: buildGroupId(group),
      official_name: group.officialName,
      normalized_name: group.normalizedName,
      lat: average(group.latitudes),
      lon: average(group.longitudes),
      providers: {
        ...(group.providers.pks.length > 0 ? { pks: group.providers.pks } : {}),
        ...(group.providers.mpk.length > 0 ? { mpk: group.providers.mpk } : {}),
        ...(group.providers.marcel.length > 0 ? { marcel: group.providers.marcel } : {}),
      },
    }))
    .sort((left, right) => left.official_name.localeCompare(right.official_name, 'pl'));
}
