"use client";

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, BookOpen, Download } from "lucide-react";
import { RFPSection } from "./components/RFPSection";
import { ClauseLibraryPanel } from "./components/ClauseLibraryPanel";

interface Section {
    id: string; sectionNo: string; title: string; blockType: string;
    content: Record<string, unknown>; version: number; acceptedAt: string | null;
}

interface RFPData {
    tender: { id: string; rfpNumber: string; title: string; authoringStatus: string | null };
    sections: Section[];
}

async function fetchAuthoring(tenderId: string): Promise<RFPData> {
    const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}`);
    if (!res.ok) throw new Error("Failed to load RFP");
    return res.json();
}

export function AuthoringPanel({ tenderId }: { tenderId: string }) {
    const qc = useQueryClient();
    const [showLibrary, setShowLibrary] = useState(false);

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

    if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading RFP…</div>;

    const generating = data?.tender?.authoringStatus === "generating";

    if (generating) {
        return (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <p className="text-sm">Generating RFP — Saarthi is drafting all 8 sections…</p>
                <p className="text-xs">This takes ~30 seconds. Page auto-refreshes.</p>
            </div>
        );
    }

    const failed = data?.tender?.authoringStatus === "failed";

    const retryMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}/retry`, { method: "POST" });
            if (!res.ok) throw new Error((await res.json()).error ?? "Retry failed");
        },
        onSuccess: () => refetch(),
    });

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

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 border text-xs">
                        {acceptedCount}/{data.sections.length} sections accepted
                    </Badge>
                    <span className="text-xs text-muted-foreground">{data.tender.rfpNumber}</span>
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
                </div>
            </div>

            <div className="flex gap-4">
                <div className="flex-1 space-y-4 min-w-0">
                    {data.sections.map((section) => (
                        <RFPSection
                            key={section.id}
                            section={section}
                            tenderId={tenderId}
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
        </div>
    );
}
