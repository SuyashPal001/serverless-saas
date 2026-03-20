import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { refreshSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const refreshToken = request.cookies.get('platform_refresh_token')?.value;

        if (!refreshToken) {
            return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
        }

        // Optional tenantId — when present, passes clientMetadata to Cognito so the
        // pre-token lambda stamps the requested workspace into the new JWT (workspace switching)
        const body = await request.json().catch(() => ({}));
        const tenantId: string | undefined = body.tenantId;

        const { idToken } = await refreshSession(
            refreshToken,
            tenantId ? { tenantId } : undefined,
        );

        const response = NextResponse.json({ success: true });

        response.cookies.set({
            name: 'platform_token',
            value: idToken,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 3600,
        });

        return response;
    } catch (error) {
        console.error('Token refresh failed', error);
        return NextResponse.json({ error: 'Failed to refresh token' }, { status: 401 });
    }
}
