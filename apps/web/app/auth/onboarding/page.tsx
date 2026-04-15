"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { api } from "@/lib/api";
import { useAuthRefresh } from "@/hooks/useAuthRefresh";
import { useHyperspace } from "@/components/hyperspace-provider";
import { StarfieldCanvas } from "@/components/starfield-canvas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const onboardingSchema = z.object({
    workspaceName: z.string().min(2, "Workspace name must be at least 2 characters"),
    purpose: z.string().optional(),
});

type OnboardingSchema = z.infer<typeof onboardingSchema>;

const PURPOSES = [
    { value: 'personal', label: 'Personal work' },
    { value: 'team', label: 'Team collaboration' },
    { value: 'client', label: 'Client projects' }
];

export default function OnboardingPage() {
    const router = useRouter();
    const { startHyperspace } = useHyperspace();
    const [isLoading, setIsLoading] = useState(false);
    const [isPreparing, setIsPreparing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Populated from sessionStorage when the OAuth callback pre-created the tenant
    const [pendingTenantId, setPendingTenantId] = useState<string | null>(null);
    const [pendingSlug, setPendingSlug] = useState<string | null>(null);
    const [hasPendingError, setHasPendingError] = useState(false);

    const form = useForm<OnboardingSchema>({
        resolver: zodResolver(onboardingSchema),
        defaultValues: { workspaceName: "", purpose: "" },
        mode: "onChange"
    });

    // Pre-fill workspace name from sessionStorage if the callback created the tenant early
    useEffect(() => {
        const tenantId = sessionStorage.getItem('pending_onboarding_tenant_id');
        const slug = sessionStorage.getItem('pending_onboarding_slug');
        const defaultName = sessionStorage.getItem('pending_onboarding_default_name');
        const hasError = sessionStorage.getItem('pending_onboarding_error') === '1';

        if (tenantId) setPendingTenantId(tenantId);
        if (slug) setPendingSlug(slug);
        if (hasError) setHasPendingError(true);

        // Only pre-fill when we have a valid pending tenant (no error)
        if (defaultName && !hasError) {
            form.setValue('workspaceName', defaultName, { shouldValidate: true });
        }
    }, []);

    const isNameValid = form.watch("workspaceName").length >= 2;
    const currentPurpose = form.watch("purpose");

    async function onSubmit(data: OnboardingSchema) {
        setIsLoading(true);
        setError(null);

        // ── Fast path ─────────────────────────────────────────────────────────
        // Tenant was pre-created in the OAuth callback. Just rename it to the
        // user's chosen name and navigate directly to the dashboard.
        if (pendingTenantId && pendingSlug && !hasPendingError) {
            try {
                // Guard: ensure JWT carries custom:tenantId before the PATCH.
                // The callback already did this refresh, but we repeat it here to
                // protect against a silent failure there.
                const refreshRes = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tenantId: pendingTenantId }),
                });

                if (!refreshRes.ok) {
                    // Tenant exists — cannot fall back to onboarding/complete (would create duplicate).
                    setError("Failed to prepare your workspace. Please refresh the page.");
                    setIsLoading(false);
                    return;
                }

                // Rename the pre-created workspace to the user's chosen name
                const patchRes = await fetch(`/api/proxy/api/v1/workspaces/${pendingTenantId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: data.workspaceName }),
                });

                if (!patchRes.ok) {
                    const patchErr = await patchRes.json().catch(() => ({})) as Record<string, unknown>;
                    throw new Error((patchErr.message as string) || 'Failed to rename workspace');
                }

                // Clear all pending state
                sessionStorage.removeItem('pending_onboarding_tenant_id');
                sessionStorage.removeItem('pending_onboarding_slug');
                sessionStorage.removeItem('pending_onboarding_default_name');

                setIsPreparing(true);
                await new Promise((resolve) => setTimeout(resolve, 1500));

                startHyperspace('signup');
                setTimeout(() => {
                    router.push(`/${pendingSlug}/dashboard`);
                    router.refresh();
                }, 100);

            } catch (err: any) {
                console.error("Fast-path onboarding failed:", err);
                setError(err.message || "Failed to set up workspace. Please refresh the page.");
                setIsLoading(false);
            }
            return;
        }

        // ── Fallback path ─────────────────────────────────────────────────────
        // No pre-created tenant (email flow) or the callback errored — create the
        // tenant now and send the user through login to stamp the JWT.
        try {
            sessionStorage.removeItem('pending_onboarding_error');

            // Create tenant + agent
            const res = await api.post<{ tenantId: string; slug: string; message: string }>('/v1/onboarding/complete', data);

            // Fire-and-forget provision call
            if (res.tenantId) {
                api.post(`/v1/onboarding/provision/${res.tenantId}`, {}).catch((err) => {
                    console.error("Background provision failed:", err);
                });
            }

            // Clear HTTP session token (so login can start fresh and get tenantId claims)
            await fetch('/api/auth/session', { method: 'DELETE' });

            setIsPreparing(true);
            await new Promise((resolve) => setTimeout(resolve, 1500));

            // Trigger immersive transition
            startHyperspace('signup');

            // Send to login — Pre-Token Lambda stamps custom:tenantId on fresh login
            setTimeout(() => {
                router.push(`/auth/login?onboarded=true&slug=${res.slug}`);
            }, 100);

        } catch (err: any) {
            console.error("Onboarding failed:", err);
            setError(err.message || "Failed to create workspace. Please try again.");
            setIsLoading(false);
        }
    }

    return (
        <div className="relative min-h-screen bg-black text-white flex flex-col items-center justify-center overflow-hidden">
            {/* Immersive background matching hyperspace idle */}
            <StarfieldCanvas speedMode="idle" active={true} />

            <div className="relative z-10 w-full max-w-4xl px-4 flex flex-col items-center justify-center">
                <form onSubmit={form.handleSubmit(onSubmit)} className="w-full flex flex-col items-center">
                    
                    <div className="text-center w-full mb-10 mt-10 md:mt-16">
                        <p className="text-xs md:text-sm font-medium tracking-[0.2em] text-white/40 uppercase mb-5">
                            Your workspace awaits
                        </p>
                        
                        <div className="relative group max-w-xl mx-auto w-full">
                            <input
                                type="text"
                                placeholder="Name your workspace"
                                className="w-full bg-transparent border-0 border-b border-white/20 rounded-none text-center text-3xl md:text-4xl lg:text-5xl font-medium tracking-tight h-auto py-3 placeholder:text-white/20 px-0 text-white focus:outline-none focus:border-white/60 transition-colors duration-500"
                                autoFocus
                                disabled={isLoading}
                                {...form.register("workspaceName")}
                            />
                        </div>
                    </div>

                    <div className="space-y-6 pt-4 w-full max-w-2xl text-center mb-16">
                        <p className="text-xs md:text-sm font-medium tracking-[0.2em] text-white/40 uppercase">
                            What will you use it for?
                        </p>
                        <div className="flex flex-wrap justify-center gap-4">
                            {PURPOSES.map((p) => (
                                <button
                                    key={p.value}
                                    type="button"
                                    disabled={isLoading}
                                    onClick={() => form.setValue('purpose', p.value)}
                                    className={cn(
                                        "px-5 py-2 text-[13px] font-medium transition-all duration-300 border backdrop-blur-md rounded-full",
                                        currentPurpose === p.value
                                            ? "bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.2)] scale-105"
                                            : "bg-transparent text-white/40 border-white/10 hover:border-white/30 hover:text-white"
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="text-center text-sm text-red-400 bg-red-400/10 py-2 px-4 rounded mb-8">
                            {error}
                        </div>
                    )}

                    <div className="w-full max-w-[280px]">
                        <Button
                            type="submit"
                            size="lg"
                            disabled={!isNameValid || isLoading}
                            className={cn(
                                "w-full transition-all duration-500 rounded-full h-14 text-base font-semibold tracking-wide",
                                isNameValid && !isLoading
                                    ? "bg-white text-black hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:scale-[1.02]"
                                    : "bg-white/5 text-white/40 border border-white/10"
                            )}
                        >
                            {isPreparing ? "Preparing your space..." : (isLoading ? "Creating..." : "Let's go \u2192")}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
