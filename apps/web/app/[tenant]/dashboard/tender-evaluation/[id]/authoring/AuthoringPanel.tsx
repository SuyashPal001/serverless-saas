"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, BookOpen, Download, Globe, Lock } from "lucide-react";
import { RFPSection } from "./components/RFPSection";
import { ClauseLibraryPanel } from "./components/ClauseLibraryPanel";

const AGENT_STEPS = [
    { label: "Reading requirement documents and procurement notes…", section: null },
    { label: "Analysing scope, budget, and technical parameters…", section: null },
    { label: "Drafting Notice Inviting Tender & Overview", section: "S1" },
    { label: "Writing Scope of Work and deliverables", section: "S2" },
    { label: "Composing Eligibility & Pre-Qualification criteria", section: "S3" },
    { label: "Drafting Technical Specifications and compliance matrix", section: "S4" },
    { label: "Writing General and Special Conditions of Contract", section: "S5–S6" },
    { label: "Assembling BOQ and financial price schedule", section: "S7" },
    { label: "Running CVC compliance review and finalising", section: "S8" },
]

function GeneratingState() {
    const [stepIdx, setStepIdx] = useState(0)
    const [visible, setVisible] = useState(true)

    useEffect(() => {
        const tick = setInterval(() => {
            setVisible(false)
            setTimeout(() => {
                setStepIdx(i => (i + 1) % AGENT_STEPS.length)
                setVisible(true)
            }, 400)
        }, 3200)
        return () => clearInterval(tick)
    }, [])

    const step = AGENT_STEPS[stepIdx]

    return (
        <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="relative flex items-center justify-center w-14 h-14">
                <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
                <div className="absolute inset-1 rounded-full border border-primary/30" />
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>

            <div className="text-center space-y-1.5">
                <p className="text-xs font-semibold text-primary uppercase tracking-widest">Tender Author · drafting RFP</p>
                <div className="h-6 flex items-center justify-center">
                    <p className={`text-sm text-foreground transition-opacity duration-400 ${visible ? "opacity-100" : "opacity-0"}`}>
                        {step.label}
                    </p>
                </div>
                {step.section && (
                    <div className={`transition-opacity duration-400 ${visible ? "opacity-100" : "opacity-0"}`}>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-primary/10 text-primary border border-primary/20">
                            {step.section}
                        </span>
                    </div>
                )}
            </div>

            <div className="flex gap-1.5">
                {AGENT_STEPS.map((_, i) => (
                    <div key={i} className={`rounded-full transition-all duration-300 ${i === stepIdx ? "w-4 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-muted-foreground/30"}`} />
                ))}
            </div>

            <p className="text-xs text-muted-foreground">~30 seconds · page refreshes automatically</p>
        </div>
    )
}

interface Section {
    id: string; sectionNo: string; title: string; blockType: string;
    content: Record<string, unknown>; version: number; acceptedAt: string | null;
}

interface RFPData {
    tender: { id: string; rfpNumber: string; title: string; authoringStatus: string | null; status: string; publishedAt: string | null };
    sections: Section[];
}

async function fetchAuthoring(tenderId: string): Promise<RFPData> {
    const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
        // Gateway timeout / HTML error — treat as still generating so polling continues
        return { tender: { id: tenderId, rfpNumber: "", title: "", authoringStatus: "generating", status: "authoring", publishedAt: null }, sections: [] };
    }
    if (!res.ok) throw new Error("Failed to load RFP");
    return res.json();
}

export function AuthoringPanel({ tenderId }: { tenderId: string }) {
    const qc = useQueryClient();
    const [showLibrary, setShowLibrary] = useState(false);
    const [confirmPublish, setConfirmPublish] = useState(false);

    const { data, isLoading, error, refetch } = useQuery<RFPData>({
        queryKey: ["rfp-authoring", tenderId],
        queryFn: () => fetchAuthoring(tenderId),
        refetchInterval: (data) => {
            const status = data?.state?.data?.tender?.authoringStatus;
            return status === "generating" ? 3000 : false;
        },
    });

    const exportMutation = useMutation({
        mutationFn: async (fmt: "html" | "word") => {
            const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}/export?format=${fmt}`);
            if (!res.ok) throw new Error("Export failed");
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = `RFP-${tenderId}.${fmt === "word" ? "doc" : "html"}`; a.click();
            URL.revokeObjectURL(url);
        },
    });

    const retryMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}/retry`, { method: "POST" });
            if (!res.ok) throw new Error((await res.json()).error ?? "Retry failed");
        },
        onSuccess: () => refetch(),
    });

    const publishMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}/publish`, { method: "POST" });
            if (!res.ok) throw new Error((await res.json()).error ?? "Publish failed");
        },
        onSuccess: () => {
            setConfirmPublish(false);
            qc.invalidateQueries({ queryKey: ["rfp-authoring", tenderId] });
            qc.invalidateQueries({ queryKey: ["tender-list"] });
        },
    });

    if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading RFP…</div>;

    const generating = data?.tender?.authoringStatus === "generating";

    if (generating) return <GeneratingState />;

    const failed = data?.tender?.authoringStatus === "failed";

    if (failed || error) {
        return (
            <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-400 flex items-center gap-2">
                RFP generation failed.
                <Button variant="ghost" size="sm" disabled={retryMutation.isPending}
                    onClick={() => retryMutation.mutate()} className="ml-2">
                    {retryMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Retrying…</> : "Retry"}
                </Button>
                {retryMutation.error && <span className="text-xs ml-1">{(retryMutation.error as Error).message}</span>}
            </div>
        );
    }

    if (!data?.sections?.length) {
        return <p className="text-sm text-muted-foreground">No RFP sections found for this tender.</p>;
    }

    const acceptedCount = data.sections.filter(s => s.acceptedAt).length;
    const isPublished = data.tender.status === "published";
    const allAccepted = acceptedCount === data.sections.length && data.sections.length > 0;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 border text-xs">
                        {acceptedCount}/{data.sections.length} sections accepted
                    </Badge>
                    <span className="text-xs text-muted-foreground">{data.tender.rfpNumber}</span>
                    {isPublished && (
                        <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 border text-xs gap-1">
                            <Lock className="w-3 h-3" /> Published
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowLibrary(v => !v)} className="gap-1.5 border-border text-xs">
                        <BookOpen className="w-3.5 h-3.5" /> Clause Library
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => exportMutation.mutate("word")} disabled={exportMutation.isPending} className="gap-1.5 border-border text-xs">
                        <Download className="w-3.5 h-3.5" />
                        {exportMutation.isPending ? "Exporting…" : "Export Word"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => exportMutation.mutate("html")} disabled={exportMutation.isPending} className="gap-1.5 border-border text-xs">
                        <Download className="w-3.5 h-3.5" /> Export HTML
                    </Button>
                    {!isPublished && (
                        <Button size="sm" onClick={() => setConfirmPublish(true)}
                            disabled={!allAccepted || publishMutation.isPending}
                            className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40">
                            <Globe className="w-3.5 h-3.5" />
                            {publishMutation.isPending ? "Publishing…" : "Publish RFP"}
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex gap-4">
                <div className="flex-1 space-y-4 min-w-0">
                    {data.sections.map((section) => (
                        <RFPSection
                            key={section.id}
                            section={section}
                            tenderId={tenderId}
                            isPublished={isPublished}
                            onMutate={() => qc.invalidateQueries({ queryKey: ["rfp-authoring", tenderId] })}
                        />
                    ))}
                </div>
                {showLibrary && (
                    <div className="w-80 shrink-0">
                        <ClauseLibraryPanel onClose={() => setShowLibrary(false)} />
                    </div>
                )}
            </div>

            <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Publish {data.tender.rfpNumber}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will lock all {data.sections.length} sections and advance the tender to <b>Published</b> stage.
                            Further changes require a corrigendum during the Pre-Bid stage. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={publishMutation.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
                            {publishMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Publishing…</> : "Publish RFP"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
