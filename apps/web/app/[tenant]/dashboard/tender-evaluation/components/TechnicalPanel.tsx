"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertTriangle, XCircle, Zap, Loader2, FileText } from "lucide-react";
import { ScoringConfigEditor } from "./ScoringConfigEditor";
import { ComparativeScoringTable } from "./ComparativeScoringTable";
import type { BidderTechnicalScore } from "./types";

interface TechFinding {
    id: string; clauseNo: string; clauseTitle: string;
    status: "complied" | "deviation" | "not_found" | "cannot_evaluate";
    narration: string; sourceDoc: string | null; sourcePage: number | null;
    rfpRequirement: string | null; bidderResponse: string | null;
    bidderId: string;
}

interface Bidder {
    id: string; name: string; displayLabel: string;
}

interface TechnicalPanelProps {
    tenderId: string;
    bidders: Bidder[];
    technicalFindings: TechFinding[];
    scoringConfig: { weights: Record<string, number> } | null;
    bidderTechnicalScores: BidderTechnicalScore[];
    onAction: (findingId: string, findingType: "technical") => void;
    onLiveRunComplete: () => void;
}

const CLAUSE_CONFIG = {
    complied: { label: "Complied", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: CheckCircle },
    deviation: { label: "Deviation", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: AlertTriangle },
    not_found: { label: "Not Found", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle },
    cannot_evaluate: { label: "Cannot Evaluate", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30", icon: XCircle },
};

interface LiveResult {
    clauseNo: string; clauseTitle: string;
    status: "complied" | "deviation" | "not_found" | "cannot_evaluate";
    narration: string; sourceDoc: string | null; sourcePage: number | null;
}

// Derive distinct ordered clauses from all findings across all bidders
function deriveDistinctClauses(findings: TechFinding[]) {
    const seen = new Map<string, string>();
    findings.forEach(f => { if (!seen.has(f.clauseNo)) seen.set(f.clauseNo, f.clauseTitle); });
    return Array.from(seen.entries()).map(([clauseNo, clauseTitle]) => ({ clauseNo, clauseTitle }));
}

export function TechnicalPanel({
    tenderId, bidders, technicalFindings, scoringConfig,
    bidderTechnicalScores, onAction, onLiveRunComplete,
}: TechnicalPanelProps) {
    const [selectedBidderId, setSelectedBidderId] = useState(bidders[0]?.id ?? "");
    const [liveRunning, setLiveRunning] = useState(false);
    const [liveResults, setLiveResults] = useState<LiveResult[] | null>(null);
    const [liveError, setLiveError] = useState("");
    const [localScores, setLocalScores] = useState<BidderTechnicalScore[]>(bidderTechnicalScores);

    const selectedBidder = bidders.find(b => b.id === selectedBidderId) ?? bidders[0];

    async function runLiveEvaluation() {
        setLiveRunning(true);
        setLiveError("");
        try {
            const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${tenderId}/technical/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bidderId: selectedBidder?.id }),
            });
            if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
            const data = await res.json() as { techResults?: Array<{ clauses?: LiveResult[] }> };
            setLiveResults(data.techResults?.[0]?.clauses ?? []);
            onLiveRunComplete();
        } catch (e) {
            setLiveError(e instanceof Error ? e.message : "Evaluation failed");
        } finally {
            setLiveRunning(false);
        }
    }

    const seededFindings = selectedBidder
        ? technicalFindings.filter(f => f.bidderId === selectedBidder.id)
        : [];
    const displayClauses: LiveResult[] = liveResults ?? seededFindings.map(f => ({
        clauseNo: f.clauseNo, clauseTitle: f.clauseTitle, status: f.status,
        narration: f.narration, sourceDoc: f.sourceDoc, sourcePage: f.sourcePage,
    }));

    const complied = displayClauses.filter(c => c.status === "complied").length;
    const deviations = displayClauses.filter(c => c.status === "deviation").length;
    const notFound = displayClauses.filter(c => c.status === "not_found").length;

    const selectedScore = localScores.find(s => s.bidderId === selectedBidder?.id);

    // Compute effective weights for the comparative table
    const distinctClauses = deriveDistinctClauses(technicalFindings);
    const initWeights = scoringConfig?.weights ?? {};
    const effectiveWeights: Record<string, number> = Object.keys(initWeights).length > 0
        ? initWeights
        : (() => {
            const n = distinctClauses.length;
            if (n === 0) return {};
            const base = Math.floor((100 / n) * 10) / 10;
            const w: Record<string, number> = {};
            let assigned = 0;
            distinctClauses.forEach((c, i) => {
                if (i === n - 1) { w[c.clauseNo] = Math.round((100 - assigned) * 10) / 10; }
                else { w[c.clauseNo] = base; assigned += base; }
            });
            return w;
        })();

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    Clause-wise compliance evaluation against RFP technical requirements.
                </p>
                <Button onClick={runLiveEvaluation} disabled={liveRunning} size="sm"
                    className="bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 gap-2">
                    {liveRunning ? <><Loader2 className="w-4 h-4 animate-spin" />Evaluating…</> : <><Zap className="w-4 h-4" />Run Live Evaluation</>}
                </Button>
            </div>

            {bidders.length > 1 && (
                <div className="flex gap-1 flex-wrap">
                    {bidders.map(b => (
                        <button key={b.id} onClick={() => { setSelectedBidderId(b.id); setLiveResults(null); }}
                            className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${b.id === selectedBidderId ? "bg-primary/20 text-primary border-primary/30" : "text-muted-foreground border-border hover:text-foreground hover:border-border/80"}`}>
                            {b.displayLabel}: {b.name}
                        </button>
                    ))}
                </div>
            )}

            {liveError && <p className="text-xs text-red-400 p-2 rounded bg-red-500/10 border border-red-500/20">{liveError}</p>}
            {liveResults && (
                <p className="text-xs text-green-400 p-2 rounded bg-green-500/10 border border-green-500/20">
                    ✓ Live evaluation completed for {selectedBidder?.displayLabel} — {liveResults.length} clauses assessed
                </p>
            )}

            <div className="flex gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
                    <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-xs text-green-400 font-medium">{complied} Complied</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs text-amber-400 font-medium">{deviations} Deviation{deviations !== 1 ? "s" : ""}</span>
                </div>
                {notFound > 0 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                        <span className="text-xs text-red-400 font-medium">{notFound} Not Found</span>
                    </div>
                )}
                {selectedBidder && <span className="text-xs text-muted-foreground self-center">— {selectedBidder.displayLabel}: {selectedBidder.name}</span>}
                {selectedScore && (
                    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 border self-center text-xs">
                        Technical Score: {selectedScore.technicalScore.toFixed(1)} / 100
                    </Badge>
                )}
            </div>

            <ScoringConfigEditor
                tenderId={tenderId}
                clauses={distinctClauses}
                initialWeights={initWeights}
                onSaved={scores => setLocalScores(scores)}
            />

            <Card className="border-border bg-card">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-foreground">Clause-wise Compliance Sheet</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="text-left py-2 px-4 font-medium w-16">Clause</th>
                                    <th className="text-left py-2 px-4 font-medium">Requirement</th>
                                    <th className="text-left py-2 px-4 font-medium">Status</th>
                                    <th className="text-left py-2 px-4 font-medium">Finding</th>
                                    <th className="text-left py-2 px-4 font-medium">Source</th>
                                    <th className="text-left py-2 px-4 font-medium w-20">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayClauses.map((c, i) => {
                                    const cfg = CLAUSE_CONFIG[c.status];
                                    const Icon = cfg.icon;
                                    const seededFinding = seededFindings.find(f => f.clauseNo === c.clauseNo);
                                    return (
                                        <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                                            <td className="py-2 px-4 font-mono text-muted-foreground">{c.clauseNo}</td>
                                            <td className="py-2 px-4 text-foreground">{c.clauseTitle}</td>
                                            <td className="py-2 px-4">
                                                <Badge className={`${cfg.color} border gap-1 whitespace-nowrap`}>
                                                    <Icon className="w-3 h-3" />{cfg.label}
                                                </Badge>
                                            </td>
                                            <td className="py-2 px-4 text-muted-foreground max-w-xs">{c.narration}</td>
                                            <td className="py-2 px-4">
                                                {c.sourceDoc && (
                                                    <div className="flex items-center gap-1 text-blue-400">
                                                        <FileText className="w-3 h-3" />
                                                        <span>{c.sourceDoc}{c.sourcePage ? `, p.${c.sourcePage}` : ""}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-2 px-4">
                                                {seededFinding && (
                                                    <button onClick={() => onAction(seededFinding.id, "technical")}
                                                        className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">
                                                        Act
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {localScores.length > 0 && (
                <ComparativeScoringTable
                    bidders={bidders}
                    technicalFindings={technicalFindings}
                    bidderScores={localScores}
                    weights={effectiveWeights}
                />
            )}
        </div>
    );
}
