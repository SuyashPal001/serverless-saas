"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NotificationsContext } from "@/lib/notifications-context";
import { useTenant } from "@/app/[tenant]/tenant-provider";

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
    const { tenantId } = useTenant();
    const queryClient = useQueryClient();
    const [unreadCount, setUnreadCount] = React.useState(0);
    const wsRef = React.useRef<WebSocket | null>(null);
    const retryCountRef = React.useRef(0);
    const maxRetries = 3;

    React.useEffect(() => {
        const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
        if (!wsUrl || !tenantId) return;

        let reconnectTimeout: NodeJS.Timeout;

        const connect = () => {
            try {
                // Ensure proper WebSocket URL construction if needed, 
                // assuming wsUrl is a full wss:// or ws:// connection string.
                const url = new URL(wsUrl);
                url.searchParams.append("tenantId", tenantId);

                const ws = new WebSocket(url.toString());
                wsRef.current = ws;

                ws.onopen = () => {
                    retryCountRef.current = 0; // Reset retries on successful connection
                };

                ws.onmessage = (event) => {
                    try {
                        const newNotification = JSON.parse(event.data);

                        // Increment unread count
                        setUnreadCount((prev) => prev + 1);

                        // Inject directly into TanStack Query Cache
                        queryClient.setQueryData(["notifications", tenantId], (oldData: any) => {
                            // Assuming oldData is { notifications: [...] } based on standard patterns
                            if (!oldData) return { notifications: [newNotification], totalPages: 1 };

                            const currentList = Array.isArray(oldData.notifications) ? oldData.notifications : (Array.isArray(oldData) ? oldData : []);
                            return {
                                ...oldData,
                                notifications: [newNotification, ...currentList]
                            };
                        });
                    } catch (err) {
                        console.error("Failed to parse incoming notification", err);
                    }
                };

                ws.onclose = () => {
                    if (retryCountRef.current < maxRetries) {
                        const timeout = Math.pow(2, retryCountRef.current) * 1000;
                        reconnectTimeout = setTimeout(connect, timeout);
                        retryCountRef.current += 1;
                    }
                };

                ws.onerror = () => {
                    // Let onclose handle the reconnection logic
                };

            } catch (err) {
                console.error("Failed to initialize WebSocket", err);
            }
        };

        connect();

        return () => {
            clearTimeout(reconnectTimeout);
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [tenantId, queryClient]);

    const markAllRead = React.useCallback(() => {
        setUnreadCount(0);
    }, []);

    const value = React.useMemo(
        () => ({
            unreadCount,
            markAllRead,
            setUnreadCount,
        }),
        [unreadCount, markAllRead]
    );

    return (
        <NotificationsContext.Provider value={value}>
            {children}
        </NotificationsContext.Provider>
    );
}
