"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox, AlertCircle, CheckCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
    Notification,
    NotificationsInboxResponse,
} from "@/components/platform/notifications/types";
import { useNotifications } from "@/lib/notifications-context";
import { can } from "@/lib/permissions";
import { toast } from "sonner";

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

const PAGE_SIZE = 20;

export default function NotificationsPage() {
    const params = useParams();
    const tenantSlug = params.tenant as string;
    const router = useRouter();
    const { permissions = [] } = useTenant();

    // Notifications Context replaces the raw socket hook
    const { markAllRead: clearSidebarBadge } = useNotifications();
    const canUpdate = can(permissions, "notifications", "update");

    const queryClient = useQueryClient();
    const [page, setPage] = React.useState(1);

    const queryKey = ["notifications-inbox", tenantSlug, page] as const;

    // Clear the unread badge in sidebar upon visiting this page
    React.useEffect(() => {
        clearSidebarBadge();
    }, [clearSidebarBadge]);

    const { data, isLoading, isError, error } =
        useQuery<NotificationsInboxResponse>({
            queryKey,
            queryFn: () =>
                api.get<NotificationsInboxResponse>(
                    `/api/v1/notifications/inbox?page=${page}&pageSize=${PAGE_SIZE}`
                ),
        });

    // Single mark-as-read — optimistic cache update
    const markReadMutation = useMutation({
        mutationFn: (id: string) =>
            api.patch(`/api/v1/notifications/inbox/${id}/read`),
        onMutate: async (id: string) => {
            await queryClient.cancelQueries({ queryKey });
            queryClient.setQueryData<NotificationsInboxResponse>(
                queryKey,
                (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        unreadCount: Math.max(0, old.unreadCount - 1),
                        items: old.items.map((n) =>
                            n.id === id
                                ? { ...n, read: true, readAt: new Date().toISOString() }
                                : n
                        ),
                    };
                }
            );
        },
    });

    // Mark all as read
    const markAllMutation = useMutation({
        mutationFn: () => api.patch(`/api/v1/notifications/inbox/read-all`),
        onSuccess: () => {
            setPage(1);
            queryClient.invalidateQueries({
                queryKey: ["notifications-inbox", tenantSlug, page],
            });
        },
    });

    const notifications = data?.items ?? [];
    const totalPages = Math.ceil((data?.total ?? 0) / (data?.limit ?? PAGE_SIZE)) || 1;
    const unreadCount = data?.unreadCount ?? 0;

    const approveMutation = useMutation({
        mutationFn: (taskId: string) =>
            api.put(`/api/v1/tasks/${taskId}/plan/approve`, { approved: true }),
        onSuccess: (_data, taskId) => {
            router.push(`/${tenantSlug}/dashboard/board/${taskId}`);
        },
        onError: () => {
            toast.error("Failed to approve plan. Please try again.");
        },
    });

    const handleRowClick = (n: Notification) => {
        if (!n.read && canUpdate) {
            markReadMutation.mutate(n.id);
        }
        if (n.metadata?.taskId) {
            router.push(`/${tenantSlug}/dashboard/board/${n.metadata.taskId}`);
        }
    };

    return (
        <PermissionGate resource="notifications" action="read">
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">
                        Notifications
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Stay up to date with activity across your workspace.
                    </p>
                </div>

                {unreadCount > 0 && !isLoading && !isError && canUpdate && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() => markAllMutation.mutate()}
                        disabled={markAllMutation.isPending}
                    >
                        <CheckCheck className="h-4 w-4" />
                        Mark all as read
                    </Button>
                )}
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div
                            key={i}
                            className="rounded-lg border border-border p-4 space-y-2"
                        >
                            <Skeleton className="h-4 w-2/5" />
                            <Skeleton className="h-3 w-4/5" />
                        </div>
                    ))}
                </div>
            )}

            {/* Error */}
            {isError && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                        {error instanceof Error
                            ? error.message
                            : "Failed to load notifications."}
                    </AlertDescription>
                </Alert>
            )}

            {/* Empty */}
            {!isLoading && !isError && notifications.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
                    <Inbox className="h-10 w-10 opacity-40" />
                    <p className="text-base font-medium">You&apos;re all caught up.</p>
                </div>
            )}

            {/* Notification list */}
            {!isLoading && !isError && notifications.length > 0 && (
                <div className="flex flex-col gap-1">
                    {notifications.map((n) => (
                        <div
                            key={n.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleRowClick(n)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ")
                                    handleRowClick(n);
                            }}
                            className={[
                                "rounded-lg px-4 py-3.5 transition-colors group relative",
                                (canUpdate && !n.read) || n.metadata?.taskId ? "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring" : "",
                                n.read
                                    ? "bg-transparent hover:bg-muted/40"
                                    : "border border-primary/20 bg-primary/5 hover:bg-primary/10",
                            ].join(" ")}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 space-y-1">
                                    <p
                                        className={[
                                            "text-sm leading-snug",
                                            n.read ? "font-medium text-muted-foreground" : "font-bold text-primary",
                                        ].join(" ")}
                                    >
                                        {n.title}
                                    </p>
                                    <p
                                        className={[
                                            "text-sm line-clamp-2 leading-relaxed",
                                            n.read
                                                ? "text-muted-foreground/70"
                                                : "text-foreground/90",
                                        ].join(" ")}
                                    >
                                        {n.body}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                                    <span className="text-[11px] text-muted-foreground whitespace-nowrap font-medium">
                                        {relativeTime(n.createdAt)}
                                    </span>
                                    <Badge
                                        variant="secondary"
                                        className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0"
                                    >
                                        {n.messageType}
                                    </Badge>
                                </div>
                            </div>

                            {n.messageType === 'task.awaiting_approval' && typeof n.metadata?.taskId === 'string' && (
                                <div className="mt-2.5 flex justify-end">
                                    <Button
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (!n.read && canUpdate) markReadMutation.mutate(n.id);
                                            approveMutation.mutate(n.metadata!.taskId as string);
                                        }}
                                        disabled={approveMutation.isPending}
                                    >
                                        Approve
                                    </Button>
                                </div>
                            )}
                            {n.messageType !== 'task.awaiting_approval' && !n.read && canUpdate && (
                                <div className="absolute right-4 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-[10px] uppercase font-bold tracking-wider text-primary">Click to mark read</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Pagination */}
            {!isLoading && !isError && notifications.length > 0 && (
                <div className="flex items-center justify-between px-1">
                    <p className="text-xs text-muted-foreground">
                        Page{" "}
                        <span className="font-medium text-foreground">{page}</span>{" "}
                        of{" "}
                        <span className="font-medium text-foreground">
                            {totalPages}
                        </span>
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            <span className="sr-only">Previous page</span>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() =>
                                setPage((p) => Math.min(totalPages, p + 1))
                            }
                            disabled={page >= totalPages}
                        >
                            <ChevronRight className="h-4 w-4" />
                            <span className="sr-only">Next page</span>
                        </Button>
                    </div>
                </div>
            )}
        </div>
        </PermissionGate>
    );
}
