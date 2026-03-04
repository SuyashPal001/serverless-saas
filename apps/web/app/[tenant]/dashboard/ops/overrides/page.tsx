"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
    Plus,
    AlertCircle,
    Settings2,
    ChevronLeft,
    ChevronRight,
    Trash2
} from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
// Native checkbox fallback as @/components/ui/checkbox is missing
// import { Checkbox } from "@/components/ui/checkbox";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
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
import type { OpsOverridesResponse, OpsOverride } from "@/components/platform/ops/types";

const PAGE_SIZE = 20;

const overrideSchema = z.object({
    tenantId: z.string().min(1, "Tenant ID is required"),
    featureId: z.string().min(1, "Feature ID is required"),
    enabled: z.boolean().optional(),
    valueLimit: z.number().optional(),
    unlimited: z.boolean().optional(),
    reason: z.string().min(1, "Reason is required"),
    expiresAt: z.string().optional(),
});

type OverrideFormValues = z.infer<typeof overrideSchema>;

export default function FeatureOverridesPage() {
    const params = useParams();
    const router = useRouter();
    const tenantSlug = params.tenant as string;
    const { role } = useTenant();
    const queryClient = useQueryClient();
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);

    // Role Gate
    React.useEffect(() => {
        if (role !== "platform_admin") {
            router.replace(`/${tenantSlug}/dashboard`);
        }
    }, [role, router, tenantSlug]);

    const [page, setPage] = React.useState(1);

    const queryKey = ["ops-overrides", tenantSlug, page] as const;

    const { data, isLoading, isError } = useQuery<OpsOverridesResponse>({
        queryKey,
        queryFn: () => api.get<OpsOverridesResponse>(`/api/v1/ops/overrides?page=${page}&pageSize=${PAGE_SIZE}`),
        enabled: role === "platform_admin",
    });

    const form = useForm<OverrideFormValues>({
        resolver: zodResolver(overrideSchema),
        defaultValues: {
            tenantId: "",
            featureId: "",
            enabled: false,
            valueLimit: 0,
            unlimited: false,
            reason: "",
            expiresAt: "",
        },
    });

    const createMutation = useMutation({
        mutationFn: (values: OverrideFormValues) => api.post("/api/v1/ops/overrides", values),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
            toast.success("Feature override granted successfully");
            setIsDialogOpen(false);
            form.reset();
        },
        onError: (error) => {
            toast.error("Failed to grant feature override");
            console.error(error);
        },
    });

    const revokeMutation = useMutation({
        mutationFn: (id: string) => api.post(`/api/v1/ops/overrides/${id}/revoke`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
            toast.success("Feature override revoked successfully");
        },
        onError: (error) => {
            toast.error("Failed to revoke feature override");
            console.error(error);
        },
    });

    if (role !== "platform_admin") {
        return null;
    }

    const overrides = data?.overrides ?? [];
    const totalPages = data?.totalPages ?? 1;

    const formatDate = (iso: string | null) => {
        if (!iso) return "Never";
        return new Intl.DateTimeFormat("en-US", {
            dateStyle: "short",
        }).format(new Date(iso));
    };

    const getStatusBadge = (status: OpsOverride["status"]) => {
        switch (status) {
            case "active":
                return <Badge variant="secondary" className="bg-green-100 text-green-700">active</Badge>;
            case "expired":
                return <Badge variant="secondary" className="bg-gray-100 text-gray-700">expired</Badge>;
            case "revoked":
                return <Badge variant="secondary" className="bg-red-100 text-red-700">revoked</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    const renderValue = (override: OpsOverride) => {
        if (override.unlimited) return "unlimited: true";
        if (override.valueLimit !== null) return `limit: ${override.valueLimit}`;
        if (override.enabled !== null) return `enabled: ${override.enabled}`;
        return "—";
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Feature Overrides</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage per-tenant feature flags and limits.
                    </p>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Grant Override
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Grant Feature Override</DialogTitle>
                            <DialogDescription>
                                Apply a specific value or limit to a feature for a single tenant.
                            </DialogDescription>
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="tenantId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Tenant ID</FormLabel>
                                            <FormControl>
                                                <Input placeholder="tenant_..." {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="featureId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Feature ID</FormLabel>
                                            <FormControl>
                                                <Input placeholder="usage.limit..." {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="enabled"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                                                <FormControl>
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                        checked={field.value ?? false}
                                                        onChange={(e) => field.onChange(e.target.checked)}
                                                    />
                                                </FormControl>
                                                <div className="space-y-1 leading-none">
                                                    <FormLabel>Enabled</FormLabel>
                                                </div>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="unlimited"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                                                <FormControl>
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                        checked={field.value ?? false}
                                                        onChange={(e) => field.onChange(e.target.checked)}
                                                    />
                                                </FormControl>
                                                <div className="space-y-1 leading-none">
                                                    <FormLabel>Unlimited</FormLabel>
                                                </div>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <FormField
                                    control={form.control}
                                    name="valueLimit"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Value Limit</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    {...field}
                                                    value={field.value ?? ""}
                                                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="reason"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Reason</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Why is this being granted?" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="expiresAt"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Expires At (Optional)</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="datetime-local"
                                                    {...field}
                                                    value={field.value ?? ""}
                                                    onChange={(e) => field.onChange(e.target.value || undefined)}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <div className="flex justify-end gap-3 pt-4">
                                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                                    <Button type="submit" disabled={createMutation.isPending}>
                                        {createMutation.isPending ? "Granting..." : "Grant Override"}
                                    </Button>
                                </div>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>
            </div>

            {isError && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>Failed to load feature overrides.</AlertDescription>
                </Alert>
            )}

            {!isLoading && !isError && overrides.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground border rounded-lg bg-card">
                    <Settings2 className="h-10 w-10 opacity-40" />
                    <p className="text-base font-medium">No overrides found.</p>
                </div>
            )}

            {(isLoading || overrides.length > 0) && (
                <div className="border rounded-lg bg-card overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Tenant</TableHead>
                                <TableHead>Feature</TableHead>
                                <TableHead>Value</TableHead>
                                <TableHead>Reason</TableHead>
                                <TableHead>Granted By</TableHead>
                                <TableHead>Expires</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-[70px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading
                                ? Array.from({ length: 8 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 8 }).map((_, j) => (
                                            <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                                        ))}
                                    </TableRow>
                                ))
                                : overrides.map((override) => (
                                    <TableRow key={override.id}>
                                        <TableCell>{override.tenantName}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
                                                {override.featureKey}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{renderValue(override)}</TableCell>
                                        <TableCell className="max-w-[200px] truncate">{override.reason}</TableCell>
                                        <TableCell className="font-mono text-xs">{override.grantedBy.substring(0, 8)}</TableCell>
                                        <TableCell>{formatDate(override.expiresAt)}</TableCell>
                                        <TableCell>{getStatusBadge(override.status)}</TableCell>
                                        <TableCell>
                                            {override.status === "active" && (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Revoke Override?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                This will immediately remove the custom setting for this tenant and revert to their plan defaults.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                onClick={() => revokeMutation.mutate(override.id)}
                                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                            >
                                                                Revoke
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {!isLoading && !isError && overrides.length > 0 && (
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
