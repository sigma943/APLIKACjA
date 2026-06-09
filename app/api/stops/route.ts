import { NextResponse } from 'next/server';
import {
  consolidateRzeszowStops,
  type MarcelStopInput,
  type MpkStopInput,
  type PksStopInput,
} from '@/lib/rzeszow-stop-consolidation';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

const PKS_STOPS_URL = 'http://einfo.zgpks.rzeszow.pl/api/stop-point';
const MPK_STOPS_URL = 'https://www.mpkrzeszow.pl/przystanki/stopscache';
const MARCEL_ROUTES_URL = 'https://api-site.marcel-bus.pl/client/api/search/trasy?appVersion=v1.67';

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
    next: { revalidate },
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 240);
    throw new Error(`${url} -> ${response.status}${details ? `: ${details}` : ''}`);
  }

  return response.json() as Promise<T>;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

async function fetchPksStops() {
  const payload = await requestJson<{ items?: PksStopInput[] }>(PKS_STOPS_URL);
  return Array.isArray(payload.items) ? payload.items : [];
}

async function fetchMpkStops() {
  const payload = await requestJson<MpkStopInput[]>(MPK_STOPS_URL);
  return Array.isArray(payload) ? payload : [];
}

type MarcelRoute = {
  idTr: number;
  nazMiOd?: string;
  nazMiDo?: string;
};

type MarcelCourse = {
  idKu: number;
  idTr?: number;
};

type MarcelCourseStop = {
  kol?: number;
  szGps?: number;
  dlGps?: number;
  nazTr?: string;
  nazMi?: string;
  nazPr?: string;
  godz?: string;
};

async function fetchMarcelStops() {
  const dateIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const routes = await requestJson<MarcelRoute[]>(MARCEL_ROUTES_URL);
  const rzeszowRoutes = routes.filter((route) =>
    /rzesz/i.test(`${route.nazMiOd || ''} ${route.nazMiDo || ''}`),
  );

  const coursesByRoute = await mapWithConcurrency(rzeszowRoutes, 6, async (route) => {
    const url =
      `https://api-site.marcel-bus.pl/client/api/search/wariantTrasy/kusy?data=${encodeURIComponent(dateIso)}` +
      `&idTr=${encodeURIComponent(String(route.idTr))}&appVersion=v1.67`;
    const courses = await requestJson<MarcelCourse[]>(url).catch(() => []);
    return courses.map((course) => ({
      routeId: String(route.idTr),
      courseId: String(course.idKu),
    }));
  });

  const uniqueCourseRefs = [
    ...new Map(
      coursesByRoute
        .flat()
        .map((courseRef) => [courseRef.courseId, courseRef] as const),
    ).values(),
  ];

  const indexedStops = new Map<string, MarcelStopInput>();

  await mapWithConcurrency(uniqueCourseRefs, 10, async ({ routeId, courseId }) => {
    const url = `https://api-site.marcel-bus.pl/client/api/trasy/kurs/${encodeURIComponent(courseId)}?appVersion=v1.67`;
    const stops = await requestJson<MarcelCourseStop[]>(url).catch(() => []);

    stops.forEach((stop, index) => {
      const city = String(stop.nazMi || '').trim();
      const name = String(stop.nazPr || '').trim();
      if (!city || !name) return;

      const key = `${city.toLowerCase()}|${name.toLowerCase()}`;
      const current = indexedStops.get(key);
      const nextRouteIds = new Set([...(current?.routeIds || []), routeId]);

      indexedStops.set(key, {
        id: current?.id || `marcel:${key.replace(/[^a-z0-9|]+/gi, '_')}`,
        name: current?.name || `${city} - ${name}`,
        city,
        nazMi: city,
        nazPr: name,
        lat: current?.lat ?? stop.szGps,
        lon: current?.lon ?? stop.dlGps,
        routeIds: [...nextRouteIds],
        nazTr: stop.nazTr,
        godz: stop.godz,
        kol: stop.kol ?? index + 1,
      });
    });
  });

  return [...indexedStops.values()];
}

export async function GET() {
  try {
    const [pksStops, mpkStops, marcelStops] = await Promise.all([
      fetchPksStops(),
      fetchMpkStops(),
      fetchMarcelStops(),
    ]);

    const consolidated = consolidateRzeszowStops({
      pksStops,
      mpkStops,
      marcelStops,
      similarityThreshold: 0.78,
    });

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        counts: {
          pks: pksStops.length,
          mpk: mpkStops.length,
          marcel: marcelStops.length,
          consolidated: consolidated.length,
        },
        items: consolidated,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        items: [],
        error: error instanceof Error ? error.message : 'Stop consolidation failed',
      },
      { status: 500 },
    );
  }
}
