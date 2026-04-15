"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { api } from "@/lib/api";
import { useAuthRefresh } from "@/hooks/useAuthRefresh";
import { useHyperspace } from "@/components/hyperspace-provider";
import { StarfieldCanvas } from "@/components/starfield-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    const [error, setError] = useState<string | null>(null);

    const form = useForm<OnboardingSchema>({
        resolver: zodResolver(onboardingSchema),
        defaultValues: { workspaceName: "", purpose: "" },
        mode: "onChange"
    });

    const isNameValid = form.watch("workspaceName").length >= 2;
    const currentPurpose = form.watch("purpose");

    async function onSubmit(data: OnboardingSchema) {
        setIsLoading(true);
        setError(null);

        try {
            // Create tenant + agent
            const res = await api.post('/v1/onboarding/complete', data);

            // Fire-and-forget provision call
            if (res.tenantId) {
                api.post(`/v1/onboarding/provision/${res.tenantId}`, {}).catch((err) => {
                    console.error("Background provision failed:", err);
                });
            }

            // Clear HTTP session token (so login can start fresh and get tenantId claims)
            await fetch('/api/auth/session', { method: 'DELETE' });

            // Trigger immersive transition
            startHyperspace('signup');

            // Send to login, which will automatically grab the new JWT and redirect to dashboard
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

            <div className="relative z-10 w-full max-w-md p-8 flex flex-col gap-8">
                <div className="text-center">
                    <p className="text-sm font-medium tracking-wider text-muted-foreground uppercase opacity-80 mb-2">
                        One last thing
                    </p>
                </div>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-10">
                    <div className="space-y-4">
                        <Input
                            placeholder="Name your workspace"
                            className="bg-transparent border-none text-center text-2xl h-14 placeholder:text-muted-foreground/40 focus-visible:ring-0 shadow-none px-0 tracking-tight"
                            autoFocus
                            disabled={isLoading}
                            {...form.register("workspaceName")}
                        />
                    </div>

                    <div className="space-y-4 pt-4 border-t border-white/10 text-center">
                        <p className="text-sm font-medium tracking-wider text-muted-foreground uppercase opacity-80">
                            What will you use it for?
                        </p>
                        <div className="flex flex-wrap justify-center gap-3">
                            {PURPOSES.map((p) => (
                                <button
                                    key={p.value}
                                    type="button"
                                    disabled={isLoading}
                                    onClick={() => form.setValue('purpose', p.value)}
                                    className={cn(
                                        "px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 border backdrop-blur-sm",
                                        currentPurpose === p.value
                                            ? "bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                                            : "bg-black/40 text-white/70 border-white/20 hover:bg-white/10 hover:border-white/40"
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="text-center text-sm text-red-400 bg-red-400/10 py-2 px-4 rounded">
                            {error}
                        </div>
                    )}

                    <div className="pt-6">
                        <Button
                            type="submit"
                            size="lg"
                            disabled={!isNameValid || isLoading}
                            className={cn(
                                "w-full transition-all duration-500 rounded-full h-14 text-base font-semibold",
                                isNameValid && !isLoading
                                    ? "bg-white text-black hover:bg-gray-200 shadow-[0_0_30px_rgba(255,255,255,0.4)]"
                                    : "bg-white/5 text-white/30 border border-white/10"
                            )}
                        >
                            {isLoading ? "Preparing flight..." : "Let's go \u2192"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
