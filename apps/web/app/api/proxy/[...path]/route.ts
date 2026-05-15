import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Agent, fetch as undiciFetch } from 'undici';

const API_BASE = process.env.API_URL!;

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const { path: pathSegments } = await params;
    const path = pathSegments.join('/');
    const url = `${API_BASE}/${path}${req.nextUrl.search}`;

    // Get token from cookie or Authorization header
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get('platform_token')?.value;
    const headerToken = req.headers.get('authorization');
    const token = headerToken || (cookieToken ? `Bearer ${cookieToken}` : null);

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = token;

    const body = req.method !== 'GET' && req.method !== 'HEAD'
        ? await req.text()
        : undefined;

    const agent = new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1 });

    try {
        console.log('[proxy]', req.method, url);
        const res = await undiciFetch(url, {
            method: req.method,
            headers,
            body,
            dispatcher: agent,
            // @ts-ignore
            signal: AbortSignal.timeout(15000),
        });

        const data = await res.text();

        if (res.status === 204) {
            return new NextResponse(null, { status: 204 });
        }

        return new NextResponse(data, {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: unknown) {
        console.error('[proxy error]', req.method, url, err);
        const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        return NextResponse.json(
            { error: isTimeout ? 'Upstream request timed out' : 'Proxy error' },
            { status: isTimeout ? 504 : 502 }
        );
    }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;