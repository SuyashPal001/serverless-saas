"use client";

import { useState, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Copy, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// --- Types ---

interface AuditEntry {
    id: string;
    tenantId: string;
    actorId: string;
    actorType: "human" | "agent" | "system";
    action: string;
    resource: string;
    resourceId: string | null;
    metadata: Record<string, unknown> | null;
    ipAddress: string | null;
    traceId: string;
    createdAt: string;
}

interface AuditLogResponse {
    data: {
        entries: AuditEntry[];
        total: number;
        page: number;
        pageSize: number;
    };
}

// --- Helpers ---

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

const truncate = (str: string | null, length: number = 8) => {
    if (!str) return "—";
    if (str.length <= length) return str;
    return `${str.slice(0, length)}...`;
};

// --- Components ---

export function AuditLogView() {
    const { tenantId } = useTenant();
    const [page, setPage] = useState(1);
    const [actorTypeFilter, setActorTypeFilter] = useState<string>("all");
    const [actionFilter, setActionFilter] = useState("");
    const [debouncedAction, setDebouncedAction] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");

    // Debounce action filter
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedAction(actionFilter);
            setPage(1); // Reset page on filter change
        }, 300);
        return () => clearTimeout(timer);
    }, [actionFilter]);

    const { data, isLoading, isError } = useQuery<AuditLogResponse>({
        queryKey: ['audit-log', tenantId, page, actorTypeFilter, debouncedAction, dateFrom, dateTo],
        queryFn: () => {
            const searchParams = new URLSearchParams();
            searchParams.set("page", String(page));
            searchParams.set("pageSize", "20");
            if (actorTypeFilter && actorTypeFilter !== "all") {
                searchParams.set("actorType", actorTypeFilter);
            }
            if (debouncedAction) {
                searchParams.set("action", debouncedAction);
            }
            if (dateFrom) {
                searchParams.set("dateFrom", dateFrom);
            }
            if (dateTo) {
                searchParams.set("dateTo", dateTo);
            }
            return api.get<AuditLogResponse>(`/api/v1/audit-log?${searchParams.toString()}`);
        },
        placeholderData: keepPreviousData,
    });

    const entries = data?.data?.entries || [];
    const total = data?.data?.total || 0;
    const pageSize = data?.data?.pageSize || 20;
    const totalPages = Math.ceil(total / pageSize);

    const handleClearFilters = () => {
        setActorTypeFilter("all");
        setActionFilter("");
        setDateFrom("");
        setDateTo("");
        setPage(1);
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("Trace ID copied to clipboard");
    };

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>Failed to load audit log.</AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-4 bg-muted/20 p-4 rounded-lg border border-border">
                <div className="w-[180px]">
                    <Select value={actorTypeFilter} onValueChange={(val) => { setActorTypeFilter(val); setPage(1); }}>
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

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter by action..."
                        className="pl-9"
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <Input
                        type="date"
                        className="w-[150px]"
                        value={dateFrom}
                        onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                    />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input
                        type="date"
                        className="w-[150px]"
                        value={dateTo}
                        onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                    />
                </div>

                <Button variant="ghost" size="sm" onClick={handleClearFilters} className="text-muted-foreground">
                    <X className="h-4 w-4 mr-2" />
                    Clear filters
                </Button>
            </div>

            {/* Table */}
            <div className="rounded-md border border-border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Time</TableHead>
                            <TableHead>Actor</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Resource</TableHead>
                            <TableHead>IP Address</TableHead>
                            <TableHead>Trace ID</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading && entries.length === 0 ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    {Array.from({ length: 6 }).map((_, j) => (
                                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : entries.length > 0 ? (
                            entries.map((entry) => (
                                <TableRow key={entry.id} className="hover:bg-muted/50 transition-colors">
                                    <TableCell>
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger className="text-sm">
                                                    {formatRelativeTime(entry.createdAt)}
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    {new Date(entry.createdAt).toLocaleString()}
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Badge 
                                                variant="secondary"
                                                className={cn(
                                                    "text-[10px] font-bold uppercase tracking-wider",
                                                    entry.actorType === "human" && "bg-blue-500/10 text-blue-500",
                                                    entry.actorType === "agent" && "bg-purple-500/10 text-purple-500",
                                                    entry.actorType === "system" && "bg-gray-500/10 text-gray-500"
                                                )}
                                            >
                                                {entry.actorType}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {truncate(entry.actorId)}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs font-medium">
                                        {entry.action}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium">{entry.resource}</span>
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                                {truncate(entry.resourceId)}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {entry.ipAddress || "—"}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {truncate(entry.traceId, 8)}
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => copyToClipboard(entry.traceId)}
                                            >
                                                <Copy className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} className="h-32 text-center">
                                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                                        {actionFilter || actorTypeFilter !== "all" || dateFrom || dateTo ? (
                                            <p>No audit entries found</p>
                                        ) : (
                                            <p>No audit activity yet</p>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-2">
                    <p className="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1 || isLoading}
                        >
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages || isLoading}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
