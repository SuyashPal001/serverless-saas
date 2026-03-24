import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';


const API_BASE = process.env.NEXT_PUBLIC_API_URL!;

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

    try {
        const res = await fetch(url, {
            method: req.method,
            headers,
            body,
            signal: AbortSignal.timeout(15000),
        });

        const data = await res.text();

        return new NextResponse(data, {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: unknown) {
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