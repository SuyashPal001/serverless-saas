"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "@/lib/auth";

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
        defaultValues: {
            email: "",
            password: "",
        },
    });

    async function onSubmit(data: LoginSchema) {
        setIsLoading(true);
        setError(null);

        try {
            // 1. Authenticate with Cognito (Amplify securely isolated from localStorage)
            const authResult = await signIn({
                username: data.email,
                password: data.password,
            });

            if (!authResult.isSignedIn) {
                throw new Error("MFA required or additional steps needed. Not implemented for this flow.");
            }

            // 2. We need the token to POST to the session endpoint
            // To get it, we MUST import getAccessToken from lib/auth
            // However, to avoid circular dependencies or complex state inside onSubmit, 
            // we'll rely on a dynamic import or direct call to getAccessToken.
            // Easiest is to import it at the top.
            const { getAccessToken } = await import("@/lib/auth");
            const token = await getAccessToken();

            if (!token) {
                throw new Error("Authentication succeeded but no token was retrieved.");
            }

            // 3. POST raw token to the Next.js API route so it sets the httpOnly cookie
            const res = await fetch("/api/auth/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });

            if (!res.ok) {
                throw new Error("Failed to create secure session");
            }

            // 4. Redirect to the tenant dashboard
            // Tenant is resolved via headers in middleware, but since we are client-side 
            // and want to navigate, we should theoretically know the tenant from the JWT.
            // For this scaffold, a simple router.push("/dashboard") will hit middleware.
            // Middleware requires the slug to be in the subdomain.
            // Since this is the login page (likely on root domain or auth subdomain), 
            // we redirect to the root of wherever the middleware will map them.
            // The rules state: /auth/login -> /{tenantSlug}/dashboard
            // We'll decode the JWT here strictly to find the tenantSlug for navigation.
            const { decodeTenantClaims } = await import("@/lib/tenant");
            const claims = decodeTenantClaims(token);

            const targetPath = claims?.tenantId
                ? `/${claims.tenantId}/dashboard`
                : "/dashboard";

            router.push(targetPath);
            router.refresh();

        } catch (err: any) {
            console.error("Login Error:", err);
            // Simplify Amplify errors if possible
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
