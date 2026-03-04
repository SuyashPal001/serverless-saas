"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { confirmSignIn, type ConfirmSignInInput } from "aws-amplify/auth";

import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const inviteSchema = z.object({
    password: z.string().min(8, { message: "Password must be at least 8 characters" }),
    confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

type InviteSchema = z.infer<typeof inviteSchema>;

export default function InvitePage() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const form = useForm<InviteSchema>({
        resolver: zodResolver(inviteSchema),
        defaultValues: {
            password: "",
            confirmPassword: "",
        },
    });

    async function onSubmit(data: InviteSchema) {
        setIsLoading(true);
        setError(null);

        try {
            // Complete the new password challenge
            // Note: This assumes signIn was already called and we are in the 
            // NEW_PASSWORD_REQUIRED challenge state.
            // Usually, invite links might carry a temporary password, or the user
            // has to enter their email and temporary password first on a login screen.
            // Assuming a strict "Invite Page" means they've reached the challenge step.
            const confirmInput: ConfirmSignInInput = {
                challengeResponse: data.password,
            };

            const authResult = await confirmSignIn(confirmInput);

            if (!authResult.isSignedIn) {
                throw new Error("Additional steps required after setting password.");
            }

            const { getAccessToken } = await import("@/lib/auth");
            const token = await getAccessToken();

            if (!token) {
                throw new Error("Password set, but no token was retrieved.");
            }

            // POST raw token to generate session
            const res = await fetch("/api/auth/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });

            if (!res.ok) {
                throw new Error("Failed to create secure session");
            }

            const { decodeTenantClaims } = await import("@/lib/tenant");
            const claims = decodeTenantClaims(token);

            const targetPath = claims?.tenantId
                ? `/${claims.tenantId}/dashboard`
                : "/dashboard";

            router.push(targetPath);
            router.refresh();

        } catch (err: any) {
            console.error("Invite Error:", err);
            setError(err.message || "Failed to set password. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <div className="w-full max-w-md p-8 space-y-6 rounded-xl border border-border bg-card shadow-sm">
                <div className="text-center space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Complete Setup</h1>
                    <p className="text-sm text-muted-foreground">Set your password to accept the invite</p>
                </div>

                {error && (
                    <div className="p-3 text-sm font-medium text-destructive bg-destructive/10 rounded-md">
                        {error}
                    </div>
                )}

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>New Password</FormLabel>
                                    <FormControl>
                                        <Input placeholder="••••••••" type="password" disabled={isLoading} {...field} />
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
                                    <FormLabel>Confirm Password</FormLabel>
                                    <FormControl>
                                        <Input placeholder="••••••••" type="password" disabled={isLoading} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? "Saving..." : "Set Password"}
                        </Button>
                    </form>
                </Form>
            </div>
        </div>
    );
}
