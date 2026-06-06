"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Play, FileText, Users, ClipboardList, ShieldCheck, AlertCircle, BarChart3 } from "lucide-react";
import { Stage1Flashback, Stage2Flashback } from "./components/StageFlashback";
import { PQPanel } from "./components/PQPanel";
import { TechnicalPanel } from "./components/TechnicalPanel";
import { ShortfallPanel } from "./components/ShortfallPanel";
import { FinancialPanel } from "./components/FinancialPanel";
import { ActionModal } from "./components/ActionModal";

const DEMO_TENDER_REF = "DIT/HRMS/2024-25/001"; // seeded tender identifier

interface TenderData {
    id: string; rfpNumber: string; title: string; department: string;
    budget: string; evalMethod: string; status: string;
    bidders: Array<{ id: string; name: string; displayLabel: string; status: string }>;
    pqFindings: Array<{ id: string; ruleId: string; ruleName: string; status: "qualified" | "not_qualified" | "cannot_evaluate"; provision: string; narration: string; declaredValue: string | null; thresholdValue: string | null; sourceDoc: string | null; sourcePage: number | null; bidderId: string }>;
    technicalFindings: Array<{ id: string; clauseNo: string; clauseTitle: string; status: "complied" | "deviation" | "not_found" | "cannot_evaluate"; narration: string; sourceDoc: string | null; sourcePage: number | null; rfpRequirement: string | null; bidderResponse: string | null; bidderId: string }>;
    shortfalls: Array<{ id: string; discrepancy: string; sourceDoc: string | null; sourcePage: number | null; status: string; bidderId: string }>;
    clarificationRequests: Array<{ id: string; shortfallId: string | null; bidderId: string; draftedText: string; deadlineDays: number; sentAt: string | null; responseText: string | null }>;
    financialFindings: Array<{ id: string; bidderId: string; boqLines: Array<{ item: string; rfpQty: number; unit: string; quotedRate: number; amount: number }>; totalAmount: string; arithmeticCorrection: string; correctedTotal: string; isL1: string; l1Margin: string | null; sourceDoc: string | null; sourcePage: number | null }>;
    report: { id: string; recommendation: string; pqSummary: Record<string, unknown>; finSummary: Record<string, unknown> } | null;
}

const STAGES = [
    { id: "stage1", label: "1. Authoring", icon: FileText },
    { id: "stage2", label: "2. Pre-Bid", icon: Users },
    { id: "stage3", label: "3. PQ", icon: ShieldCheck },
    { id: "stage4", label: "4. Technical", icon: ClipboardList },
    { id: "stage5", label: "5. Shortfalls", icon: AlertCircle },
    { id: "stage6", label: "6. Financial", icon: BarChart3 },
];

async function fetchTenders(): Promise<TenderData[]> {
    const res = await fetch("/api/proxy/api/v1/tender/evaluations");
    if (!res.ok) return [];
    return res.json();
}

async function fetchTender(id: string): Promise<TenderData> {
    const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${id}`);
    if (!res.ok) throw new Error("Failed to load tender");
    return res.json();
}

async function runEvaluation(id: string): Promise<void> {
    const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${id}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Evaluation failed");
}

export default function TenderEvaluationPage() {
    const params = useParams();
    const qc = useQueryClient();
    const [activeStage, setActiveStage] = useState("stage3");
    const [runningEval, setRunningEval] = useState(false);
    const [evalError, setEvalError] = useState("");
    const [modal, setModal] = useState<{ open: boolean; type: "accept" | "override" | "escalate"; findingId?: string; findingType: "pq" | "technical" | "financial" }>({
        open: false, type: "accept", findingType: "pq",
    });

    const { data: tenders = [] } = useQuery({ queryKey: ["tenders"], queryFn: fetchTenders });
    const tender = tenders[0]; // show first seeded tender

    const { data, isLoading } = useQuery({
        queryKey: ["tender", tender?.id],
        queryFn: () => fetchTender(tender!.id),
        enabled: !!tender?.id,
        refetchInterval: 30000,
    });

    function openModal(type: "accept" | "override" | "escalate", findingType: "pq" | "technical" | "financial", findingId?: string) {
        setModal({ open: true, type, findingType, findingId });
    }

    async function handleRunEvaluation() {
        if (!tender) return;
        setRunningEval(true); setEvalError("");
        try {
            await runEvaluation(tender.id);
            qc.invalidateQueries({ queryKey: ["tender", tender.id] });
        } catch (e) { setEvalError(e instanceof Error ? e.message : "Failed"); }
        finally { setRunningEval(false); }
    }

    if (!tender || isLoading) {
        return (
            <div className="space-y-4">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Tender Evaluation</h1>
                {isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
                ) : (
                    <p className="text-muted-foreground text-sm">No tenders found. Run the seed script: <code className="text-xs bg-muted px-1 rounded">npx tsx scripts/seed_tender_demo.ts</code></p>
                )}
            </div>
        );
    }

    const qualified = data?.pqFindings ? (() => {
        const bidderStatuses = new Map<string, boolean>();
        for (const f of data.pqFindings) {
            if (f.status === "not_qualified") bidderStatuses.set(f.bidderId, false);
            else if (!bidderStatuses.has(f.bidderId)) bidderStatuses.set(f.bidderId, true);
        }
        return Array.from(bidderStatuses.values()).filter(Boolean).length;
    })() : 0;

    return (
        <div className="space-y-6">
            {/* Cockpit header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 border text-xs font-mono">{tender.rfpNumber || DEMO_TENDER_REF}</Badge>
                        <Badge className="bg-muted/40 text-muted-foreground border-border border text-xs">{tender.evalMethod ?? "L1"}</Badge>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">{tender.title}</h1>
                    <p className="text-muted-foreground mt-1">{tender.department} · Budget: ₹{tender.budget ? (Number(tender.budget) / 1e7).toFixed(1) : "8.5"} Cr · {data?.bidders?.length ?? 3} bids received</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <Button onClick={handleRunEvaluation} disabled={runningEval} size="sm"
                        className="bg-primary text-primary-foreground gap-2">
                        {runningEval ? <><Loader2 className="w-4 h-4 animate-spin" />Running…</> : <><Play className="w-4 h-4" />Run Evaluation</>}
                    </Button>
                    {evalError && <p className="text-xs text-red-400 max-w-48 text-right">{evalError}</p>}
                </div>
            </div>

            {/* Bidder summary chips */}
            <div className="flex gap-3 flex-wrap">
                {(data?.bidders ?? []).map(b => (
                    <div key={b.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-card">
                        <span className="text-xs font-mono text-muted-foreground">{b.displayLabel}</span>
                        <span className="text-sm text-foreground">{b.name}</span>
                        <Badge className="text-xs border" style={{ background: b.status === "pq_disqualified" ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)", color: b.status === "pq_disqualified" ? "rgb(248,113,113)" : "rgb(74,222,128)", borderColor: b.status === "pq_disqualified" ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)" }}>
                            {b.status.replace("_", " ")}
                        </Badge>
                    </div>
                ))}
                {qualified > 0 && (
                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400">
                        {qualified} of {data?.bidders?.length ?? 3} qualified for financial stage
                    </div>
                )}
            </div>

            {/* Stage tabs */}
            <div className="flex gap-1 border-b border-border overflow-x-auto">
                {STAGES.map(s => {
                    const Icon = s.icon;
                    const isLight = s.id === "stage1" || s.id === "stage2";
                    return (
                        <button key={s.id} onClick={() => setActiveStage(s.id)}
                            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                                activeStage === s.id
                                    ? "border-primary text-primary"
                                    : isLight
                                        ? "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}>
                            <Icon className="w-4 h-4" />{s.label}
                        </button>
                    );
                })}
            </div>

            {/* Stage content */}
            <div>
                {activeStage === "stage1" && <Stage1Flashback />}
                {activeStage === "stage2" && <Stage2Flashback />}
                {activeStage === "stage3" && data && (
                    <PQPanel
                        bidders={data.bidders}
                        pqFindings={data.pqFindings}
                        onAction={(id) => openModal("accept", "pq", id)}
                    />
                )}
                {activeStage === "stage4" && data && (
                    <TechnicalPanel
                        tenderId={tender.id}
                        bidders={data.bidders.filter(b => b.status !== "pq_disqualified")}
                        technicalFindings={data.technicalFindings}
                        onAction={(id) => openModal("accept", "technical", id)}
                        onLiveRunComplete={() => qc.invalidateQueries({ queryKey: ["tender", tender.id] })}
                    />
                )}
                {activeStage === "stage5" && data && (
                    <ShortfallPanel
                        bidders={data.bidders}
                        shortfalls={data.shortfalls}
                        clarificationRequests={data.clarificationRequests}
                    />
                )}
                {activeStage === "stage6" && data && (
                    <FinancialPanel
                        bidders={data.bidders.filter(b => b.status !== "pq_disqualified")}
                        financialFindings={data.financialFindings}
                        onAction={(id) => openModal("accept", "financial", id)}
                    />
                )}
                {activeStage === "stage6" && data?.report && (
                    <Card className="mt-4 border-border bg-card">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-foreground">Evaluation Report — Recommendation</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-foreground">{data.report.recommendation}</p>
                            <div className="flex gap-2 mt-4">
                                <Button size="sm" variant="outline" className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                                    onClick={() => openModal("accept", "financial")}>Accept Report</Button>
                                <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                                    onClick={() => openModal("override", "financial")}>Override</Button>
                                <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                                    onClick={() => openModal("escalate", "financial")}>Escalate</Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            <ActionModal
                open={modal.open}
                onOpenChange={v => setModal(m => ({ ...m, open: v }))}
                actionType={modal.type}
                tenderId={tender.id}
                findingId={modal.findingId}
                findingType={modal.findingType}
                onSuccess={() => qc.invalidateQueries({ queryKey: ["tender", tender.id] })}
            />
        </div>
    );
}
