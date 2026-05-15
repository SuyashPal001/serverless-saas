'use client';

import { useEffect, useRef } from 'react';

const REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes
// Refresh eagerly if fewer than this many ms remain on the token.
// 5 minutes gives one safe window before Cognito rejects the token (1-hour expiry).
const EXPIRY_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Reads platform_id_token from document.cookie (not httpOnly — set by both
 * /api/auth/session and /api/auth/refresh) and returns its exp in milliseconds.
 * Returns null if the cookie is absent or the JWT is malformed.
 */
function getIdTokenExpiryMs(): number | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie
        .split(';')
        .map(c => c.trim())
        .find(c => c.startsWith('platform_id_token='));
    if (!match) return null;

    const token = match.slice('platform_id_token='.length);
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

export function useAuthRefresh() {
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const refresh = async () => {
            // No-op when there is no active session (auth/public pages, unauthenticated
            // visitors). platform_id_token is the non-httpOnly copy — its absence means
            // no session cookie has been set, so there is no platform_refresh_token to
            // use either. Attempting the refresh would always return 401 {"error":"No
            // refresh token"} and generate false-positive noise in the console.
            if (getIdTokenExpiryMs() === null) return;

            try {
                const res = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });

                if (res.ok) {
                    console.log('[useAuthRefresh] Token refreshed successfully');
                } else {
                    console.error('[useAuthRefresh] Token refresh failed:', await res.text());
                }
            } catch (err) {
                console.error('[useAuthRefresh] Background refresh error:', err);
            }
        };

        // On mount: only eager-refresh if a session exists AND is near expiry.
        // When expiry is null the user has no session (login/signup pages) — skip
        // silently. A fresh login token has ~55 min remaining and also skips,
        // avoiding a race with concurrent API calls on the new cookie.
        const expiry = getIdTokenExpiryMs();
        if (expiry !== null && expiry - Date.now() < EXPIRY_THRESHOLD_MS) {
            refresh();
        }

        // Proactive interval — fires every 45 min regardless of expiry state
        intervalRef.current = setInterval(refresh, REFRESH_INTERVAL);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, []);
}
