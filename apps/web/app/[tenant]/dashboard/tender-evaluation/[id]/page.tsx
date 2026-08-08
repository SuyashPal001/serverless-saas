"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Play, FileText, Users, ClipboardList, ShieldCheck, AlertCircle, BarChart3, ArrowLeft, ScrollText, Upload, CheckCircle2, FileCheck2, FileSignature, ClipboardCheck } from "lucide-react";
import { PreBidPanel } from "../components/PreBidPanel";
import { BidsPanel } from "../components/BidsPanel";
import { PQPanel } from "../components/PQPanel";
import { TechnicalPanel } from "../components/TechnicalPanel";
import { ShortfallPanel } from "../components/ShortfallPanel";
import { FinancialPanel } from "../components/FinancialPanel";
import { ActionModal } from "../components/ActionModal";
import { ReportPanel } from "../components/ReportPanel";
import { DocumentCheckPanel } from "../components/DocumentCheckPanel";
import { ProposalPanel } from "../components/ProposalPanel";
import { ContractPanel } from "../components/ContractPanel";
import { ApprovalPanel } from "../components/ApprovalPanel";
import { AuthoringPanel } from "./authoring/AuthoringPanel";

interface EvalProgress {
    status: 'pending' | 'running' | 'completed';
    stages: { pq: string; technical: string; shortfall: string; financial: string; report: string };
}

interface TenderData {
    id: string; rfpNumber: string; title: string; department: string;
    budget: string; evalMethod: string; status: string;
    bidders: Array<{ id: string; name: string; displayLabel: string; status: string; embeddingReady: boolean }>;
    pqFindings: Array<{ id: string; ruleId: string; ruleName: string; status: "qualified" | "not_qualified" | "cannot_evaluate"; provision: string; narration: string; declaredValue: string | null; thresholdValue: string | null; sourceDoc: string | null; sourcePage: number | null; bidderId: string }>;
    technicalFindings: Array<{ id: string; clauseNo: string; clauseTitle: string; status: "complied" | "deviation" | "not_found" | "cannot_evaluate"; narration: string; sourceDoc: string | null; sourcePage: number | null; rfpRequirement: string | null; bidderResponse: string | null; bidderId: string }>;
    shortfalls: Array<{ id: string; discrepancy: string; sourceDoc: string | null; sourcePage: number | null; status: string; bidderId: string }>;
    clarificationRequests: Array<{ id: string; shortfallId: string | null; bidderId: string; draftedText: string; deadlineDays: number; sentAt: string | null; responseText: string | null }>;
    financialFindings: Array<{ id: string; bidderId: string; boqLines: Array<{ item: string; rfpQty: number; unit: string; quotedRate: number; amount: number }>; totalAmount: string; arithmeticCorrection: string; correctedTotal: string; isL1: string; l1Margin: string | null; sourceDoc: string | null; sourcePage: number | null }>;
    report: { id: string; recommendation: string } | null;
    evalProgress?: EvalProgress;
    scoringConfig: { weights: Record<string, number> } | null;
    bidderTechnicalScores: Array<{ bidderId: string; technicalScore: number; breakdown: Array<{ clauseNo: string; weight: number; status: string; points: number }> }>;
}

const STAGES = [
    { id: "stage1", label: "1. Authoring", icon: FileText },
    { id: "stage2", label: "2. Pre-Bid", icon: Users },
    { id: "stage3", label: "3. Bids", icon: Upload },
    { id: "stage4", label: "4. PQ", icon: ShieldCheck },
    { id: "stage5", label: "5. Technical", icon: ClipboardList },
    { id: "stage6", label: "6. Shortfalls", icon: AlertCircle },
    { id: "stage7", label: "7. Financial", icon: BarChart3 },
    { id: "stage8", label: "8. Report", icon: ScrollText },
    { id: "stage9", label: "9. Document Check", icon: FileCheck2 },
    { id: "stage10", label: "10. Proposal", icon: FileText },
    { id: "stage11", label: "11. Contract", icon: FileSignature },
    { id: "stage12", label: "12. Approval", icon: ClipboardCheck },
];

interface ContractSummary { id: string; version: number; generatedAt: string }

const EVAL_STAGES: Array<{ key: keyof EvalProgress['stages']; label: string }> = [
    { key: 'pq', label: 'PQ' },
    { key: 'technical', label: 'Technical' },
    { key: 'shortfall', label: 'Shortfall' },
    { key: 'financial', label: 'Financial' },
    { key: 'report', label: 'Report' },
];

async function safeJson(res: Response): Promise<Record<string, unknown>> {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return {};
    return res.json();
}

async function fetchTender(id: string): Promise<TenderData> {
    const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${id}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) throw new Error("Failed to load tender");
    if (!res.ok) throw new Error("Failed to load tender");
    return res.json();
}

async function runEvaluation(id: string): Promise<void> {
    const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${id}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) {
        const d = await safeJson(res);
        throw new Error(String(d.error ?? `Server error ${res.status}`));
    }
}

export default function TenderWorkspacePage() {
    const params = useParams();
    const router = useRouter();
    const qc = useQueryClient();
    const tender_id = params.id as string;
    const tenant = params.tenant as string;

    const [activeStage, setActiveStage] = useState("stage1");
    const [runningEval, setRunningEval] = useState(false);
    const [evalRunning, setEvalRunning] = useState(false);
    const [evalError, setEvalError] = useState("");
    const [evalStalled, setEvalStalled] = useState(false);
    const [modal, setModal] = useState<{ open: boolean; type: "accept" | "override" | "escalate"; findingId?: string; findingType: "pq" | "technical" | "financial" }>({ open: false, type: "accept", findingType: "pq" });
    const evalStartedAt = useRef<number | null>(null);

    const { data, isLoading } = useQuery({
        queryKey: ["tender", tender_id],
        queryFn: () => fetchTender(tender_id),
        refetchInterval: (query) => {
            if (evalRunning) return 3000;
            const d = query.state.data;
            if ((d?.bidders?.length ?? 0) > 0 && d?.bidders?.some(b => !b.embeddingReady)) return 5000;
            return 30000;
        },
    });

    // Minimal page-level fetch to derive the latest contract id for the Approval tab —
    // mirrors ContractPanel's own query rather than duplicating its business logic.
    const { data: contractData } = useQuery({
        queryKey: ["contract", tender_id],
        queryFn: () => fetch(`/api/proxy/api/v1/tender/${tender_id}/contract`).then(r => r.json()),
        enabled: activeStage === "stage12",
    });
    const latestContractId: string | null = (contractData?.contracts as ContractSummary[] | undefined)?.[0]?.id ?? null;

    const anyProcessing = (data?.bidders?.length ?? 0) > 0 && (data?.bidders?.some(b => !b.embeddingReady) ?? false);

    // Auto-clear evalRunning once all stages complete
    const allDone = data?.evalProgress?.status === 'completed';
    useEffect(() => {
        if (evalRunning && allDone) {
            setEvalRunning(false);
            setEvalStalled(false);
            evalStartedAt.current = null;
        }
    }, [evalRunning, allDone]);

    // Soft stall detection after 120s
    useEffect(() => {
        if (!evalRunning) { setEvalStalled(false); return; }
        const t = setTimeout(() => setEvalStalled(true), 120_000);
        return () => clearTimeout(t);
    }, [evalRunning]);

    async function handleRunEvaluation() {
        setRunningEval(true); setEvalError(""); setEvalStalled(false);
        try {
            await runEvaluation(tender_id);
            setEvalRunning(true);
            evalStartedAt.current = Date.now();
            qc.invalidateQueries({ queryKey: ["tender", tender_id] });
        } catch (e) {
            setEvalError(e instanceof Error ? e.message : "Failed");
        } finally {
            setRunningEval(false);
        }
    }

    if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;
    if (!data) return <p className="text-sm text-muted-foreground">Tender not found.</p>;

    const stages = data.evalProgress?.stages;

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
                <Button
                    onClick={handleRunEvaluation}
                    disabled={runningEval || (data?.bidders?.length ?? 0) === 0 || anyProcessing}
                    title={anyProcessing ? "Wait for all bids to finish processing" : (data?.bidders?.length ?? 0) === 0 ? "Upload at least one bid to run evaluation" : undefined}
                    size="sm" className="bg-primary text-primary-foreground gap-2"
                >
                    {runningEval ? <><Loader2 className="w-4 h-4 animate-spin" />Running…</> : <><Play className="w-4 h-4" />Run Evaluation</>}
                </Button>
            </div>

            {evalError && <p className="text-xs text-red-400">{evalError}</p>}

            {evalRunning && !evalError && (
                <div className="flex flex-wrap items-center gap-3 text-xs bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-amber-400 font-medium shrink-0">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Evaluating…
                    </div>
                    <div className="flex items-center gap-1">
                        {EVAL_STAGES.map((s, i) => {
                            const done = stages?.[s.key] === 'done';
                            return (
                                <Fragment key={s.key}>
                                    {i > 0 && <span className="text-muted-foreground/40 mx-0.5">→</span>}
                                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium transition-colors ${done ? 'bg-green-500/20 border-green-500/30 text-green-400' : 'bg-muted/20 border-border text-muted-foreground'}`}>
                                        {done
                                            ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                                            : <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                                        {s.label}
                                    </span>
                                </Fragment>
                            );
                        })}
                    </div>
                    {evalStalled && (
                        <span className="text-muted-foreground ml-1">
                            Still running — <button onClick={handleRunEvaluation} className="underline hover:text-foreground">retry</button>
                        </span>
                    )}
                </div>
            )}

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
                {activeStage === "stage2" && <PreBidPanel tenderId={tender_id} />}
                {activeStage === "stage3" && <BidsPanel tenderId={tender_id} bidders={data.bidders} onBidderAdded={() => qc.invalidateQueries({ queryKey: ["tender", tender_id] })} />}
                {activeStage === "stage4" && <PQPanel bidders={data.bidders} pqFindings={data.pqFindings} onAction={(id) => setModal({ open: true, type: "accept", findingType: "pq", findingId: id })} />}
                {activeStage === "stage5" && <TechnicalPanel tenderId={tender_id} bidders={data.bidders.filter(b => b.status !== "pq_disqualified")} technicalFindings={data.technicalFindings} scoringConfig={data.scoringConfig ?? null} bidderTechnicalScores={data.bidderTechnicalScores ?? []} onAction={(id) => setModal({ open: true, type: "accept", findingType: "technical", findingId: id })} />}
                {activeStage === "stage6" && <ShortfallPanel bidders={data.bidders} shortfalls={data.shortfalls} clarificationRequests={data.clarificationRequests} />}
                {activeStage === "stage7" && <FinancialPanel bidders={data.bidders} financialFindings={data.financialFindings} onAction={(id) => setModal({ open: true, type: "accept", findingType: "financial", findingId: id })} />}
                {activeStage === "stage8" && <ReportPanel tender={{ rfpNumber: data.rfpNumber, title: data.title, department: data.department }} bidders={data.bidders} pqFindings={data.pqFindings} technicalFindings={data.technicalFindings} financialFindings={data.financialFindings} report={data.report} />}
                {activeStage === "stage9" && <DocumentCheckPanel tenderId={tender_id} />}
                {activeStage === "stage10" && <ProposalPanel tenderId={tender_id} />}
                {activeStage === "stage11" && <ContractPanel tenderId={tender_id} />}
                {activeStage === "stage12" && <ApprovalPanel tenderId={tender_id} contractId={latestContractId} />}
            </div>

            <ActionModal open={modal.open} onOpenChange={v => setModal(m => ({ ...m, open: v }))}
                actionType={modal.type} tenderId={tender_id} findingId={modal.findingId}
                findingType={modal.findingType}
                onSuccess={() => qc.invalidateQueries({ queryKey: ["tender", tender_id] })} />
        </div>
    );
}
