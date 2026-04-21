"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeft,
    AlertCircle,
    Users,
    Bot,
    MessageSquare,
    Zap,
    CircleAlert,
    RotateCcw,
    Badge as BadgeIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { StatusBadge } from "@/components/platform/shared";
import { Button } from "@/components/ui/button";
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
import type { OpsTenantDetailResponse } from "@/components/platform/ops/types";

export default function TenantDetailPage() {
    const params = useParams();
    const router = useRouter();
    const tenantSlug = params.tenant as string;
    const targetTenantId = params.tenantId as string;
    const { role } = useTenant();
    const queryClient = useQueryClient();

    React.useEffect(() => {
        if (role !== "platform_admin") {
            router.replace(`/${tenantSlug}/dashboard`);
        }
    }, [role, router, tenantSlug]);

    const queryKey = ["ops-tenant-detail", targetTenantId] as const;

    const { data, isLoading, isError } = useQuery<OpsTenantDetailResponse>({
        queryKey,
        queryFn: () => api.get<OpsTenantDetailResponse>(`/api/v1/ops/tenants/${targetTenantId}`),
        enabled: role === "platform_admin",
    });

    const updateStatusMutation = useMutation({
        mutationFn: (status: string) =>
            api.patch(`/api/v1/ops/tenants/${targetTenantId}`, { status }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
            toast.success("Tenant status updated");
        },
        onError: () => toast.error("Failed to update tenant status"),
    });

    if (role !== "platform_admin") return null;

    const formatDate = (iso: string | null) => {
        if (!iso) return "—";
        return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
    };

    const renderOverrideValue = (o: OpsTenantDetailResponse["overrides"][number]) => {
        if (o.unlimited) return "unlimited";
        if (o.valueLimit !== null) return `limit: ${o.valueLimit}`;
        if (o.enabled !== null) return `enabled: ${String(o.enabled)}`;
        return "—";
    };

    const tenant = data?.tenant;
    const members = data?.members ?? [];
    const stats = data?.stats;
    const overrides = data?.overrides ?? [];

    return (
        <div className="space-y-8">
            {/* Back nav */}
            <Button
                variant="ghost"
                size="sm"
                className="text-zinc-400 hover:text-zinc-100 -ml-2"
                onClick={() => router.push(`/${tenantSlug}/dashboard/ops/tenants`)}
            >
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                All Tenants
            </Button>

            {isError && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>Failed to load tenant details.</AlertDescription>
                </Alert>
            )}

            {/* Header */}
            {isLoading ? (
                <div className="space-y-3">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-5 w-40" />
                </div>
            ) : tenant && (
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="text-3xl font-bold tracking-tight text-zinc-50">{tenant.name}</h1>
                            <StatusBadge status={tenant.status} />
                            <StatusBadge status={tenant.type} />
                        </div>
                        <div className="flex items-center gap-4 text-sm text-zinc-500">
                            <span className="font-mono">{tenant.slug}</span>
                            <span>·</span>
                            <span>Plan: <span className="text-zinc-300 font-medium">{tenant.plan}</span></span>
                            <span>·</span>
                            <span>Created {formatDate(tenant.createdAt)}</span>
                        </div>
                    </div>

                    {tenant.status !== "deleted" && (
                        tenant.status === "active" ? (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10">
                                        <CircleAlert className="mr-1.5 h-4 w-4" />
                                        Suspend
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Suspend Tenant?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This will disable access for all users in <strong>{tenant.name}</strong>.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={() => updateStatusMutation.mutate("suspended")}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                            Suspend
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        ) : (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <RotateCcw className="mr-1.5 h-4 w-4" />
                                        Reactivate
                                    </Button>
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
                                        <AlertDialogAction onClick={() => updateStatusMutation.mutate("active")}>
                                            Reactivate
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )
                    )}
                </div>
            )}

            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { icon: Users, label: "Members", value: stats?.memberCount ?? 0, loading: isLoading },
                    { icon: Bot, label: "Active Agents", value: stats?.activeAgents ?? 0, loading: isLoading },
                    { icon: MessageSquare, label: "Conversations", value: stats?.totalConversations ?? 0, loading: isLoading },
                    { icon: Zap, label: "Overrides", value: overrides.filter(o => o.status === "active").length, loading: isLoading },
                ].map(({ icon: Icon, label, value, loading }) => (
                    <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-zinc-500 font-medium">{label}</p>
                            <Icon className="h-4 w-4 text-zinc-600" />
                        </div>
                        {loading ? (
                            <Skeleton className="h-8 w-16" />
                        ) : (
                            <p className="text-3xl font-bold tracking-tight text-zinc-50">{value.toLocaleString()}</p>
                        )}
                    </div>
                ))}
            </div>

            {/* Members table */}
            <section className="space-y-3">
                <h2 className="text-lg font-semibold text-zinc-100">Members</h2>
                <div className="border border-zinc-800 rounded-xl bg-zinc-900 overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-zinc-800 hover:bg-transparent">
                                <TableHead className="text-zinc-400">Name</TableHead>
                                <TableHead className="text-zinc-400">Email</TableHead>
                                <TableHead className="text-zinc-400">Role</TableHead>
                                <TableHead className="text-zinc-400">Type</TableHead>
                                <TableHead className="text-zinc-400">Status</TableHead>
                                <TableHead className="text-zinc-400">Joined</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading
                                ? Array.from({ length: 4 }).map((_, i) => (
                                    <TableRow key={i} className="border-zinc-800">
                                        {Array.from({ length: 6 }).map((_, j) => (
                                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                                        ))}
                                    </TableRow>
                                ))
                                : members.length === 0
                                    ? (
                                        <TableRow className="border-zinc-800">
                                            <TableCell colSpan={6} className="py-12 text-center text-zinc-600">
                                                No members found
                                            </TableCell>
                                        </TableRow>
                                    )
                                    : members.map((m) => (
                                        <TableRow key={m.membershipId} className="border-zinc-800 hover:bg-zinc-800/40">
                                            <TableCell className="font-medium text-zinc-200">
                                                {m.userName ?? <span className="text-zinc-600 italic">—</span>}
                                            </TableCell>
                                            <TableCell className="text-zinc-400 text-sm">
                                                {m.userEmail ?? <span className="text-zinc-600 italic">agent</span>}
                                            </TableCell>
                                            <TableCell>
                                                {m.roleName
                                                    ? <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider border-zinc-700 text-zinc-400">{m.roleName}</Badge>
                                                    : <span className="text-zinc-600">—</span>}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={m.memberType === "agent"
                                                    ? "text-[10px] border-violet-500/30 text-violet-400"
                                                    : "text-[10px] border-zinc-700 text-zinc-400"}>
                                                    {m.memberType}
                                                </Badge>
                                            </TableCell>
                                            <TableCell><StatusBadge status={m.status} /></TableCell>
                                            <TableCell className="text-zinc-500 text-sm">{formatDate(m.joinedAt)}</TableCell>
                                        </TableRow>
                                    ))}
                        </TableBody>
                    </Table>
                </div>
            </section>

            {/* Feature overrides table */}
            <section className="space-y-3">
                <h2 className="text-lg font-semibold text-zinc-100">Feature Overrides</h2>
                <div className="border border-zinc-800 rounded-xl bg-zinc-900 overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-zinc-800 hover:bg-transparent">
                                <TableHead className="text-zinc-400">Feature</TableHead>
                                <TableHead className="text-zinc-400">Value</TableHead>
                                <TableHead className="text-zinc-400">Reason</TableHead>
                                <TableHead className="text-zinc-400">Expires</TableHead>
                                <TableHead className="text-zinc-400">Status</TableHead>
                                <TableHead className="text-zinc-400">Granted</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading
                                ? Array.from({ length: 3 }).map((_, i) => (
                                    <TableRow key={i} className="border-zinc-800">
                                        {Array.from({ length: 6 }).map((_, j) => (
                                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                                        ))}
                                    </TableRow>
                                ))
                                : overrides.length === 0
                                    ? (
                                        <TableRow className="border-zinc-800">
                                            <TableCell colSpan={6} className="py-12 text-center text-zinc-600">
                                                No overrides for this tenant
                                            </TableCell>
                                        </TableRow>
                                    )
                                    : overrides.map((o) => (
                                        <TableRow key={o.id} className="border-zinc-800 hover:bg-zinc-800/40">
                                            <TableCell>
                                                <div>
                                                    <p className="text-zinc-200 text-sm font-medium">{o.featureName}</p>
                                                    <p className="text-zinc-600 text-[10px] font-mono uppercase tracking-wider">{o.featureKey}</p>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-mono text-xs text-zinc-400">{renderOverrideValue(o)}</TableCell>
                                            <TableCell className="text-zinc-400 text-sm max-w-[200px] truncate">{o.reason ?? "—"}</TableCell>
                                            <TableCell className="text-zinc-500 text-sm">{formatDate(o.expiresAt)}</TableCell>
                                            <TableCell><StatusBadge status={o.status} /></TableCell>
                                            <TableCell className="text-zinc-500 text-sm">{formatDate(o.createdAt)}</TableCell>
                                        </TableRow>
                                    ))}
                        </TableBody>
                    </Table>
                </div>
            </section>
        </div>
    );
}
