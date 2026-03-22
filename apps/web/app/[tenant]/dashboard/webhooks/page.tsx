"use client";

import { useState } from "react";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { WebhooksList } from "@/components/platform/webhooks/WebhooksList";
import { CreateWebhookModal } from "@/components/platform/webhooks/CreateWebhookModal";
import { WebhookPanel } from "@/components/platform/webhooks/WebhookPanel";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { Plus } from "lucide-react";

export default function WebhooksPage() {
    const { can } = usePermissions();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [selectedWebhook, setSelectedWebhook] = useState<any | null>(null);

    return (
        <PermissionGate resource="webhooks" action="read">
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            Webhooks
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Manage webhook endpoints to receive real-time events.
                        </p>
                    </div>
                    {can('webhooks', 'create') && (
                        <Button onClick={() => setIsCreateOpen(true)}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Endpoint
                        </Button>
                    )}
                </div>
                
                <WebhooksList onSelectWebhook={setSelectedWebhook} />
                
                <CreateWebhookModal 
                    open={isCreateOpen} 
                    onOpenChange={setIsCreateOpen} 
                />
                
                {selectedWebhook && (
                    <WebhookPanel 
                        webhook={selectedWebhook} 
                        open={!!selectedWebhook} 
                        onOpenChange={(open: boolean) => !open && setSelectedWebhook(null)} 
                    />
                )}
            </div>
        </PermissionGate>
    );
}
