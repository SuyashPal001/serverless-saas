"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, LockKeyhole, User } from "lucide-react";
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
    CardFooter,
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
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageUpload } from "@/components/platform/ImageUpload";

// ── Schemas ─────────────────────────────────────────────────────────────────

const profileSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    avatarUrl: z.string().url("Must be a valid URL").or(z.string().length(0)).optional().nullable(),
});

const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(8, "New password must be at least 8 characters"),
        confirmPassword: z.string().min(1, "Please confirm your new password"),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    });

type ProfileFormValues = z.infer<typeof profileSchema>;
type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

interface UserProfile {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
}

// ── Delete Account Modal ─────────────────────────────────────────────────────

interface BlockerWorkspace {
    id: string;
    name: string;
    slug: string;
}

function DeleteAccountModal({
    open,
    onOpenChange,
    userEmail,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userEmail: string;
}) {
    const params = useParams<{ tenant: string }>();
    const [confirmEmail, setConfirmEmail] = useState("");
    const [blockerWorkspaces, setBlockerWorkspaces] = useState<BlockerWorkspace[]>([]);
    const [showBlocker, setShowBlocker] = useState(false);

    const deleteMutation = useMutation({
        mutationFn: () => api.del("/api/v1/auth/account"),
        onSuccess: async () => {
            toast.success("Account deleted");
            await fetch("/api/auth/session", { method: "DELETE" });
            window.location.href = "/auth/login";
        },
        onError: async (error: unknown) => {
            if (error instanceof ApiError && error.status === 409) {
                const data = error.data;
                if (data?.code === "SOLE_OWNER_BLOCKER" && Array.isArray(data.workspaces)) {
                    setBlockerWorkspaces(data.workspaces);
                    onOpenChange(false);
                    setShowBlocker(true);
                    return;
                }
            }
            toast.error("Failed to delete account. Please try again.");
        },
    });

    const canConfirm = confirmEmail === userEmail;

    const handleDelete = () => {
        if (!canConfirm) return;
        deleteMutation.mutate();
    };

    // Reset state when modal closes
    const handleOpenChange = (v: boolean) => {
        if (!v) setConfirmEmail("");
        onOpenChange(v);
    };

    return (
        <>
            {/* Main delete confirmation dialog */}
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-destructive">Delete Account</DialogTitle>
                        <DialogDescription>
                            This action is permanent and cannot be undone. All your data will be
                            deleted. Type your email address to confirm.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            Your account and all associated data will be permanently deleted.
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                                Type <span className="font-mono font-semibold text-foreground">{userEmail}</span> to confirm:
                            </p>
                            <Input
                                value={confirmEmail}
                                onChange={(e) => setConfirmEmail(e.target.value)}
                                placeholder={userEmail}
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
                            onClick={handleDelete}
                            disabled={!canConfirm || deleteMutation.isPending}
                        >
                            {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete my account
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Sole-owner blocker dialog */}
            <Dialog open={showBlocker} onOpenChange={setShowBlocker}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Transfer ownership first</DialogTitle>
                        <DialogDescription>
                            You are the sole owner of the following workspace(s) that still have other
                            members. Transfer ownership before deleting your account.
                        </DialogDescription>
                    </DialogHeader>
                    <ul className="space-y-2 py-2">
                        {blockerWorkspaces.map((ws) => (
                            <li
                                key={ws.id}
                                className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-2 text-sm"
                            >
                                <span className="font-medium">{ws.name}</span>
                                <a
                                    href={`/${ws.slug}/dashboard/settings/workspace`}
                                    className="text-xs text-primary underline-offset-2 hover:underline"
                                >
                                    Workspace settings →
                                </a>
                            </li>
                        ))}
                    </ul>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowBlocker(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

// ── Change Password Card ─────────────────────────────────────────────────────

function ChangePasswordCard() {
    const { identities } = useTenant();

    // All hooks must be called unconditionally before any early return.
    const form = useForm<ChangePasswordFormValues>({
        resolver: zodResolver(changePasswordSchema),
        defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
    });

    const changePwMutation = useMutation({
        mutationFn: (data: ChangePasswordFormValues) =>
            api.post("/api/v1/auth/change-password", {
                currentPassword: data.currentPassword,
                newPassword: data.newPassword,
            }),
        onSuccess: () => {
            toast.success("Password updated successfully");
            form.reset();
        },
        onError: (error: unknown) => {
            if (error instanceof ApiError) {
                const code = error.data?.code;
                if (code === "WRONG_CURRENT_PASSWORD") {
                    form.setError("currentPassword", { message: "Current password is incorrect" });
                    return;
                }
                if (code === "SOCIAL_ACCOUNT_NO_PASSWORD") {
                    toast.error("Password change is not available for accounts that sign in with Google or SSO.");
                    return;
                }
                if (code === "INVALID_NEW_PASSWORD") {
                    form.setError("newPassword", { message: error.data?.error || "Password does not meet requirements" });
                    return;
                }
            }
            toast.error("Failed to change password. Please try again.");
        },
    });

    // Detect social/SSO provider from Cognito's `identities` JWT claim.
    // Email/password users have no `identities` field in their token.
    // Google/SSO users have a JSON string: [{ providerName: "Google", ... }]
    let socialProvider: string | null = null;
    if (identities) {
        try {
            const parsed = JSON.parse(identities as string);
            const name = parsed?.[0]?.providerName;
            if (name && name.toLowerCase() !== "cognito") {
                socialProvider = name;
            }
        } catch {
            // Parse failure → safe fallback: show the form
        }
    }

    if (socialProvider) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <LockKeyhole className="h-5 w-5" />
                        Change Password
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        You signed in with{" "}
                        <span className="font-medium text-foreground">{socialProvider}</span>.
                        Password management is handled by your provider.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <Form {...form}>
                <form onSubmit={form.handleSubmit((d) => changePwMutation.mutate(d))}>
                    <CardHeader className="border-b">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <LockKeyhole className="h-5 w-5" />
                            Change Password
                        </CardTitle>
                        <CardDescription>
                            Update your password. Not available for accounts that sign in with Google.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6 max-w-xl">
                        <FormField
                            control={form.control}
                            name="currentPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Current Password</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="password"
                                            placeholder="••••••••"
                                            disabled={changePwMutation.isPending}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="newPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>New Password</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="password"
                                            placeholder="••••••••"
                                            disabled={changePwMutation.isPending}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="confirmPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Confirm New Password</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="password"
                                            placeholder="••••••••"
                                            disabled={changePwMutation.isPending}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                    <CardFooter className="border-t border-border px-6 py-4 flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">Keep your password secure.</p>
                        <Button type="submit" disabled={changePwMutation.isPending}>
                            {changePwMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Update Password
                        </Button>
                    </CardFooter>
                </form>
            </Form>
        </Card>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProfileSettingsPage() {
    const { email } = useTenant();
    const queryClient = useQueryClient();
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);

    const { data, isLoading } = useQuery<{ user: UserProfile }>({
        queryKey: ["user-profile"],
        queryFn: () => api.get<{ user: UserProfile }>("/api/v1/users/profile"),
    });

    const form = useForm<ProfileFormValues>({
        resolver: zodResolver(profileSchema),
        defaultValues: { name: "", avatarUrl: "" },
    });

    useEffect(() => {
        if (data?.user) {
            form.reset({
                name: data.user.name,
                avatarUrl: data.user.avatarUrl || "",
            });
        }
    }, [data, form]);

    const updateMutation = useMutation({
        mutationFn: (values: ProfileFormValues) =>
            api.patch("/api/v1/users/profile", {
                name: values.name,
                avatarUrl: values.avatarUrl || null,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["user-profile"] });
            toast.success("Profile updated");
        },
        onError: () => {
            toast.error("Failed to update profile. Please try again.");
        },
    });

    if (isLoading) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Profile Settings</h1>
                    <p className="text-muted-foreground mt-1">Manage your personal account details.</p>
                </div>
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-1/4" />
                        <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Skeleton className="h-20 w-20 rounded-full" />
                        <Skeleton className="h-10 w-full max-w-md" />
                        <Skeleton className="h-10 w-full max-w-md" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    const userEmail = data?.user?.email || email || "";

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Profile Settings</h1>
                <p className="text-muted-foreground mt-1">Manage your personal account details.</p>
            </div>

            {/* ── Personal Info ── */}
            <Card>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit((d) => updateMutation.mutate(d))}>
                        <CardHeader className="border-b">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <User className="h-5 w-5" />
                                Personal Information
                            </CardTitle>
                            <CardDescription>
                                Update your display name and profile photo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 space-y-8 max-w-xl">
                            <FormField
                                control={form.control}
                                name="avatarUrl"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Profile Photo</FormLabel>
                                        <FormControl>
                                            <ImageUpload
                                                value={field.value || ""}
                                                onChange={field.onChange}
                                                fallbackText={form.getValues("name") || userEmail}
                                                disabled={updateMutation.isPending}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Display Name</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Your name"
                                                disabled={updateMutation.isPending}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="space-y-2">
                                <p className="text-sm font-medium leading-none">Email</p>
                                <Input
                                    value={userEmail}
                                    disabled
                                    className="text-muted-foreground cursor-not-allowed"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Email address cannot be changed.
                                </p>
                            </div>
                        </CardContent>
                        <CardFooter className="border-t border-border px-6 py-4 flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">
                                Please use 32 characters at maximum.
                            </p>
                            <Button type="submit" disabled={updateMutation.isPending}>
                                {updateMutation.isPending && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Save changes
                            </Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>

            {/* ── Change Password ── */}
            <ChangePasswordCard />

            {/* ── Danger Zone ── */}
            <Card className="border-destructive/30">
                <CardHeader className="border-b border-destructive/20">
                    <CardTitle className="text-destructive text-lg">Danger Zone</CardTitle>
                    <CardDescription>
                        Irreversible and destructive actions.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between rounded-lg border border-border px-4 py-4 gap-4">
                        <div>
                            <p className="text-sm font-medium">Delete account</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Permanently delete your account and all associated data.
                            </p>
                        </div>
                        <Button
                            variant="destructive"
                            onClick={() => setDeleteModalOpen(true)}
                        >
                            Delete account
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <DeleteAccountModal
                open={deleteModalOpen}
                onOpenChange={setDeleteModalOpen}
                userEmail={userEmail}
            />
        </div>
    );
}
