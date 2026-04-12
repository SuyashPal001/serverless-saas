"use client";

import { useState } from "react";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { IntegrationsGrid } from "@/components/platform/integrations/IntegrationsGrid";
import { CreateIntegrationModal } from "@/components/platform/integrations/CreateIntegrationModal";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function CustomIntegrationsPage() {
    const [modalOpen, setModalOpen] = useState(false);

    return (
        <PermissionGate resource="integrations" action="read">
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            Integrations
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Connect custom MCP servers to extend your agent&apos;s capabilities.
                        </p>
                    </div>
                    <Button onClick={() => setModalOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add integration
                    </Button>
                </div>

                {/* Grid */}
                <IntegrationsGrid />

                {/* Create modal */}
                <CreateIntegrationModal
                    open={modalOpen}
                    onOpenChange={setModalOpen}
                />
            </div>
        </PermissionGate>
    );
}
