import { NextResponse } from 'next/server';

const PKS_PANEL_VEHICLES_URL = 'http://185.214.67.112/api/its/vehicles';
const VEHICLE_SNAPSHOT_TTL_MS = 45_000;
let lastOkPayload = '';
let lastOkAt = 0;

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await fetch(PKS_PANEL_VEHICLES_URL, {
      headers: {
        Host: 'einfo.zgpks.rzeszow.pl',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });

    const text = await response.text();
    if (!response.ok) {
      if (lastOkPayload && Date.now() - lastOkAt <= VEHICLE_SNAPSHOT_TTL_MS) {
        return new NextResponse(lastOkPayload, {
          status: 200,
          headers: {
            'Content-Type': response.headers.get('content-type') || 'application/json',
            'Cache-Control': 'no-store',
            'X-PKS-Fallback': 'stale-snapshot',
          },
        });
      }
      return NextResponse.json(
        { items: [], error: `PKS vehicles feed returned ${response.status}`, details: text.slice(0, 240) },
        { status: 502 },
      );
    }

    lastOkPayload = text;
    lastOkAt = Date.now();

    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (lastOkPayload && Date.now() - lastOkAt <= VEHICLE_SNAPSHOT_TTL_MS) {
      return new NextResponse(lastOkPayload, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-PKS-Fallback': 'stale-snapshot',
        },
      });
    }
    return NextResponse.json(
      { items: [], error: error instanceof Error ? error.message : 'PKS vehicles feed unavailable' },
      { status: 502 },
    );
  }
}
