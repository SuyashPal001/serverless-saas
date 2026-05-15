"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SlideOutPanel, StatusBadge, ConfirmDialog } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
import { Loader2, Unplug, Settings2, ShieldCheck, Activity } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { usePermissions } from "@/lib/hooks/usePermissions";

export function IntegrationPanel({ integration, open, onOpenChange }: { integration: any; open: boolean; onOpenChange: (o: boolean) => void }) {
    const { can } = usePermissions();
    const queryClient = useQueryClient();
    const [isDisconnecting, setIsDisconnecting] = useState(false);

    const disconnectMutation = useMutation({
        mutationFn: async () => {
            return api.del(`/api/v1/integrations/${integration.id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['integrations'] });
            toast.success(`${integration.name} disconnected successfully.`);
            setIsDisconnecting(false);
            onOpenChange(false);
        },
        onError: () => {
            toast.error("Failed to disconnect integration.");
            setIsDisconnecting(false);
        }
    });

    if (!integration) return null;

    const getProviderName = (provider: string) => {
        return provider.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };

    return (
        <>
            <SlideOutPanel
                open={open && !isDisconnecting}
                onOpenChange={onOpenChange}
                title={integration.name}
                description={`${getProviderName(integration.provider)} Infrastructure Segment`}
                width="md"
                footer={
                    can('integrations', 'delete') && (
                        <div className="w-full flex justify-between items-center bg-red-500/5 border border-red-500/20 px-6 py-4 -mx-6 -mb-4 border-b-0 rounded-t-lg">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-semibold text-red-500">Danger Zone</span>
                                <span className="text-xs font-medium text-red-500/70">Permanently revoke connection.</span>
                            </div>
                            <Button variant="destructive" onClick={() => setIsDisconnecting(true)} size="sm" className="shadow-sm">
                                <Unplug className="w-4 h-4 mr-2" />
                                Disconnect
                            </Button>
                        </div>
                    )
                }
            >
                <div className="space-y-8">
                    <div className="flex items-center gap-4 bg-zinc-900 border border-zinc-800 p-5 rounded-lg shadow-inner">
                        <Activity className="w-6 h-6 text-zinc-500" />
                        <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-bold text-zinc-300">Connection Status</span>
                            <span className="text-xs font-medium text-zinc-500">Monitored continuously via heartbeats</span>
                        </div>
                        <div className="ml-auto">
                            <StatusBadge status={integration.status} />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-xs font-bold flex items-center gap-2 text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-3">
                            <Settings2 className="w-4 h-4" /> Configuration Payloads
                        </h3>
                        {integration.config && Object.keys(integration.config).length > 0 ? (
                            <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-md text-xs text-zinc-400 font-mono shadow-inner overflow-auto max-h-[300px]">
                                {JSON.stringify(integration.config, null, 2)}
                            </pre>
                        ) : (
                            <p className="text-sm text-zinc-500 italic bg-zinc-900/30 p-4 rounded-lg border border-dashed border-zinc-800">No public configuration variables exposed for this instance schema.</p>
                        )}
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-xs font-bold flex items-center gap-2 text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-3">
                            <ShieldCheck className="w-4 h-4" /> Identity & Lifecycle
                        </h3>
                        <div className="grid grid-cols-2 gap-y-6 gap-x-4 bg-zinc-900/30 p-5 rounded-lg border border-zinc-800/50 shadow-sm">
                            <div>
                                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Integration ID</p>
                                <p className="text-sm text-zinc-300 font-mono mt-1.5 pr-2 truncate" title={integration.id}>{integration.id}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Tenant Bound</p>
                                <p className="text-sm text-zinc-300 font-mono mt-1.5 pr-2 truncate" title={integration.tenantId}>{integration.tenantId}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Configured On</p>
                                <p className="text-sm text-zinc-300 mt-1.5 font-medium">{format(new Date(integration.createdAt), 'PPP')}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Last Handshake</p>
                                <p className="text-sm text-zinc-300 mt-1.5 font-medium">{format(new Date(integration.updatedAt), 'PPP')}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </SlideOutPanel>

            <ConfirmDialog 
                open={isDisconnecting}
                onOpenChange={setIsDisconnecting}
                title="Disconnect Integration"
                description={`You are about to permanently sever the ${getProviderName(integration.provider)} connection attached to ${integration.name}. Any active workflows utilizing these pipelines will instantly begin to crash. This operation cannot be reversed.`}
                confirmLabel="Sever Connection"
                variant="danger"
                onConfirm={() => disconnectMutation.mutate()}
                loading={disconnectMutation.isPending}
            />
        </>
    );
}
