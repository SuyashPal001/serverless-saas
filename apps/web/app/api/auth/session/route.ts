import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { token } = body;

        if (!token) {
            return NextResponse.json({ error: 'Token is required' }, { status: 400 });
        }

        const response = NextResponse.json({ success: true });

        // Set the token as an httpOnly cookie
        response.cookies.set({
            name: 'platform_token',
            value: token,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 3600, // 1 hour
        });

        return response;
    } catch (error) {
        console.error('Session creation failed', error);
        return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }
}

export async function DELETE() {
    const response = NextResponse.json({ success: true });

    // Clear the cookie by setting maxAge to 0
    response.cookies.set({
        name: 'platform_token',
        value: '',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });

    return response;
}
