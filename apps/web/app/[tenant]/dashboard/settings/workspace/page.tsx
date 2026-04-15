"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { signOut } from "@/lib/auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MembersList } from "@/components/platform/members/MembersList";
import { PermissionGate } from "@/components/platform/PermissionGate";

// ── Schemas ─────────────────────────────────────────────────────────────────

const workspaceSchema = z.object({
    name: z.string().min(3, "Name must be at least 3 characters").max(50),
    slug: z
        .string()
        .min(3, "Slug must be at least 3 characters")
        .max(50)
        .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
});

type WorkspaceFormValues = z.infer<typeof workspaceSchema>;

// ── Leave Workspace Modal ────────────────────────────────────────────────────

function LeaveWorkspaceModal({
    open,
    onOpenChange,
    workspaceName,
    tenantId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceName: string;
    tenantId: string;
}) {
    const leaveMutation = useMutation({
        mutationFn: () => api.del(`/api/v1/workspaces/${tenantId}/members/me`),
        onSuccess: async () => {
            toast.success("You have left the workspace");

            // Fetch remaining workspaces. /auth/tenants bypasses session validation
            // and queries by userId, so it still works with the current JWT even
            // after the membership is suspended.
            try {
                const tenantsRes = await api.get<{
                    tenants: { tenantId: string; slug: string; name: string }[];
                }>("/api/v1/auth/tenants");

                const remaining = (tenantsRes.tenants ?? []).filter(
                    (t) => t.tenantId !== tenantId
                );

                if (remaining.length > 0) {
                    const next = remaining[0];
                    // Refresh the JWT for the next workspace before navigating
                    await fetch("/api/auth/refresh", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tenantId: next.tenantId }),
                    });
                    window.location.href = `/${next.slug}/dashboard`;
                    return;
                }
            } catch {
                // Fall through — no workspaces reachable, clear session
            }

            await fetch("/api/auth/session", { method: "DELETE" });
            window.location.href = "/auth/login";
        },
        onError: (error: unknown) => {
            if (error instanceof ApiError) {
                const code = error.data?.code;
                if (code === "SOLE_OWNER_LEAVE_BLOCKED") {
                    toast.error("You are the sole owner. Transfer ownership or delete the workspace.");
                    onOpenChange(false);
                    return;
                }
            }
            toast.error("Failed to leave workspace. Please try again.");
        },
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Leave Workspace</DialogTitle>
                    <DialogDescription>
                        You will lose access to{" "}
                        <span className="font-semibold text-foreground">{workspaceName}</span> and
                        will need to be re-invited to rejoin.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={leaveMutation.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={() => leaveMutation.mutate()}
                        disabled={leaveMutation.isPending}
                    >
                        {leaveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Leave workspace
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Delete Workspace Modal ───────────────────────────────────────────────────

function DeleteWorkspaceModal({
    open,
    onOpenChange,
    workspaceName,
    tenantId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceName: string;
    tenantId: string;
}) {
    const [confirmName, setConfirmName] = useState("");

    const deleteMutation = useMutation({
        mutationFn: () => api.del(`/api/v1/workspaces/${tenantId}`),
        onSuccess: async () => {
            toast.success("Workspace deleted");
            await fetch("/api/auth/session", { method: "DELETE" });
            window.location.href = "/auth/login";
        },
        onError: () => {
            toast.error("Failed to delete workspace. Please try again.");
        },
    });

    const canConfirm = confirmName === workspaceName;

    const handleOpenChange = (v: boolean) => {
        if (!v) setConfirmName("");
        onOpenChange(v);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-destructive">Delete Workspace</DialogTitle>
                    <DialogDescription>
                        This action is permanent and cannot be undone. All workspace data —
                        members, agents, API keys, and webhooks — will be deleted.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        All workspace data will be permanently deleted.
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                            Type{" "}
                            <span className="font-mono font-semibold text-foreground">
                                {workspaceName}
                            </span>{" "}
                            to confirm:
                        </p>
                        <Input
                            value={confirmName}
                            onChange={(e) => setConfirmName(e.target.value)}
                            placeholder={workspaceName}
                            disabled={deleteMutation.isPending}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                        disabled={deleteMutation.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={() => deleteMutation.mutate()}
                        disabled={!canConfirm || deleteMutation.isPending}
                    >
                        {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete workspace
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WorkspaceSettingsPage() {
    const { tenantId, tenantSlug, role } = useTenant();
    const queryClient = useQueryClient();
    const router = useRouter();

    const isOwner = role === "owner";

    // The workspace name comes from context; slug from URL param
    // We need to fetch the actual tenant name from the API to pre-fill the form
    const [workspaceName, setWorkspaceName] = useState("");
    const [currentSlug, setCurrentSlug] = useState(tenantSlug || "");
    const [leaveModalOpen, setLeaveModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [isFetching, setIsFetching] = useState(true);

    useEffect(() => {
        api.get<{ workspace: { id: string; name: string; slug: string } }>(
            `/api/v1/workspaces/${tenantId}`
        )
            .then((res) => {
                setWorkspaceName(res.workspace.name);
                setCurrentSlug(res.workspace.slug);
                form.reset({ name: res.workspace.name, slug: res.workspace.slug });
            })
            .catch(() => {
                // Fallback: use tenantSlug as best guess for slug
                form.reset({ name: "", slug: tenantSlug || "" });
            })
            .finally(() => setIsFetching(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId]);

    const form = useForm<WorkspaceFormValues>({
        resolver: zodResolver(workspaceSchema),
        defaultValues: { name: "", slug: tenantSlug || "" },
    });

    const updateMutation = useMutation({
        mutationFn: (values: WorkspaceFormValues) =>
            api.patch<{ workspace: { id: string; name: string; slug: string } }>(
                `/api/v1/workspaces/${tenantId}`,
                values
            ),
        onSuccess: async (res) => {
            const newSlug = res.workspace.slug;
            const newName = res.workspace.name;
            setWorkspaceName(newName);
            setCurrentSlug(newSlug);
            queryClient.invalidateQueries({ queryKey: ["workspace", tenantId] });
            toast.success("Workspace updated");

            // If slug changed, refresh the JWT first so the new slug is baked into
            // the token before we navigate. Redirecting before this would leave the
            // browser with a stale tenantSlug claim until the next background refresh.
            if (newSlug !== tenantSlug) {
                const refreshRes = await fetch("/api/auth/refresh", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tenantId }),
                });

                if (!refreshRes.ok) {
                    toast.error("Workspace saved, but session refresh failed. Please log out and back in to update the URL.");
                    return;
                }

                window.location.href = `/${newSlug}/dashboard/settings/workspace`;
            }
        },
        onError: (error: unknown) => {
            if (error instanceof ApiError && error.data?.code === "SLUG_TAKEN") {
                form.setError("slug", { message: "This slug is already taken" });
                return;
            }
            toast.error("Failed to update workspace. Please try again.");
        },
    });

    // Sole-owner check: if role is "owner" we hide the Leave button.
    // The backend will still guard against it, but we never show the button for owners.
    const canLeave = !isOwner;

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Workspace Settings</h1>
                <p className="text-muted-foreground mt-1">
                    Manage settings for this workspace.
                </p>
            </div>

            {/* ── Workspace Details (owner only) ── */}
            {isOwner ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Building2 className="h-5 w-5" />
                            Workspace Details
                        </CardTitle>
                        <CardDescription>
                            Update the name and URL slug for this workspace.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isFetching ? (
                            <div className="space-y-4 max-w-md">
                                <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
                                <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
                            </div>
                        ) : (
                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit((d) => updateMutation.mutate(d))}
                                    className="space-y-4 max-w-md"
                                >
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Workspace Name</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        placeholder="My Workspace"
                                                        disabled={updateMutation.isPending}
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="slug"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Workspace Slug</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        placeholder="my-workspace"
                                                        disabled={updateMutation.isPending}
                                                        {...field}
                                                        onChange={(e) =>
                                                            field.onChange(
                                                                e.target.value
                                                                    .toLowerCase()
                                                                    .replace(/[^a-z0-9-]/g, "")
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    Used in your workspace URL. Changing this will
                                                    invalidate all existing links.
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="flex justify-end pt-2">
                                        <Button
                                            type="submit"
                                            disabled={updateMutation.isPending}
                                        >
                                            {updateMutation.isPending && (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            )}
                                            Save changes
                                        </Button>
                                    </div>
                                </form>
                            </Form>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Building2 className="h-5 w-5" />
                            Workspace Details
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center gap-4">
                                <span className="w-16 text-muted-foreground">Name</span>
                                <span className="font-medium">{workspaceName || "—"}</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="w-16 text-muted-foreground">Slug</span>
                                <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                                    {currentSlug || tenantSlug || "—"}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Members (view only) ── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        Members
                    </CardTitle>
                    <CardDescription>
                        Current members of this workspace. Manage members in full from the Members
                        page.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <PermissionGate resource="members" action="read" fallback={
                        <p className="text-sm text-muted-foreground">
                            You do not have permission to view members.
                        </p>
                    }>
                        <MembersList />
                    </PermissionGate>
                </CardContent>
            </Card>

            {/* ── Danger Zone ── */}
            <div className="rounded-lg border border-destructive/40 p-6 space-y-4">
                <div>
                    <h2 className="text-base font-semibold text-destructive">Danger Zone</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Irreversible and destructive actions.
                    </p>
                </div>

                {canLeave && (
                    <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3">
                        <div>
                            <p className="text-sm font-medium">Leave workspace</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Remove yourself from this workspace. You will lose access immediately.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setLeaveModalOpen(true)}
                        >
                            Leave workspace
                        </Button>
                    </div>
                )}

                {isOwner && (
                    <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3">
                        <div>
                            <p className="text-sm font-medium">Delete workspace</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Permanently delete this workspace and all its data.
                            </p>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteModalOpen(true)}
                        >
                            Delete workspace
                        </Button>
                    </div>
                )}
            </div>

            <LeaveWorkspaceModal
                open={leaveModalOpen}
                onOpenChange={setLeaveModalOpen}
                workspaceName={workspaceName}
                tenantId={tenantId}
            />
            <DeleteWorkspaceModal
                open={deleteModalOpen}
                onOpenChange={setDeleteModalOpen}
                workspaceName={workspaceName}
                tenantId={tenantId}
            />
        </div>
    );
}
