import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { token, refreshToken, accessToken } = body;

        if (!token) {
            return NextResponse.json({ error: 'Token is required' }, { status: 400 });
        }

        const response = NextResponse.json({ success: true });

        // ID Token - httpOnly
        response.cookies.set({
            name: 'platform_token',
            value: token,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 3600,
        });

        // ID Token - NOT httpOnly (for WebSocket relay idToken param)
        response.cookies.set({
            name: 'platform_id_token',
            value: token,
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/',
            maxAge: 3600,
        });

        // Access Token - NOT httpOnly (for WebSocket)
        if (accessToken) {
            response.cookies.set({
                name: 'platform_access_token',
                value: accessToken,
                httpOnly: false,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                path: '/',
                maxAge: 3600, // 1 hour (Cognito default)
            });
        }

        if (refreshToken) {
            response.cookies.set({
                name: 'platform_refresh_token',
                value: refreshToken,
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 60 * 24 * 30, // 30 days
            });
        }

        return response;
    } catch (error) {
        console.error('Session creation failed', error);
        return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }
}

export async function DELETE() {
    const response = NextResponse.json({ success: true });

    response.cookies.set({
        name: 'platform_token',
        value: '',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });

    response.cookies.set({
        name: 'platform_access_token',
        value: '',
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
    });

    response.cookies.set({
        name: 'platform_id_token',
        value: '',
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
    });

    response.cookies.set({
        name: 'platform_refresh_token',
        value: '',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });

    return response;
}
