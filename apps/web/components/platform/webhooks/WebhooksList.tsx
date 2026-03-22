"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState, StatusBadge } from "@/components/platform/shared";
import { Loader2, AlertTriangle, Workflow } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";

export function WebhooksList({ onSelectWebhook }: { onSelectWebhook: (wh: any) => void }) {
    const { data: response, isLoading } = useQuery({
        queryKey: ['webhooks'],
        queryFn: () => api.get<{ data: any[] }>('/api/v1/webhooks')
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-12 flex-col items-center gap-4 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p>Loading webhooks...</p>
            </div>
        );
    }

    const webhooks = response?.data || [];

    if (webhooks.length === 0) {
        return (
            <EmptyState 
                icon={<Workflow className="w-12 h-12" />}
                title="No webhooks configured" 
                description="Set up webhooks to receive real-time HTTP payload notifications originating natively from the core cloud."
            />
        );
    }

    return (
        <div className="border border-zinc-800 rounded-lg bg-card overflow-hidden">
            <Table>
                <TableHeader className="bg-muted/50">
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead>Endpoint URL</TableHead>
                        <TableHead>Event Span</TableHead>
                        <TableHead>Active Status</TableHead>
                        <TableHead>Failure Index</TableHead>
                        <TableHead className="text-right">Last Delivered</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {webhooks.map((wh) => (
                        <TableRow 
                            key={wh.id} 
                            onClick={() => onSelectWebhook(wh)}
                            className="cursor-pointer border-zinc-800/50 hover:bg-muted/40 transition-colors"
                        >
                            <TableCell className="font-medium truncate max-w-[280px]" title={wh.url}>
                                {wh.url}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                                {wh.events.includes('*') 
                                    ? <span className="text-primary font-medium tracking-wide">All Events</span>
                                    : `${wh.events.length} explicit match${wh.events.length === 1 ? '' : 'es'}`}
                            </TableCell>
                            <TableCell>
                                <StatusBadge status={wh.failureCount > 0 && wh.status === 'active' ? 'error' : wh.status} />
                            </TableCell>
                            <TableCell>
                                {wh.failureCount > 0 ? (
                                    <span className="flex items-center gap-1.5 text-red-500 font-medium text-sm">
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        {wh.failureCount}
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground text-sm opacity-50">&mdash;</span>
                                )}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-sm">
                                {wh.lastDeliveryAt 
                                    ? <span title={new Date(wh.lastDeliveryAt).toLocaleString()}>{formatDistanceToNow(new Date(wh.lastDeliveryAt), { addSuffix: true })}</span> 
                                    : "No payloads"}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
