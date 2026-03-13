'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const onboardingSchema = z.object({
    workspaceName: z
        .string()
        .min(2, { message: 'Workspace name must be at least 2 characters' })
        .max(50, { message: 'Workspace name must be under 50 characters' }),
});

type OnboardingSchema = z.infer<typeof onboardingSchema>;

export default function OnboardingPage() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const form = useForm<OnboardingSchema>({
        resolver: zodResolver(onboardingSchema),
        defaultValues: { workspaceName: '' },
    });

    async function onSubmit(data: OnboardingSchema) {
        setIsLoading(true);
        setError(null);

        try {
            // 1. Create the tenant
            const res = await fetch('/api/proxy/api/v1/onboarding/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceName: data.workspaceName }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Failed to create workspace');
            }

            const { slug } = await res.json();

            // 2. Get refresh token from server, exchange for new JWT with tenantId stamped
            const refreshRes = await fetch('/api/auth/refresh', { method: 'POST' });
            if (!refreshRes.ok) throw new Error('Failed to refresh session');
            const { idToken } = await refreshRes.json();

            // 3. Update platform_token cookie with new JWT
            const sessionRes = await fetch('/api/auth/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: idToken }),
            });

            if (!sessionRes.ok) throw new Error('Failed to update session');

            // 4. Redirect to tenant dashboard
            router.push(`/${slug}/dashboard`);
            router.refresh();

        } catch (err: any) {
            console.error('Onboarding error:', err);
            setError(err.message || 'Something went wrong. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <div className="w-full max-w-md p-8 space-y-6 rounded-xl border border-border bg-card shadow-sm">
                <div className="text-center space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Create your workspace</h1>
                    <p className="text-sm text-muted-foreground">
                        This will be your team's home on the platform.
                    </p>
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
                            name="workspaceName"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Workspace name</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Acme Corp"
                                            disabled={isLoading}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? 'Creating workspace...' : 'Continue'}
                        </Button>
                    </form>
                </Form>
            </div>
        </div>
    );
}
