"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { CreateAgentDialog } from "./CreateAgentDialog";
import { AgentCard } from "./AgentCard";
import { AgentTemplatePicker } from "./AgentTemplatePicker";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentsResponse } from "./types";

export function AgentsView() {
    const { role } = useTenant();
    const isPlatformAdmin = role === 'platform_admin';

    const { data, isLoading, isError, error } = useQuery<AgentsResponse>({
        queryKey: ["agents"],
        queryFn: () => api.get<AgentsResponse>("/api/v1/agents"),
    });

    if (isError) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">Agents</h1>
                        <p className="text-muted-foreground mt-2">Configure and manage your AI agents</p>
                    </div>
                </div>
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                        {error instanceof Error ? error.message : "Failed to load agents. Please try again later."}
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Agents</h1>
                    <p className="text-muted-foreground mt-2">Configure and manage your AI agents</p>
                </div>
                {isPlatformAdmin && (
                    <CreateAgentDialog>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            New Agent
                        </Button>
                    </CreateAgentDialog>
                )}
            </div>

            {isLoading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-[200px] w-full rounded-xl" />
                    ))}
                </div>
            ) : data?.data && data.data.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {data.data
                        .filter(agent => !agent.isInternal && (isPlatformAdmin || agent.status === 'active'))
                        .map((agent) => (
                            <AgentCard key={agent.id} agent={agent} />
                        ))}
                </div>
            ) : (
                <AgentTemplatePicker />
            )}
        </div>
    );
}
