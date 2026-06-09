import { NextRequest, NextResponse } from 'next/server';

const IS_EXPORT_BUILD = process.env.NEXT_OUTPUT_MODE === 'export';
export const runtime = 'nodejs';
export const revalidate = 3600;

const API_BASE_URL = (process.env.PKP_INTERCITY_API_BASE_URL || 'https://pdp-api.plk-sa.pl').replace(/\/$/, '');
const API_KEY = String(process.env.PKP_INTERCITY_API_KEY || process.env.NEXT_PUBLIC_PKP_INTERCITY_API_KEY || '').trim();

const ALLOWED_ENDPOINTS = new Set<string>([
  '/api/v1/operations',
  '/api/v1/operations/train',
  '/api/v1/schedules/route',
]);

function normalizeEndpoint(raw: string) {
  const value = String(raw || '').trim();
  if (!value.startsWith('/')) return '';
  return value.replace(/\/+$/, '');
}

function isEndpointAllowed(endpoint: string) {
  if (ALLOWED_ENDPOINTS.has(endpoint)) return true;
  return endpoint.startsWith('/api/v1/operations/train/') || endpoint.startsWith('/api/v1/schedules/route/');
}

export async function GET(request: NextRequest) {
  if (IS_EXPORT_BUILD) {
    return NextResponse.json(
      { items: [], info: 'pkp-intercity operations disabled in static export build' },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  }

  if (!API_KEY) {
    return NextResponse.json(
      { error: 'PKP_INTERCITY_API_KEY is not configured on server' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const endpoint = normalizeEndpoint(request.nextUrl.searchParams.get('endpoint') || '/api/v1/operations');
  if (!endpoint || !isEndpointAllowed(endpoint)) {
    return NextResponse.json(
      { error: 'Unsupported PKP Intercity endpoint' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const upstreamUrl = new URL(`${API_BASE_URL}${endpoint}`);
    for (const [key, value] of request.nextUrl.searchParams.entries()) {
      if (key === 'endpoint') continue;
      upstreamUrl.searchParams.set(key, value);
    }

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': API_KEY,
      },
      cache: 'no-store',
      next: { revalidate: 0 },
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `PKP Intercity proxy failure: ${message}` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
