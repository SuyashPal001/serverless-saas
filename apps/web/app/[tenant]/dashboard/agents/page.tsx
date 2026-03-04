"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { CreateAgentDialog } from "@/components/platform/agents/CreateAgentDialog";
import { AgentCard } from "@/components/platform/agents/AgentCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import type { AgentsResponse } from "@/components/platform/agents/types";

export default function AgentsPage() {
    const { tenantId, permissions } = useTenant();

    const { data, isLoading, error } = useQuery({
        queryKey: ["agents", tenantId],
        queryFn: () => api.get<AgentsResponse>("/api/v1/agents"),
    });

    const canCreate = can(permissions, "agents", "create");

    if (error) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
                    <p className="text-muted-foreground">Manage your autonomous agents.</p>
                </div>
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                        Failed to load agents. Please try again later.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
                    <p className="text-muted-foreground">Manage your autonomous agents.</p>
                </div>
                {canCreate && <CreateAgentDialog />}
            </div>

            {isLoading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-[180px] w-full" />
                    ))}
                </div>
            ) : data?.agents && data.agents.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {data.agents.map((agent) => (
                        <AgentCard key={agent.id} agent={agent} />
                    ))}
                </div>
            ) : (
                <div className="flex h-[450px] shrink-0 items-center justify-center rounded-md border border-dashed">
                    <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                        <h3 className="mt-4 text-lg font-semibold">No agents found</h3>
                        <p className="mb-4 mt-2 text-sm text-muted-foreground">
                            You haven&apos;t created any agents yet. Get started by creating your first one.
                        </p>
                        {canCreate && <CreateAgentDialog />}
                    </div>
                </div>
            )}
        </div>
    );
}
