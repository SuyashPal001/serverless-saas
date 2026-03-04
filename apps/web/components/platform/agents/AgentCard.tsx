"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { Agent, AgentStatus } from "./types";

interface AgentCardProps {
    agent: Agent;
}

const typeColors: Record<string, string> = {
    ops: "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20",
    support: "bg-green-500/10 text-green-500 hover:bg-green-500/20",
    billing: "bg-purple-500/10 text-purple-500 hover:bg-purple-500/20",
    custom: "bg-orange-500/10 text-orange-500 hover:bg-orange-500/20",
};

const statusColors: Record<AgentStatus, string> = {
    active: "bg-emerald-500/10 text-emerald-500",
    paused: "bg-yellow-500/10 text-yellow-500",
    retired: "bg-red-500/10 text-red-500",
};

export function AgentCard({ agent }: AgentCardProps) {
    const params = useParams();
    const tenantSlug = params.tenant as string;
    const { tenantId, permissions } = useTenant();
    const queryClient = useQueryClient();
    const [showRetireConfirm, setShowRetireConfirm] = useState(false);

    const updateStatusMutation = useMutation({
        mutationFn: (status: AgentStatus) => {
            return api.patch(`/api/v1/agents/${agent.id}`, { status });
        },
        onSuccess: (_, status) => {
            queryClient.invalidateQueries({ queryKey: ["agents", tenantId] });
            toast.success(`Agent ${status === 'paused' ? 'paused' : status === 'active' ? 'resumed' : 'retired'} successfully`);
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to update agent");
        },
    });

    const canUpdate = can(permissions, "agents", "update");

    const formattedDate = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(agent.createdAt));

    return (
        <>
            <Card className="group relative overflow-hidden transition-all hover:border-primary/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                        <Link
                            href={`/${tenantSlug}/dashboard/agents/${agent.id}`}
                            className="text-lg font-semibold hover:underline"
                        >
                            {agent.name}
                        </Link>
                        <div className="flex items-center gap-2">
                            <Badge variant="secondary" className={typeColors[agent.type]}>
                                {agent.type}
                            </Badge>
                            <Badge variant="outline" className={statusColors[agent.status]}>
                                {agent.status}
                            </Badge>
                        </div>
                    </div>
                    {canUpdate && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                    <span className="sr-only">Open menu</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {agent.status === 'active' ? (
                                    <DropdownMenuItem onClick={() => updateStatusMutation.mutate('paused')}>
                                        <Pause className="mr-2 h-4 w-4" />
                                        Pause
                                    </DropdownMenuItem>
                                ) : agent.status === 'paused' ? (
                                    <DropdownMenuItem onClick={() => updateStatusMutation.mutate('active')}>
                                        <Play className="mr-2 h-4 w-4" />
                                        Resume
                                    </DropdownMenuItem>
                                ) : null}
                                {agent.status !== 'retired' && (
                                    <DropdownMenuItem
                                        onClick={() => setShowRetireConfirm(true)}
                                        className="text-destructive focus:text-destructive"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Retire
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </CardHeader>
                <CardContent>
                    <div className="grid gap-2 text-sm text-muted-foreground">
                        <div className="flex justify-between">
                            <span>Model</span>
                            <span className="font-medium text-foreground">{agent.model}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Created</span>
                            <span>{formattedDate}</span>
                        </div>
                    </div>
                </CardContent>
                <Link
                    href={`/${tenantSlug}/dashboard/agents/${agent.id}`}
                    className="absolute inset-0 z-0"
                    aria-label={`View details for ${agent.name}`}
                />
            </Card>

            <AlertDialog open={showRetireConfirm} onOpenChange={setShowRetireConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently retire the agent. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => updateStatusMutation.mutate('retired')}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Retire Agent
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
