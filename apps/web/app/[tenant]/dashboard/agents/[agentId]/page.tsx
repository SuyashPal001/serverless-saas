"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, AlertCircle, User, Cpu, Calendar, Pause } from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { WorkflowsList } from "@/components/platform/agents/WorkflowsList";
import { toast } from "sonner";
import type { AgentDetail, AgentStatus } from "@/components/platform/agents/types";
import { cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
    ops: "bg-blue-500/10 text-blue-500",
    support: "bg-green-500/10 text-green-500",
    billing: "bg-purple-500/10 text-purple-500",
    custom: "bg-orange-500/10 text-orange-500",
};

const statusColors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-500",
    paused: "bg-yellow-500/10 text-yellow-500",
    retired: "bg-red-500/10 text-red-500",
};

export default function AgentDetailPage() {
    const params = useParams();
    const agentId = params.agentId as string;
    const tenantSlug = params.tenant as string;
    const queryClient = useQueryClient();
    const { tenantId, permissions = [] } = useTenant();

    const { data: agent, isLoading: isLoadingAgent, error: agentError } = useQuery({
        queryKey: ["agents", agentId],
        queryFn: () => api.get<AgentDetail>(`/api/v1/agents/${agentId}`),
    });

    const updateStatusMutation = useMutation({
        mutationFn: (status: AgentStatus) => {
            return api.patch(`/api/v1/agents/${agentId}`, { status });
        },
        onSuccess: (_, status) => {
            queryClient.invalidateQueries({ queryKey: ["agents", agentId] });
            queryClient.invalidateQueries({ queryKey: ["agents", tenantId] });
            toast.success(`Agent ${status === 'paused' ? 'paused' : 'resumed'} successfully`);
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to update agent");
        },
    });

    const canUpdate = can(permissions, "agents", "update");

    const formattedDate = agent ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    }).format(new Date(agent.createdAt)) : "";

    if (agentError) {
        return (
            <div className="space-y-6">
                <Link
                    href={`/${tenantSlug}/dashboard/agents`}
                    className="flex items-center text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Agents
                </Link>
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                        Failed to load agent details. The agent might not exist or you don&apos;t have access.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const isPaused = agent?.status === "paused";

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <Link
                    href={`/${tenantSlug}/dashboard/agents`}
                    className="flex items-center text-sm text-muted-foreground hover:text-foreground w-fit"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Agents
                </Link>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    {isLoadingAgent ? (
                        <div className="space-y-2">
                            <Skeleton className="h-10 w-64" />
                            <div className="flex gap-2">
                                <Skeleton className="h-6 w-20" />
                                <Skeleton className="h-6 w-20" />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <h1 className="text-3xl font-bold tracking-tight">{agent?.name}</h1>
                                <Badge variant="secondary" className={typeColors[agent?.type || ""]}>
                                    {agent?.type}
                                </Badge>
                                <Badge variant="outline" className={statusColors[agent?.status || ""]}>
                                    {agent?.status}
                                </Badge>
                            </div>
                            <p className="text-muted-foreground">
                                Manage and monitor workflow executions for this agent.
                            </p>
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        {!isLoadingAgent && canUpdate && agent?.status !== "retired" && (
                            <Button
                                variant="outline"
                                onClick={() => updateStatusMutation.mutate(isPaused ? "active" : "paused")}
                                disabled={updateStatusMutation.isPending}
                            >
                                {isPaused ? (
                                    <>
                                        <Play className="mr-2 h-4 w-4" />
                                        Reactivate Agent
                                    </>
                                ) : (
                                    <>
                                        <Pause className="mr-2 h-4 w-4" />
                                        Pause Agent
                                    </>
                                )}
                            </Button>
                        )}
                        {!isLoadingAgent && (
                            <Button asChild>
                                <Link href={`/${tenantSlug}/dashboard/agents/${agentId}/runs`}>
                                    <Play className="mr-2 h-4 w-4" />
                                    View Runs
                                </Link>
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-2">
                    <CardContent className="pt-6">
                        <div className="grid gap-6 sm:grid-cols-2">
                            <div className="flex items-start gap-3">
                                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                    <Cpu className="h-5 w-5" />
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-sm font-medium text-muted-foreground">Model</p>
                                    {isLoadingAgent ? (
                                        <Skeleton className="h-5 w-24" />
                                    ) : (
                                        <p className="font-semibold">{agent?.model}</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                    <User className="h-5 w-5" />
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-sm font-medium text-muted-foreground">Created By</p>
                                    {isLoadingAgent ? (
                                        <Skeleton className="h-5 w-32" />
                                    ) : (
                                        <p className="font-semibold">{agent?.createdBy}</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                    <Calendar className="h-5 w-5" />
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-sm font-medium text-muted-foreground">Created Date</p>
                                    {isLoadingAgent ? (
                                        <Skeleton className="h-5 w-40" />
                                    ) : (
                                        <p className="font-semibold">{formattedDate}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="pt-4">
                <WorkflowsList agentId={agentId} />
            </div>
        </div>
    );
}
