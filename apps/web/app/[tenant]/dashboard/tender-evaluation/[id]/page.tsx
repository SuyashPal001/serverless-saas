"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Play, FileText, Users, ClipboardList, ShieldCheck, AlertCircle, BarChart3, ArrowLeft } from "lucide-react";
import { Stage2Flashback } from "../components/StageFlashback";
import { PQPanel } from "../components/PQPanel";
import { TechnicalPanel } from "../components/TechnicalPanel";
import { ShortfallPanel } from "../components/ShortfallPanel";
import { FinancialPanel } from "../components/FinancialPanel";
import { ActionModal } from "../components/ActionModal";
import { AuthoringPanel } from "./authoring/AuthoringPanel";

interface TenderData {
    id: string; rfpNumber: string; title: string; department: string;
    budget: string; evalMethod: string; status: string;
    bidders: Array<{ id: string; name: string; displayLabel: string; status: string }>;
    pqFindings: Array<{ id: string; ruleId: string; ruleName: string; status: "qualified" | "not_qualified" | "cannot_evaluate"; provision: string; narration: string; declaredValue: string | null; thresholdValue: string | null; sourceDoc: string | null; sourcePage: number | null; bidderId: string }>;
    technicalFindings: Array<{ id: string; clauseNo: string; clauseTitle: string; status: "complied" | "deviation" | "not_found" | "cannot_evaluate"; narration: string; sourceDoc: string | null; sourcePage: number | null; rfpRequirement: string | null; bidderResponse: string | null; bidderId: string }>;
    shortfalls: Array<{ id: string; discrepancy: string; sourceDoc: string | null; sourcePage: number | null; status: string; bidderId: string }>;
    clarificationRequests: Array<{ id: string; shortfallId: string | null; bidderId: string; draftedText: string; deadlineDays: number; sentAt: string | null; responseText: string | null }>;
    financialFindings: Array<{ id: string; bidderId: string; boqLines: Array<{ item: string; rfpQty: number; unit: string; quotedRate: number; amount: number }>; totalAmount: string; arithmeticCorrection: string; correctedTotal: string; isL1: string; l1Margin: string | null; sourceDoc: string | null; sourcePage: number | null }>;
    report: { id: string; recommendation: string } | null;
}

const STAGES = [
    { id: "stage1", label: "1. Authoring", icon: FileText },
    { id: "stage2", label: "2. Pre-Bid", icon: Users },
    { id: "stage3", label: "3. PQ", icon: ShieldCheck },
    { id: "stage4", label: "4. Technical", icon: ClipboardList },
    { id: "stage5", label: "5. Shortfalls", icon: AlertCircle },
    { id: "stage6", label: "6. Financial", icon: BarChart3 },
];

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

export default function TenderWorkspacePage() {
    const params = useParams();
    const router = useRouter();
    const qc = useQueryClient();
    const tender_id = params.id as string;
    const tenant = params.tenant as string;

    const [activeStage, setActiveStage] = useState("stage1");
    const [runningEval, setRunningEval] = useState(false);
    const [evalError, setEvalError] = useState("");
    const [modal, setModal] = useState<{ open: boolean; type: "accept" | "override" | "escalate"; findingId?: string; findingType: "pq" | "technical" | "financial" }>({ open: false, type: "accept", findingType: "pq" });

    const { data, isLoading } = useQuery({
        queryKey: ["tender", tender_id],
        queryFn: () => fetchTender(tender_id),
        refetchInterval: 30000,
    });

    async function handleRunEvaluation() {
        setRunningEval(true); setEvalError("");
        try { await runEvaluation(tender_id); qc.invalidateQueries({ queryKey: ["tender", tender_id] }); }
        catch (e) { setEvalError(e instanceof Error ? e.message : "Failed"); }
        finally { setRunningEval(false); }
    }

    if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;
    if (!data) return <p className="text-sm text-muted-foreground">Tender not found.</p>;

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <button onClick={() => router.push(`/${tenant}/dashboard/tender-evaluation`)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2">
                        <ArrowLeft className="w-3 h-3" /> All Tenders
                    </button>
                    <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 border text-xs font-mono">{data.rfpNumber}</Badge>
                        <Badge className="bg-muted/40 text-muted-foreground border-border border text-xs">{data.evalMethod ?? "L1"}</Badge>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">{data.title}</h1>
                    <p className="text-muted-foreground mt-1">{data.department} · Budget: ₹{data.budget ? (Number(data.budget) / 1e7).toFixed(1) : "—"} Cr</p>
                </div>
                <Button onClick={handleRunEvaluation} disabled={runningEval} size="sm" className="bg-primary text-primary-foreground gap-2">
                    {runningEval ? <><Loader2 className="w-4 h-4 animate-spin" />Running…</> : <><Play className="w-4 h-4" />Run Evaluation</>}
                </Button>
            </div>

            {evalError && <p className="text-xs text-red-400">{evalError}</p>}

            <div className="flex gap-1 border-b border-border overflow-x-auto">
                {STAGES.map(s => {
                    const Icon = s.icon;
                    return (
                        <button key={s.id} onClick={() => setActiveStage(s.id)}
                            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeStage === s.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                            <Icon className="w-4 h-4" />{s.label}
                        </button>
                    );
                })}
            </div>

            <div>
                {activeStage === "stage1" && <AuthoringPanel tenderId={tender_id} />}
                {activeStage === "stage2" && <Stage2Flashback />}
                {activeStage === "stage3" && <PQPanel bidders={data.bidders} pqFindings={data.pqFindings} onAction={(id) => setModal({ open: true, type: "accept", findingType: "pq", findingId: id })} />}
                {activeStage === "stage4" && <TechnicalPanel tenderId={tender_id} bidders={data.bidders.filter(b => b.status !== "pq_disqualified")} technicalFindings={data.technicalFindings} onAction={(id) => setModal({ open: true, type: "accept", findingType: "technical", findingId: id })} onLiveRunComplete={() => qc.invalidateQueries({ queryKey: ["tender", tender_id] })} />}
                {activeStage === "stage5" && <ShortfallPanel bidders={data.bidders} shortfalls={data.shortfalls} clarificationRequests={data.clarificationRequests} />}
                {activeStage === "stage6" && <FinancialPanel bidders={data.bidders.filter(b => b.status !== "pq_disqualified")} financialFindings={data.financialFindings} onAction={(id) => setModal({ open: true, type: "accept", findingType: "financial", findingId: id })} />}
            </div>

            <ActionModal open={modal.open} onOpenChange={v => setModal(m => ({ ...m, open: v }))}
                actionType={modal.type} tenderId={tender_id} findingId={modal.findingId}
                findingType={modal.findingType}
                onSuccess={() => qc.invalidateQueries({ queryKey: ["tender", tender_id] })} />
        </div>
    );
}
