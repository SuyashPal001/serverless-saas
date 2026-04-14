'use client';

import { useEffect, useRef } from 'react';

const REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes

export function useAuthRefresh() {
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const refresh = async () => {
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

        // Set up the interval
        intervalRef.current = setInterval(refresh, REFRESH_INTERVAL);

        // Run once on mount — prevents stale token if tab was open before login
        refresh();

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, []);
}
