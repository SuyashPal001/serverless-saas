"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NotificationsInboxResponse } from "@/components/platform/notifications/types";

export function useUnreadCount(): { unreadCount: number } {
    const params = useParams();
    const tenantSlug = params.tenant as string;

    const { data } = useQuery<NotificationsInboxResponse>({
        queryKey: ["notifications-unread-count", tenantSlug],
        queryFn: () =>
            api.get<NotificationsInboxResponse>(
                `/api/v1/notifications/inbox?page=1&pageSize=1`
            ),
        refetchInterval: 60_000,
    });

    return { unreadCount: data?.unreadCount ?? 0 };
}
