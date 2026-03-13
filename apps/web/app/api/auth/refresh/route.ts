import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { refreshSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const refreshToken = request.cookies.get('platform_refresh_token')?.value;

        if (!refreshToken) {
            return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
        }

        const { idToken } = await refreshSession(refreshToken);

        return NextResponse.json({ idToken });
    } catch (error) {
        console.error('Token refresh failed', error);
        return NextResponse.json({ error: 'Failed to refresh token' }, { status: 401 });
    }
}
