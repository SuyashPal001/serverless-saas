"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertTriangle, XCircle, Zap, Loader2, FileText } from "lucide-react";

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

export function TechnicalPanel({ tenderId, bidders, technicalFindings, onAction, onLiveRunComplete }: TechnicalPanelProps) {
    const [liveRunning, setLiveRunning] = useState(false);
    const [liveResults, setLiveResults] = useState<LiveResult[] | null>(null);
    const [liveError, setLiveError] = useState("");

    async function runLiveEvaluation() {
        setLiveRunning(true);
        setLiveError("");
        try {
            const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${tenderId}/technical/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
            const data = await res.json() as { techResults?: Array<{ clauses?: LiveResult[] }> };
            const clauses = data.techResults?.[0]?.clauses ?? [];
            setLiveResults(clauses);
            onLiveRunComplete();
        } catch (e) {
            setLiveError(e instanceof Error ? e.message : "Evaluation failed");
        } finally {
            setLiveRunning(false);
        }
    }

    // Show seeded findings if we have them, else show live button
    const liveBidder = bidders[0]; // InfraVision = first qualified bidder
    const seededFindings = liveBidder ? technicalFindings.filter(f => f.bidderId === liveBidder.id) : [];
    const displayClauses: LiveResult[] = liveResults ?? seededFindings.map(f => ({
        clauseNo: f.clauseNo, clauseTitle: f.clauseTitle, status: f.status,
        narration: f.narration, sourceDoc: f.sourceDoc, sourcePage: f.sourcePage,
    }));

    const complied = displayClauses.filter(c => c.status === "complied").length;
    const deviations = displayClauses.filter(c => c.status === "deviation").length;
    const notFound = displayClauses.filter(c => c.status === "not_found").length;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    Clause-wise compliance evaluation against RFP technical requirements. Stage 4 runs live via the inference gateway.
                </p>
                <Button onClick={runLiveEvaluation} disabled={liveRunning} size="sm"
                    className="bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 gap-2">
                    {liveRunning ? <><Loader2 className="w-4 h-4 animate-spin" />Evaluating…</> : <><Zap className="w-4 h-4" />Run Live Evaluation</>}
                </Button>
            </div>

            {liveError && <p className="text-xs text-red-400 p-2 rounded bg-red-500/10 border border-red-500/20">{liveError}</p>}
            {liveResults && <p className="text-xs text-green-400 p-2 rounded bg-green-500/10 border border-green-500/20">✓ Live evaluation completed via inference gateway — {liveResults.length} clauses assessed</p>}

            {/* Summary chips */}
            <div className="flex gap-3">
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
                {liveBidder && <span className="text-xs text-muted-foreground self-center">— {liveBidder.displayLabel}: {liveBidder.name}</span>}
            </div>

            {/* Clause table */}
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
        </div>
    );
}
