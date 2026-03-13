"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, AlertCircle, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuditLogResponse } from "@/components/platform/audit/types";

function formatRelativeTime(dateStr: string): string {
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const diffMs = new Date(dateStr).getTime() - Date.now();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.round(diffMs / (1000 * 60));

    if (Math.abs(diffDays) > 0) return rtf.format(diffDays, "day");
    if (Math.abs(diffHours) > 0) return rtf.format(diffHours, "hour");
    if (Math.abs(diffMinutes) > 0) return rtf.format(diffMinutes, "minute");
    return "just now";
}

function truncateId(id: string | null): string {
    if (!id) return "N/A";
    if (id.length <= 8) return id;
    return `${id.slice(0, 8)}...`;
}

export default function AuditLogPage() {
    const { tenantId, permissions = [] } = useTenant();
    const [search, setSearch] = React.useState("");

    const canRead = can(permissions, "audit_log", "read");

    const { data, isLoading, isError, error } = useQuery<AuditLogResponse>({
        queryKey: ["audit-logs", tenantId],
        queryFn: () => api.get<AuditLogResponse>("/api/v1/audit-log"),
        enabled: canRead,
    });

    if (!canRead) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Alert variant="destructive" className="max-w-md">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Access Denied</AlertTitle>
                    <AlertDescription>
                        You do not have permission to view the audit logs.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const filteredLogs = React.useMemo(() => {
        if (!data?.logs) return [];
        if (!search) return data.logs;

        const term = search.toLowerCase();
        return data.logs.filter(
            (log) =>
                log.action.toLowerCase().includes(term) ||
                log.resource.toLowerCase().includes(term)
        );
    }, [data?.logs, search]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
                <p className="text-muted-foreground mt-1">
                    A record of all significant actions taken within this tenant.
                </p>
            </div>

            <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter by action or resource..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
            </div>

            {isError ? (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                        {error instanceof Error ? error.message : "Failed to load audit logs."}
                    </AlertDescription>
                </Alert>
            ) : (
                <div className="rounded-md border border-border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Actor</TableHead>
                                <TableHead>Action</TableHead>
                                <TableHead>Resource</TableHead>
                                <TableHead>Resource ID</TableHead>
                                <TableHead>IP Address</TableHead>
                                <TableHead>Date</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                    </TableRow>
                                ))
                            ) : filteredLogs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                                        No audit entries found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredLogs.map((log) => (
                                    <TableRow key={log.id}>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <Badge variant="outline" className="w-fit text-[10px] uppercase font-bold tracking-wider">
                                                    {log.actorType}
                                                </Badge>
                                                <span className="text-xs text-muted-foreground font-mono">
                                                    {truncateId(log.actorId)}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono font-medium">
                                                {log.action}
                                            </code>
                                        </TableCell>
                                        <TableCell>
                                            <code className="text-xs font-mono">
                                                {log.resource}
                                            </code>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {truncateId(log.resourceId)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-xs font-mono">
                                                {log.ipAddress || "N/A"}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger className="flex items-center gap-1.5 text-xs">
                                                        <Clock className="h-3 w-3 text-muted-foreground" />
                                                        {formatRelativeTime(log.createdAt)}
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>{new Date(log.createdAt).toLocaleString()}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
