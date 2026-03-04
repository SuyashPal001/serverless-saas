"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, GitBranch } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { Workflow, WorkflowsResponse } from "./types";

interface WorkflowsListProps {
    agentId: string;
}

export function WorkflowsList({ agentId }: WorkflowsListProps) {
    const { data, isLoading, error } = useQuery({
        queryKey: ["workflows", agentId],
        queryFn: () => api.get<WorkflowsResponse>(`/api/v1/agents/${agentId}/workflows`),
    });

    const workflows: Workflow[] = data?.workflows ?? [];

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>Failed to load workflows for this agent.</AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-xl font-semibold">Workflows</h2>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                    ))}
                </div>
            ) : workflows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No workflows associated with this agent.</p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Runs</TableHead>
                            <TableHead>Last Run</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {workflows.map((workflow) => (
                            <TableRow key={workflow.id}>
                                <TableCell className="font-medium">{workflow.name}</TableCell>
                                <TableCell>
                                    <Badge
                                        variant="outline"
                                        className={
                                            workflow.status === "active"
                                                ? "bg-emerald-500/10 text-emerald-500"
                                                : "bg-yellow-500/10 text-yellow-500"
                                        }
                                    >
                                        {workflow.status}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">{workflow.runCount}</TableCell>
                                <TableCell className="text-muted-foreground">
                                    {workflow.lastRunAt
                                        ? new Intl.DateTimeFormat("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                        }).format(new Date(workflow.lastRunAt))
                                        : "—"}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
