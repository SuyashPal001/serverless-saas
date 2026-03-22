"use client";

import { useState } from "react";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { IntegrationsGrid, CreateIntegrationModal } from "@/components/platform/integrations";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { Plus } from "lucide-react";

export default function IntegrationsPage() {
    const { can } = usePermissions();
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const canCreate = can('integrations', 'create');

    return (
        <PermissionGate resource="integrations" action="read">
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            Integrations
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Connect your workspace natively with external MCP servers and robust data providers.
                        </p>
                    </div>
                    {canCreate && (
                        <Button onClick={() => setIsCreateOpen(true)}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Integration
                        </Button>
                    )}
                </div>
                
                <IntegrationsGrid />
                
                <CreateIntegrationModal 
                    open={isCreateOpen} 
                    onOpenChange={setIsCreateOpen}
                />
            </div>
        </PermissionGate>
    );
}
