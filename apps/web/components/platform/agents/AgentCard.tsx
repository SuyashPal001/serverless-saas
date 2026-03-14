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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Agent, AgentStatus, AgentType } from "./types";

interface AgentCardProps {
    agent: Agent;
}

const typeColors: Record<AgentType, string> = {
    ops: "bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/20",
    support: "bg-purple-500/10 text-purple-500 border-purple-500/20 hover:bg-purple-500/20",
    billing: "bg-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/20",
    custom: "bg-muted text-muted-foreground border-border hover:bg-muted/80",
};

const statusColors: Record<AgentStatus, string> = {
    active: "bg-green-500/10 text-green-500 border-green-500/20",
    paused: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    retired: "bg-muted text-muted-foreground border-border",
};

function formatRelativeTime(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return "just now";
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    
    return date.toLocaleDateString();
}

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
            const actionText = status === 'paused' ? 'paused' : status === 'active' ? 'resumed' : 'retired';
            toast.success(`Agent ${actionText} successfully`);
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to update agent");
        },
    });

    const isRetired = agent.status === 'retired';
    const isActive = agent.status === 'active';
    const isPaused = agent.status === 'paused';

    return (
        <>
            <Card className={cn(
                "group relative overflow-hidden border-border transition-all hover:border-primary/50",
                isRetired && "opacity-60 grayscale-[0.5]"
            )}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-semibold text-foreground">
                                {agent.name}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className={cn("text-[10px] font-bold uppercase tracking-wider", typeColors[agent.type])}>
                                {agent.type}
                            </Badge>
                            <Badge variant="outline" className={cn("text-[10px] font-bold uppercase tracking-wider", statusColors[agent.status])}>
                                {agent.status}
                            </Badge>
                        </div>
                    </div>
                    {!isRetired && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                    <MoreHorizontal className="h-4 w-4" />
                                    <span className="sr-only">Open menu</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[160px]">
                                {isActive && (
                                    <DropdownMenuItem onClick={() => updateStatusMutation.mutate('paused')}>
                                        <Pause className="mr-2 h-4 w-4" />
                                        Pause agent
                                    </DropdownMenuItem>
                                )}
                                {isPaused && (
                                    <DropdownMenuItem onClick={() => updateStatusMutation.mutate('active')}>
                                        <Play className="mr-2 h-4 w-4" />
                                        Reactivate agent
                                    </DropdownMenuItem>
                                )}
                                {(isActive || isPaused) && (
                                    <DropdownMenuItem
                                        onClick={() => setShowRetireConfirm(true)}
                                        className="text-destructive focus:text-destructive"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Retire agent
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </CardHeader>
                <CardContent className="pb-4">
                    <div className="grid gap-2 text-sm text-muted-foreground">
                        <div className="flex justify-between items-center py-1 border-b border-border/50">
                            <span>Model</span>
                            <span className="font-mono text-xs text-foreground bg-muted px-1.5 py-0.5 rounded">
                                {agent.model || "—"}
                            </span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                            <span>Created</span>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        {formatRelativeTime(agent.createdAt)}
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {new Date(agent.createdAt).toLocaleString()}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <AlertDialog open={showRetireConfirm} onOpenChange={setShowRetireConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Retire {agent.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently retire the agent. This action cannot be undone and the agent will no longer be available for use.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={updateStatusMutation.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => updateStatusMutation.mutate('retired')}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={updateStatusMutation.isPending}
                        >
                            {updateStatusMutation.isPending ? "Retiring..." : "Retire Agent"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

