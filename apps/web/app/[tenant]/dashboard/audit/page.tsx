"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, AlertCircle, Inbox, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { AuditLogResponse } from "@/components/platform/audit/types";

const PAGE_SIZE = 20;

export default function AuditLogPage() {
    const params = useParams();
    const tenantSlug = params.tenant as string;
    const { permissions } = useTenant();

    const [actorType, setActorType] = React.useState<string>("all");
    const [from, setFrom] = React.useState<string>("");
    const [to, setTo] = React.useState<string>("");
    const [page, setPage] = React.useState(1);

    const hasPermission = can(permissions, "audit", "read");

    const queryKey = ["audit-log", tenantSlug, actorType, from, to, page] as const;

    const { data, isLoading, isError } = useQuery<AuditLogResponse>({
        queryKey,
        queryFn: () => {
            let url = `/api/v1/audit?page=${page}&pageSize=${PAGE_SIZE}`;
            if (actorType !== "all") url += `&actorType=${actorType}`;
            if (from) url += `&from=${from}`;
            if (to) url += `&to=${to}`;
            return api.get<AuditLogResponse>(url);
        },
        enabled: hasPermission,
    });

    const handleFilterChange = (updater: () => void) => {
        updater();
        setPage(1);
    };

    if (!hasPermission) {
        return (
            <div className="flex items-center justify-center py-24">
                <Alert variant="destructive" className="max-w-md">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>No Permission</AlertTitle>
                    <AlertDescription>
                        You don&apos;t have permission to view the audit log.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const logs = data?.logs ?? [];
    const totalPages = data?.totalPages ?? 1;

    const formatDate = (iso: string) => {
        return new Intl.DateTimeFormat("en-US", {
            dateStyle: "short",
            timeStyle: "short",
        }).format(new Date(iso));
    };

    const getActorTypeBadge = (type: string) => {
        switch (type) {
            case "human":
                return <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100">human</Badge>;
            case "agent":
                return <Badge variant="secondary" className="bg-purple-100 text-purple-700 hover:bg-purple-100">agent</Badge>;
            case "system":
                return <Badge variant="secondary" className="bg-gray-100 text-gray-700 hover:bg-gray-100">system</Badge>;
            default:
                return <Badge variant="outline">{type}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
                <p className="text-muted-foreground mt-1">
                    Track activity and changes across your workspace.
                </p>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-4 p-4 border rounded-lg bg-card">
                <div className="w-full sm:w-48">
                    <Select
                        value={actorType}
                        onValueChange={(val) => handleFilterChange(() => setActorType(val))}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Actor Type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Actors</SelectItem>
                            <SelectItem value="human">Human</SelectItem>
                            <SelectItem value="agent">Agent</SelectItem>
                            <SelectItem value="system">System</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">From:</span>
                    <Input
                        type="date"
                        className="w-40"
                        value={from}
                        onChange={(e) => handleFilterChange(() => setFrom(e.target.value))}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">To:</span>
                    <Input
                        type="date"
                        className="w-40"
                        value={to}
                        onChange={(e) => handleFilterChange(() => setTo(e.target.value))}
                    />
                </div>
            </div>

            {/* Content states */}
            {isError && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>Failed to load audit log.</AlertDescription>
                </Alert>
            )}

            {!isLoading && !isError && logs.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground border rounded-lg bg-card">
                    <Inbox className="h-10 w-10 opacity-40" />
                    <p className="text-base font-medium">No audit log entries found.</p>
                </div>
            )}

            {/* Table */}
            {(isLoading || logs.length > 0) && (
                <div className="border rounded-lg bg-card overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Actor</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Action</TableHead>
                                <TableHead>Resource</TableHead>
                                <TableHead>Resource ID</TableHead>
                                <TableHead>IP Address</TableHead>
                                <TableHead>Time</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading
                                ? Array.from({ length: 8 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 7 }).map((_, j) => (
                                            <TableCell key={j}>
                                                <Skeleton className="h-4 w-full" />
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))
                                : logs.map((log) => (
                                    <TableRow key={log.id}>
                                        <TableCell className="font-mono text-xs">
                                            {log.actorId.substring(0, 8)}
                                        </TableCell>
                                        <TableCell>
                                            {getActorTypeBadge(log.actorType)}
                                        </TableCell>
                                        <TableCell className="max-w-[150px] truncate">
                                            {log.action}
                                        </TableCell>
                                        <TableCell>
                                            {log.resource}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {log.resourceId ? log.resourceId.substring(0, 8) : "—"}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {log.ipAddress ?? "—"}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {formatDate(log.createdAt)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Pagination */}
            {!isLoading && !isError && logs.length > 0 && (
                <div className="flex items-center justify-between px-1">
                    <p className="text-xs text-muted-foreground">
                        Page{" "}
                        <span className="font-medium text-foreground">{page}</span>{" "}
                        of{" "}
                        <span className="font-medium text-foreground">
                            {totalPages}
                        </span>
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                        >
                            <ChevronLeft className="mr-1 h-4 w-4" />
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                        >
                            Next
                            <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
