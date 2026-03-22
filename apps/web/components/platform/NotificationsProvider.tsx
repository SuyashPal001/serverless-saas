"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { NotificationsContext } from "@/lib/notifications-context";
import { useNotificationsSocket, type NotificationInboxEntry } from "@/hooks/useNotificationsSocket";

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
    const [unreadCount, setUnreadCount] = React.useState(0);
    const params = useParams();
    const tenantSlug = params.tenant as string;
    const queryClient = useQueryClient();

    const onNotification = React.useCallback(
        (notification: NotificationInboxEntry) => {
            // Check if we should ignore the notification
            setUnreadCount((prev) => prev + 1);

            // Invalidate query to refresh inbox
            if (tenantSlug) {
                queryClient.invalidateQueries({
                    queryKey: ["notifications-inbox", tenantSlug],
                });
            }

            // Optional: Toast
            toast(notification.title, {
                description: notification.body,
            });
        },
        [queryClient, tenantSlug]
    );

    useNotificationsSocket({
        tenantSlug,
        onNotification,
    });

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