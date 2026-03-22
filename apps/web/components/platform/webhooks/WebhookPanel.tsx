"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SlideOutPanel, StatusBadge, ConfirmDialog } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, AlertTriangle, AlertCircle, Play, Pause } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { usePermissions } from "@/lib/hooks/usePermissions";

export function WebhookPanel({ webhook, open, onOpenChange }: { webhook: any; open: boolean; onOpenChange: (o: boolean) => void }) {
    const { can } = usePermissions();
    const queryClient = useQueryClient();
    const [isDeleting, setIsDeleting] = useState(false);

    const { data: deliveriesResponse, isLoading: isLoadingDeliveries } = useQuery({
        queryKey: ['webhooks', webhook.id, 'deliveries'],
        queryFn: () => api.get<{ data: any[] }>(`/api/proxy/api/v1/webhooks/${webhook.id}/deliveries`),
        enabled: open
    });

    const deliveries = deliveriesResponse?.data || [];

    const toggleMutation = useMutation({
        mutationFn: async (status: 'active' | 'inactive') => {
            return api.patch(`/api/proxy/api/v1/webhooks/${webhook.id}`, { status });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['webhooks'] });
            toast.success("Webhook status updated");
        },
        onError: () => {
            toast.error("Failed to update status");
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async () => {
            return api.del(`/api/proxy/api/v1/webhooks/${webhook.id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['webhooks'] });
            toast.success("Webhook deleted");
            setIsDeleting(false);
            onOpenChange(false);
        },
        onError: () => {
            toast.error("Failed to delete webhook");
            setIsDeleting(false);
        }
    });

    const isActive = webhook.status === 'active';

    return (
        <>
            <SlideOutPanel
                open={open && !isDeleting}
                onOpenChange={onOpenChange}
                title="Webhook Details"
                description={webhook.url}
                width="lg"
                footer={
                    can('webhooks', 'delete') && (
                        <Button variant="destructive" onClick={() => setIsDeleting(true)} className="w-full sm:w-auto">
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete Endpoint
                        </Button>
                    )
                }
            >
                <div className="space-y-8">
                    <div className="flex items-center gap-3">
                        <StatusBadge status={webhook.failureCount > 0 && isActive ? 'error' : webhook.status} />
                        {webhook.failureCount > 0 && isActive && (
                            <span className="flex items-center gap-1.5 text-red-500 text-xs font-semibold bg-red-500/10 px-2 py-1 rounded-full">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {webhook.failureCount} Failures
                            </span>
                        )}
                        {can('webhooks', 'update') && (
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="ml-auto"
                                onClick={() => toggleMutation.mutate(isActive ? 'inactive' : 'active')}
                                disabled={toggleMutation.isPending}
                            >
                                {toggleMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : isActive ? (
                                    <><Pause className="w-4 h-4 mr-2" /> Disable</>
                                ) : (
                                    <><Play className="w-4 h-4 mr-2" /> Enable</>
                                )}
                            </Button>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-y-6 text-sm">
                        <div className="space-y-1">
                            <p className="text-zinc-500 font-medium">Created</p>
                            <p className="text-zinc-200">{format(new Date(webhook.createdAt), 'PPP')}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-zinc-500 font-medium">Last Delivery</p>
                            <p className="text-zinc-200">
                                {webhook.lastDeliveryAt ? formatDistanceToNow(new Date(webhook.lastDeliveryAt), { addSuffix: true }) : "Never"}
                            </p>
                        </div>
                        {webhook.disabledReason && (
                            <div className="col-span-2 space-y-1 bg-amber-500/10 p-4 rounded-md border border-amber-500/20">
                                <p className="text-amber-500 font-medium flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    Disabled Reason
                                </p>
                                <p className="text-zinc-300 text-xs mt-1">{webhook.disabledReason}</p>
                            </div>
                        )}
                        <div className="col-span-2 space-y-3 mt-2">
                            <p className="text-zinc-500 font-medium">Listening to Events</p>
                            <div className="flex flex-wrap gap-2">
                                {webhook.events.includes('*') ? (
                                    <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/20">All System Events (*)</Badge>
                                ) : (
                                    webhook.events.map((evt: string) => (
                                        <Badge key={evt} variant="outline" className="text-zinc-300 border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800/50">
                                            {evt}
                                        </Badge>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="w-full h-px bg-zinc-800/60" />

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-semibold text-foreground">Recent Deliveries</h3>
                        </div>

                        {isLoadingDeliveries ? (
                            <div className="py-8 flex justify-center">
                                <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                            </div>
                        ) : deliveries.length === 0 ? (
                            <div className="text-center py-8 border border-dashed border-zinc-800 rounded-lg bg-zinc-900/20">
                                <p className="text-zinc-500 text-sm">No payload deliveries yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {deliveries.map((delivery) => (
                                    <details key={delivery.id} className="group border border-zinc-800 rounded-md bg-zinc-900/50 overflow-hidden">
                                        <summary className="flex items-center justify-between cursor-pointer list-none focus:outline-none p-3 hover:bg-zinc-800/50 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <StatusBadge status={delivery.status} />
                                                <span className="text-sm font-medium text-zinc-200">{delivery.event}</span>
                                            </div>
                                            <div className="flex items-center gap-4 text-xs text-zinc-500">
                                                {delivery.httpStatus && (
                                                    <span className={delivery.status === 'success' ? 'text-green-500/80 font-medium' : 'text-red-500/80 font-medium'}>
                                                        {delivery.httpStatus} HTTP
                                                    </span>
                                                )}
                                                <span>{formatDistanceToNow(new Date(delivery.createdAt), { addSuffix: true })}</span>
                                            </div>
                                        </summary>
                                        <div className="p-4 border-t border-zinc-800 bg-zinc-950/50 space-y-4 text-xs">
                                            <div className="space-y-2">
                                                <p className="font-semibold text-zinc-400">Payload</p>
                                                <pre className="bg-zinc-900 border border-zinc-800 p-3 rounded-md overflow-x-auto text-zinc-300 max-h-48 overflow-y-auto">
                                                    {JSON.stringify(delivery.payload, null, 2)}
                                                </pre>
                                            </div>
                                            {delivery.responseBody && (
                                                <div className="space-y-2">
                                                    <p className="font-semibold text-zinc-400">Response</p>
                                                    <pre className="bg-zinc-900 border border-zinc-800 p-3 rounded-md overflow-x-auto text-zinc-300 max-h-48 overflow-y-auto">
                                                        {delivery.responseBody}
                                                    </pre>
                                                </div>
                                            )}
                                            {delivery.nextRetryAt && delivery.status === 'failed' && (
                                                <p className="text-amber-500 font-medium">Next automated retry at {new Date(delivery.nextRetryAt).toLocaleString()}</p>
                                            )}
                                        </div>
                                    </details>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </SlideOutPanel>

            <ConfirmDialog 
                open={isDeleting}
                onOpenChange={setIsDeleting}
                title="Delete Webhook"
                description={`Are you sure you want to delete this endpoint? It will immediately stop receiving events. This action cannot be undone.`}
                confirmLabel="Delete"
                variant="danger"
                onConfirm={() => deleteMutation.mutate()}
                loading={deleteMutation.isPending}
            />
        </>
    );
}
