"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "@/lib/auth";
import { decodeTenantClaims } from "@/lib/tenant";

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

const loginSchema = z.object({
    email: z.string().email({ message: "Invalid email address" }),
    password: z.string().min(8, { message: "Password must be at least 8 characters" }),
});

type LoginSchema = z.infer<typeof loginSchema>;

export default function LoginPage() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const form = useForm<LoginSchema>({
        resolver: zodResolver(loginSchema),
        defaultValues: { email: "", password: "" },
    });

    async function onSubmit(data: LoginSchema) {
        setIsLoading(true);
        setError(null);

        try {
            // 1. Authenticate directly with Cognito — returns idToken, accessToken, refreshToken
            const { idToken, refreshToken } = await signIn(data.email, data.password);

            // 2. Fetch user profile to get the tenant slug
            // Note: We pass the idToken directly in the header since the cookie isn't set yet.
            const profileRes = await fetch(`/api/proxy/api/v1/auth/me`, {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });

            if (!profileRes.ok) throw new Error("Failed to fetch user profile");
            const profile = await profileRes.json();
            const slug = profile.slug;

            // 3. POST idToken to Next.js API route to set httpOnly cookie
            const res = await fetch("/api/auth/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: idToken,
                    refreshToken
                }),
            });

            if (!res.ok) throw new Error("Failed to create secure session");

            // 4. Redirect to the tenant dashboard using the slug
            const targetPath = slug
                ? `/${slug}/dashboard`
                : "/onboarding";

            router.push(targetPath);
            router.refresh();

        } catch (err: any) {
            console.error("Login error:", err);
            setError(err.message || "Invalid email or password. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <div className="w-full max-w-md p-8 space-y-6 rounded-xl border border-border bg-card shadow-sm">
                <div className="text-center space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Platform</h1>
                    <p className="text-sm text-muted-foreground">Sign in to your account</p>
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
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input placeholder="name@example.com" type="email" disabled={isLoading} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Password</FormLabel>
                                    <FormControl>
                                        <Input placeholder="••••••••" type="password" disabled={isLoading} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? "Signing in..." : "Sign in"}
                        </Button>
                    </form>
                </Form>
            </div>
        </div>
    );
}