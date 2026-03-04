"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
    ArrowLeft,
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    Clock,
    CheckCircle2,
    PlayCircle,
    XCircle,
    Info,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type {
    AgentDetail,
    AgentRun,
    AgentRunsResponse,
    RunStatus,
} from "@/components/platform/agents/types";

const statusConfig: Record<
    RunStatus,
    { color: string; icon: React.ReactNode }
> = {
    completed: {
        color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
        icon: <CheckCircle2 className="h-3 w-3" />,
    },
    running: {
        color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        icon: <PlayCircle className="h-3 w-3 animate-pulse" />,
    },
    failed: {
        color: "bg-red-500/10 text-red-500 border-red-500/20",
        icon: <XCircle className="h-3 w-3" />,
    },
    awaiting_approval: {
        color: "bg-amber-500/10 text-amber-500 border-amber-500/20",
        icon: <Info className="h-3 w-3" />,
    },
};

function formatDuration(start: string, end: string | null): string {
    if (!end) return "—";
    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    if (diffMs < 0) return "—";
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

export default function AgentRunsPage() {
    const params = useParams();
    const agentId = params.agentId as string;
    const tenantSlug = params.tenant as string;

    const [page, setPage] = React.useState(1);
    const [expandedRows, setExpandedRows] = React.useState<Set<string>>(
        new Set()
    );
    const pageSize = 20;

    const { data: agent, isLoading: isLoadingAgent } = useQuery({
        queryKey: ["agents", agentId],
        queryFn: () => api.get<AgentDetail>(`/api/v1/agents/${agentId}`),
    });

    const {
        data,
        isLoading: isLoadingRuns,
        isError,
        error,
    } = useQuery<AgentRunsResponse>({
        queryKey: ["agent-runs", agentId, page, pageSize],
        queryFn: () =>
            api.get<AgentRunsResponse>(
                `/api/v1/agents/${agentId}/runs?page=${page}&pageSize=${pageSize}`
            ),
    });

    const toggleRow = (runId: string) => {
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(runId)) {
                next.delete(runId);
            } else {
                next.add(runId);
            }
            return next;
        });
    };

    const runs = data?.runs ?? [];
    const totalPages = data?.totalPages ?? 1;

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="space-y-4">
                <Link
                    href={`/${tenantSlug}/dashboard/agents/${agentId}`}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to {isLoadingAgent ? "Agent" : (agent?.name ?? "Agent")}
                </Link>

                <div>
                    <h1 className="text-3xl font-bold tracking-tight">
                        Agent Runs
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Execution history and actions performed by this agent.
                    </p>
                </div>
            </div>

            {/* Error state */}
            {isError && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error Loading Runs</AlertTitle>
                    <AlertDescription>
                        {error instanceof Error
                            ? error.message
                            : "Failed to load agent runs. Please try again."}
                    </AlertDescription>
                </Alert>
            )}

            {/* Table */}
            {!isError && (
                <div className="space-y-4">
                    <div className="rounded-md border border-border overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="w-[110px]">
                                        Run ID
                                    </TableHead>
                                    <TableHead>Trigger</TableHead>
                                    <TableHead className="w-[160px]">
                                        Status
                                    </TableHead>
                                    <TableHead>Started At</TableHead>
                                    <TableHead>Completed At</TableHead>
                                    <TableHead className="w-[110px]">
                                        Duration
                                    </TableHead>
                                    <TableHead className="w-[40px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoadingRuns ? (
                                    Array.from({ length: 6 }).map((_, i) => (
                                        <TableRow key={i}>
                                            {Array.from({ length: 7 }).map(
                                                (_, j) => (
                                                    <TableCell key={j}>
                                                        <Skeleton className="h-4 w-full" />
                                                    </TableCell>
                                                )
                                            )}
                                        </TableRow>
                                    ))
                                ) : runs.length === 0 ? (
                                    <TableRow>
                                        <TableCell
                                            colSpan={7}
                                            className="h-32 text-center text-muted-foreground"
                                        >
                                            No runs found for this agent.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    runs.map((run: AgentRun) => {
                                        const isExpanded = expandedRows.has(
                                            run.id
                                        );
                                        const cfg =
                                            statusConfig[run.status];
                                        return (
                                            <React.Fragment key={run.id}>
                                                <TableRow
                                                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                                                    onClick={() =>
                                                        toggleRow(run.id)
                                                    }
                                                >
                                                    <TableCell className="font-mono text-xs font-medium">
                                                        {run.id.slice(0, 8)}
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {run.trigger}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge
                                                            variant="outline"
                                                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cfg?.color ?? ""}`}
                                                        >
                                                            {cfg?.icon}
                                                            {run.status.replace(
                                                                "_",
                                                                " "
                                                            )}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">
                                                        {formatDate(
                                                            run.startedAt
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">
                                                        {formatDate(
                                                            run.completedAt
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-xs font-medium">
                                                        <span className="inline-flex items-center gap-1.5">
                                                            <Clock className="h-3 w-3 text-muted-foreground" />
                                                            {formatDuration(
                                                                run.startedAt,
                                                                run.completedAt
                                                            )}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell>
                                                        {isExpanded ? (
                                                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                                        ) : (
                                                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                        )}
                                                    </TableCell>
                                                </TableRow>

                                                {/* Expanded detail row */}
                                                {isExpanded && (
                                                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                                                        <TableCell
                                                            colSpan={7}
                                                            className="py-6 px-6"
                                                        >
                                                            <div className="grid gap-8 md:grid-cols-3">
                                                                {/* Steps */}
                                                                <div className="space-y-3">
                                                                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                                                        Steps Completed
                                                                    </p>
                                                                    <p className="text-3xl font-bold font-mono leading-none">
                                                                        {
                                                                            run.stepsCompleted
                                                                                .length
                                                                        }
                                                                    </p>
                                                                    {run.stepsCompleted.length > 0 && (
                                                                        <ul className="space-y-1.5 pt-1">
                                                                            {run.stepsCompleted
                                                                                .slice(0, 4)
                                                                                .map(
                                                                                    (
                                                                                        step,
                                                                                        idx
                                                                                    ) => (
                                                                                        <li
                                                                                            key={idx}
                                                                                            className="flex items-center gap-2 text-xs"
                                                                                        >
                                                                                            <span className="h-1 w-1 rounded-full bg-primary shrink-0" />
                                                                                            <span className="text-muted-foreground truncate">
                                                                                                {
                                                                                                    step.toolName
                                                                                                }
                                                                                            </span>
                                                                                            <Badge
                                                                                                variant="secondary"
                                                                                                className="ml-auto text-[9px] h-4 px-1 py-0 uppercase shrink-0"
                                                                                            >
                                                                                                {
                                                                                                    step.status
                                                                                                }
                                                                                            </Badge>
                                                                                        </li>
                                                                                    )
                                                                                )}
                                                                            {run.stepsCompleted.length > 4 && (
                                                                                <li className="text-[10px] text-muted-foreground pl-3">
                                                                                    +{run.stepsCompleted.length - 4} more
                                                                                </li>
                                                                            )}
                                                                        </ul>
                                                                    )}
                                                                </div>

                                                                {/* Actions */}
                                                                <div className="space-y-3">
                                                                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                                                        Actions Taken
                                                                    </p>
                                                                    <p className="text-3xl font-bold font-mono leading-none">
                                                                        {
                                                                            run.actionsTaken
                                                                                .length
                                                                        }
                                                                    </p>
                                                                    {run.actionsTaken.length > 0 && (
                                                                        <ul className="space-y-1.5 pt-1">
                                                                            {run.actionsTaken
                                                                                .slice(0, 4)
                                                                                .map(
                                                                                    (
                                                                                        action,
                                                                                        idx
                                                                                    ) => (
                                                                                        <li
                                                                                            key={idx}
                                                                                            className="flex items-center gap-2 text-xs"
                                                                                        >
                                                                                            <span className="h-1 w-1 rounded-full bg-primary shrink-0" />
                                                                                            <span className="text-muted-foreground truncate">
                                                                                                {action.action}
                                                                                            </span>
                                                                                            <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                                                                                                {action.resource}
                                                                                            </span>
                                                                                        </li>
                                                                                    )
                                                                                )}
                                                                            {run.actionsTaken.length > 4 && (
                                                                                <li className="text-[10px] text-muted-foreground pl-3">
                                                                                    +{run.actionsTaken.length - 4} more
                                                                                </li>
                                                                            )}
                                                                        </ul>
                                                                    )}
                                                                </div>

                                                                {/* Human Approval */}
                                                                <div className="space-y-3">
                                                                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                                                        Human Approval
                                                                    </p>
                                                                    <div>
                                                                        {run.humanApproved ===
                                                                            true ? (
                                                                            <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/10 font-bold">
                                                                                Approved
                                                                            </Badge>
                                                                        ) : run.humanApproved ===
                                                                            false ? (
                                                                            <Badge
                                                                                variant="destructive"
                                                                                className="font-bold"
                                                                            >
                                                                                Rejected
                                                                            </Badge>
                                                                        ) : (
                                                                            <Badge
                                                                                variant="secondary"
                                                                                className="font-bold"
                                                                            >
                                                                                Not Required
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                                                        {run.humanApproved ===
                                                                            true
                                                                            ? "This run was reviewed and approved by an operator."
                                                                            : run.humanApproved ===
                                                                                false
                                                                                ? "This run was rejected during manual review."
                                                                                : "This run did not require human intervention."}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </React.Fragment>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between px-1">
                        <p className="text-xs text-muted-foreground">
                            Page{" "}
                            <span className="font-medium text-foreground">
                                {page}
                            </span>{" "}
                            of{" "}
                            <span className="font-medium text-foreground">
                                {totalPages}
                            </span>
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() =>
                                    setPage((p) => Math.max(1, p - 1))
                                }
                                disabled={page === 1 || isLoadingRuns}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                <span className="sr-only">Previous page</span>
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() =>
                                    setPage((p) =>
                                        Math.min(totalPages, p + 1)
                                    )
                                }
                                disabled={
                                    page >= totalPages || isLoadingRuns
                                }
                            >
                                <ChevronRight className="h-4 w-4" />
                                <span className="sr-only">Next page</span>
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
