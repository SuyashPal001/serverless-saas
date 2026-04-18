'''
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AgentOrb } from "@/components/platform/chat/AgentOrb";

const formSchema = z.object({
    workspaceName: z.string().min(3, "Workspace name must be at least 3 characters"),
});

interface OnboardingResponse {
    agentId: string;
    slug: string;
}

function WorkspaceSetup({ agentId, slug }: { agentId: string; slug: string }) {
    const router = useRouter();

    useEffect(() => {
        const poll = setInterval(async () => {
            try {
                const response = await api.get<{ status: string }>(`/api/v1/agents/${agentId}/status`);
                if (response.status === 'ready') {
                    clearInterval(poll);
                    router.push(`/${slug}/dashboard`);
                }
            } catch (error) {
                // Ignore errors, keep polling
            }
        }, 2000);

        const timeout = setTimeout(() => {
            clearInterval(poll);
            toast.warning("Workspace setup is taking longer than expected. Redirecting now.");
            router.push(`/${slug}/dashboard`);
        }, 60000);

        return () => {
            clearInterval(poll);
            clearTimeout(timeout);
        };
    }, [agentId, slug, router]);

    return (
        <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center gap-6">
            <AgentOrb size={80} state="thinking" isLoading={true} />
            <div className="text-center">
                <h1 className="text-2xl font-bold tracking-tight">Setting up your workspace...</h1>
                <p className="text-muted-foreground">This may take a minute or two.</p>
            </div>
        </div>
    );
}


export default function OnboardingPage() {
    const [setupState, setSetupState] = useState<{ agentId: string; slug: string } | null>(null);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            workspaceName: "",
        },
    });

    const onboardingMutation = useMutation<OnboardingResponse, Error, z.infer<typeof formSchema>>({
        mutationFn: (data) => api.post("/api/v1/onboarding/complete", data),
        onSuccess: (data) => {
            setSetupState({ agentId: data.agentId, slug: data.slug });
        },
        onError: (error: any) => {
            const message = error.data?.error || "Onboarding failed. Please try again.";
            toast.error(message);
        },
    });

    function onSubmit(values: z.infer<typeof formSchema>) {
        onboardingMutation.mutate(values);
    }

    if (setupState) {
        return <WorkspaceSetup agentId={setupState.agentId} slug={setupState.slug} />;
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Welcome!</CardTitle>
                    <CardDescription>Let's get your workspace set up.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <FormField
                                control={form.control}
                                name="workspaceName"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Workspace Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Acme Inc." {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button type="submit" className="w-full" disabled={onboardingMutation.isPending}>
                                {onboardingMutation.isPending ? "Creating..." : "Continue"}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
'''