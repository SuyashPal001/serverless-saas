"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Search,
    AlertCircle,
    Users,
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    CircleAlert,
    RotateCcw
} from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { StatusBadge } from "@/components/platform/shared";
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
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { OpsTenantsResponse, OpsTenant } from "@/components/platform/ops/types";

const PAGE_SIZE = 20;

export default function TenantsListPage() {
    const params = useParams();
    const router = useRouter();
    const tenantSlug = params.tenant as string;
    const { role } = useTenant();
    const queryClient = useQueryClient();

    // Role Gate
    React.useEffect(() => {
        if (role !== "platform_admin") {
            router.replace(`/${tenantSlug}/dashboard`);
        }
    }, [role, router, tenantSlug]);

    const [search, setSearch] = React.useState("");
    const [debouncedSearch, setDebouncedSearch] = React.useState("");
    const [status, setStatus] = React.useState("all");
    const [page, setPage] = React.useState(1);

    // Debounce search
    React.useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const queryKey = ["ops-tenants", tenantSlug, debouncedSearch, status, page] as const;

    const { data, isLoading, isError } = useQuery<OpsTenantsResponse>({
        queryKey,
        queryFn: () => {
            let url = `/api/v1/ops/tenants?page=${page}&pageSize=${PAGE_SIZE}`;
            if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;
            if (status !== "all") url += `&status=${status}`;
            return api.get<OpsTenantsResponse>(url);
        },
        enabled: role === "platform_admin",
    });

    const updateStatusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: string }) =>
            api.patch(`/api/v1/ops/tenants/${id}`, { status }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
            toast.success("Tenant status updated successfully");
        },
        onError: (error) => {
            toast.error("Failed to update tenant status");
            console.error(error);
        },
    });

    if (role !== "platform_admin") {
        return null;
    }

    const tenants = data?.tenants ?? [];
    const totalPages = data?.totalPages ?? 1;

    const formatDate = (iso: string) => {
        return new Intl.DateTimeFormat("en-US", {
            dateStyle: "short",
        }).format(new Date(iso));
    };


    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
                <p className="text-muted-foreground mt-1">
                    Manage all tenants across the platform.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-4 p-4 border rounded-lg bg-card">
                <div className="relative flex-1 min-w-[300px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name or slug..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="w-full sm:w-48">
                    <Select value={status} onValueChange={(val) => { setStatus(val); setPage(1); }}>
                        <SelectTrigger>
                            <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="suspended">Suspended</SelectItem>
                            <SelectItem value="deleted">Deleted</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {isError && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>Failed to load tenants list.</AlertDescription>
                </Alert>
            )}

            {!isLoading && !isError && tenants.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground border rounded-lg bg-card">
                    <Users className="h-10 w-10 opacity-40" />
                    <p className="text-base font-medium">No tenants found.</p>
                </div>
            )}

            {(isLoading || tenants.length > 0) && (
                <div className="border rounded-lg bg-card overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Slug</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Plan</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="w-[70px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading
                                ? Array.from({ length: 8 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 7 }).map((_, j) => (
                                            <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                                        ))}
                                    </TableRow>
                                ))
                                : tenants.map((tenant) => (
                                    <TableRow key={tenant.id} className="cursor-pointer hover:bg-zinc-800/40" onClick={() => router.push(`/${tenantSlug}/dashboard/ops/tenants/${tenant.id}`)}>
                                        <TableCell className="font-medium">{tenant.name}</TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{tenant.slug}</TableCell>
                                        <TableCell><StatusBadge status={tenant.type} /></TableCell>
                                        <TableCell><StatusBadge status={tenant.status} /></TableCell>
                                        <TableCell>{tenant.plan}</TableCell>
                                        <TableCell>{formatDate(tenant.createdAt)}</TableCell>
                                        <TableCell>
                                            {tenant.status !== "deleted" && (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        {tenant.status === "active" ? (
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                                                        <CircleAlert className="mr-2 h-4 w-4" />
                                                                        Suspend
                                                                    </DropdownMenuItem>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Suspend Tenant?</AlertDialogTitle>
                                                                        <AlertDialogDescription>
                                                                            This will temporarily disable access for all users in <strong>{tenant.name}</strong>.
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                        <AlertDialogAction
                                                                            onClick={() => updateStatusMutation.mutate({ id: tenant.id, status: "suspended" })}
                                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                                        >
                                                                            Suspend
                                                                        </AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        ) : tenant.status === "suspended" ? (
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                                                        <RotateCcw className="mr-2 h-4 w-4" />
                                                                        Reactivate
                                                                    </DropdownMenuItem>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Reactivate Tenant?</AlertDialogTitle>
                                                                        <AlertDialogDescription>
                                                                            This will restore access for all users in <strong>{tenant.name}</strong>.
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                        <AlertDialogAction
                                                                            onClick={() => updateStatusMutation.mutate({ id: tenant.id, status: "active" })}
                                                                        >
                                                                            Reactivate
                                                                        </AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        ) : null}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {!isLoading && !isError && tenants.length > 0 && (
                <div className="flex items-center justify-between px-1">
                    <p className="text-sm text-muted-foreground">
                        Page <span className="font-medium text-foreground">{page}</span> of <span className="font-medium text-foreground">{totalPages}</span>
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
