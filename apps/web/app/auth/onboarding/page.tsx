"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { StarfieldCanvas } from "@/components/starfield-canvas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentOrb } from "@/components/platform/chat/AgentOrb";
import { toast } from "sonner";

const PURPOSES = [
    { value: 'personal', label: 'Personal work' },
    { value: 'team', label: 'Team collaboration' },
    { value: 'client', label: 'Client projects' }
];

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

export default function OnboardingPage() {
    const router = useRouter();

    const [step, setStep] = useState<1 | 2>(1);
    const [workspaceName, setWorkspaceName] = useState('');
    const [purpose, setPurpose] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [provisioning, setProvisioning] = useState<{ agentId: string; slug: string } | null>(null);

    const isNameValid = workspaceName.trim().length >= 2;

    function handleContinue() {
        if (!isNameValid) return;
        setStep(2);
    }

    function handleBack() {
        setStep(1);
        setError(null);
    }

    async function handleSubmit() {
        setIsLoading(true);
        setError(null);

        try {
            const res = await api.post<{ tenantId: string; agentId: string; slug: string }>(
                '/api/v1/onboarding/complete',
                { workspaceName: workspaceName.trim(), purpose: purpose || undefined },
            );

            // Fire-and-forget provision — starts the GCP container for this tenant
            if (res.tenantId) {
                api.post(`/api/v1/onboarding/provision/${res.tenantId}`, {}).catch((err) => {
                    console.error("Background provision failed:", err);
                });
            }

            // Transition to setup screen — polling begins via useEffect
            setProvisioning({ agentId: res.agentId, slug: res.slug });

        } catch (err: any) {
            console.error("Onboarding failed:", err);
            setError(err.message || "Failed to create workspace. Please try again.");
            setIsLoading(false);
        }
    }

    // Poll /onboarding/provision-status/:agentId while the setup screen is showing.
    // Session clear + redirect happens here (not in handleSubmit) so the JWT is still
    // valid for the status poll requests.
    useEffect(() => {
        if (!provisioning) return;

        const { agentId, slug } = provisioning;
        let cancelled = false;
        const startedAt = Date.now();

        const finish = async (timedOut: boolean) => {
            if (timedOut) {
                toast.warning("Your workspace is still warming up — you can start chatting in a moment.");
            }
            await fetch('/api/auth/session', { method: 'DELETE' });
            router.push(`/auth/login?onboarded=true&slug=${slug}`);
        };

        const poll = async () => {
            if (cancelled) return;

            if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
                finish(true);
                return;
            }

            try {
                const res = await api.get<{ status: string }>(`/api/v1/onboarding/provision-status/${agentId}`);
                if (!cancelled && res.status === 'ready') {
                    finish(false);
                    return;
                }
            } catch (err) {
                console.warn('[onboarding] Status poll failed:', err);
            }

            if (!cancelled) {
                setTimeout(poll, POLL_INTERVAL_MS);
            }
        };

        poll();

        return () => { cancelled = true; };
    }, [provisioning, router]);

    // Setup screen — shown after workspace creation while container warms up
    if (provisioning) {
        return (
            <div className="relative min-h-screen bg-black text-white flex flex-col items-center justify-center overflow-hidden">
                <StarfieldCanvas speedMode="idle" active={true} />
                <div className="relative z-10 flex flex-col items-center gap-8">
                    <AgentOrb size={80} state="thinking" isLoading />
                    <div className="text-center space-y-2">
                        <p className="text-2xl md:text-3xl font-medium tracking-tight">
                            Setting up your workspace...
                        </p>
                        <p className="text-sm text-white/40">
                            Starting your agent runtime. This usually takes about 30 seconds.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen bg-black text-white flex flex-col items-center justify-center overflow-hidden">
            <StarfieldCanvas speedMode="idle" active={true} />

            <div className="relative z-10 w-full max-w-4xl px-4 flex flex-col items-center justify-center">

                {step === 1 && (
                    <div className="w-full flex flex-col items-center">
                        <div className="text-center w-full mb-10 mt-10 md:mt-16">
                            <p className="text-[11px] md:text-xs font-semibold tracking-[0.2em] text-white/40 uppercase mb-5">
                                Your workspace awaits
                            </p>

                            <div className="relative group max-w-xl mx-auto w-full">
                                <input
                                    type="text"
                                    placeholder="e.g. Acme Corp"
                                    value={workspaceName}
                                    onChange={(e) => setWorkspaceName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && isNameValid && handleContinue()}
                                    className="w-full bg-transparent border-0 border-b border-white/20 rounded-none text-center text-3xl md:text-4xl lg:text-5xl font-medium tracking-tight h-auto py-3 placeholder:text-white/20 px-0 text-white focus:outline-none focus:border-white/60 transition-colors duration-500"
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div className="w-full max-w-[280px] mt-6">
                            <Button
                                type="button"
                                size="lg"
                                disabled={!isNameValid}
                                onClick={handleContinue}
                                className={cn(
                                    "w-full transition-all duration-500 rounded-full h-14 text-base font-semibold tracking-wide",
                                    isNameValid
                                        ? "bg-white text-black hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:scale-[1.02]"
                                        : "bg-white/5 text-white/40 border border-white/10"
                                )}
                            >
                                Continue →
                            </Button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="w-full flex flex-col items-center">
                        <button
                            type="button"
                            onClick={handleBack}
                            disabled={isLoading}
                            className="absolute top-8 left-4 md:left-8 text-white/40 hover:text-white transition-colors text-sm flex items-center gap-2"
                        >
                            ← Back
                        </button>

                        <div className="space-y-6 pt-4 w-full max-w-2xl text-center mb-16 mt-10 md:mt-16">
                            <p className="text-[11px] md:text-xs font-semibold tracking-[0.2em] text-white/40 uppercase mb-5">
                                One last thing
                            </p>
                            <p className="text-3xl md:text-4xl lg:text-5xl font-medium tracking-tight">
                                What will you use it for?
                            </p>
                            <div className="flex flex-wrap justify-center gap-4 pt-4">
                                {PURPOSES.map((p) => (
                                    <button
                                        key={p.value}
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => setPurpose(p.value)}
                                        className={cn(
                                            "px-5 py-2 text-[13px] font-medium transition-all duration-300 border backdrop-blur-md rounded-full",
                                            purpose === p.value
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
                                type="button"
                                size="lg"
                                disabled={isLoading}
                                onClick={handleSubmit}
                                className="w-full transition-all duration-500 rounded-full h-14 text-base font-semibold tracking-wide bg-white text-black hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:scale-[1.02]"
                            >
                                {isLoading ? "Creating..." : "Let's go →"}
                            </Button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
