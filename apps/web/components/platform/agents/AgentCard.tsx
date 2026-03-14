"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Agent } from "./types";
import {
    Card,
    CardContent,
    CardDescription,
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
import { MoreHorizontal, Play, Pause, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface AgentCardProps {
    agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
    const queryClient = useQueryClient();
    const [isRetireDialogOpen, setIsRetireDialogOpen] = useState(false);

    const formatRelativeTime = (date: string) => {
        const now = new Date();
        const diff = now.getTime() - new Date(date).getTime();
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return "just now";
    };

    const updateStatusMutation = useMutation({
        mutationFn: ({ status }: { status: Agent["status"] }) =>
            api.patch(`/api/v1/agents/${agent.id}`, { status }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["agents"] });
        },
    });

    const getStatusBadgeVariant = (status: Agent["status"]) => {
        switch (status) {
            case "active":
                return "bg-green-500/10 text-green-500 border-green-500/20";
            case "paused":
                return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
            case "retired":
                return "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
            default:
                return "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
        }
    };

    const getTypeBadgeVariant = (type: Agent["type"]) => {
        switch (type) {
            case "ops":
                return "bg-blue-500/10 text-blue-500 border-blue-500/20";
            case "support":
                return "bg-purple-500/10 text-purple-500 border-purple-500/20";
            case "billing":
                return "bg-orange-500/10 text-orange-500 border-orange-500/20";
            case "custom":
                return "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
            default:
                return "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
        }
    };

    const isRetired = agent.status === "retired";

    return (
        <>
            <Card className="relative overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                        <CardTitle className="text-xl font-bold">{agent.name}</CardTitle>
                        <CardDescription>
                            Created {formatRelativeTime(agent.createdAt)}
                        </CardDescription>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={isRetired}>
                            <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {agent.status === "active" && (
                                <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ status: "paused" })}>
                                    <Pause className="mr-2 h-4 w-4" />
                                    Pause agent
                                </DropdownMenuItem>
                            )}
                            {agent.status === "paused" && (
                                <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ status: "active" })}>
                                    <Play className="mr-2 h-4 w-4" />
                                    Reactivate agent
                                </DropdownMenuItem>
                            )}
                            {(agent.status === "active" || agent.status === "paused") && (
                                <DropdownMenuItem 
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setIsRetireDialogOpen(true)}
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Retire agent
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-2 mb-4">
                        <Badge variant="outline" className={cn("capitalize", getTypeBadgeVariant(agent.type))}>
                            {agent.type}
                        </Badge>
                        <Badge variant="outline" className={cn("capitalize", getStatusBadgeVariant(agent.status))}>
                            {agent.status}
                        </Badge>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
                        <span>Model</span>
                        <span className="font-medium text-foreground">{agent.model || "—"}</span>
                    </div>
                </CardContent>
            </Card>

            <AlertDialog open={isRetireDialogOpen} onOpenChange={setIsRetireDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently retire the agent
                            and it will no longer be available for use.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                updateStatusMutation.mutate({ status: "retired" });
                                setIsRetireDialogOpen(false);
                            }}
                        >
                            Retire Agent
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
