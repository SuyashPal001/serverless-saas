"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { NotificationsContext } from "@/lib/notifications-context";
import { useNotificationsSocket, type NotificationInboxEntry } from "@/hooks/useNotificationsSocket";
import { api } from "@/lib/api";

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
    const [unreadCount, setUnreadCount] = React.useState(0);
    const params = useParams();
    const tenantSlug = params.tenant as string;
    const router = useRouter();
    const queryClient = useQueryClient();

    React.useEffect(() => {
        api.get<{ unreadCount: number }>('/api/v1/notifications/inbox?limit=1')
            .then((res) => setUnreadCount(res.unreadCount))
            .catch(() => {/* non-fatal — badge stays at 0 */});
    }, []);

    const onNotification = React.useCallback(
        (notification: NotificationInboxEntry) => {
            setUnreadCount((prev) => prev + 1);

            if (tenantSlug) {
                queryClient.invalidateQueries({
                    queryKey: ["notifications-inbox", tenantSlug],
                });
            }

            if (notification.messageType === 'task.awaiting_approval') {
                const taskId = notification.metadata?.taskId as string | undefined;
                toast(notification.title, {
                    description: notification.body,
                    action: taskId ? {
                        label: 'Review Plan',
                        onClick: () => router.push(`/${tenantSlug}/dashboard/tasks/${taskId}`),
                    } : undefined,
                });
            } else {
                toast(notification.title, {
                    description: notification.body,
                });
            }
        },
        [queryClient, router, tenantSlug]
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