"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, HelpCircle, FileText, Clock } from "lucide-react";

interface PqFinding {
    id: string; ruleId: string; ruleName: string;
    status: "qualified" | "not_qualified" | "cannot_evaluate";
    provision: string; narration: string;
    declaredValue: string | null; thresholdValue: string | null;
    sourceDoc: string | null; sourcePage: number | null;
    bidderId: string;
}

interface Bidder {
    id: string; name: string; displayLabel: string; status: string;
}

interface PQPanelProps {
    bidders: Bidder[];
    pqFindings: PqFinding[];
    onAction: (findingId: string, findingType: "pq") => void;
}

type BidderPqStatus = "qualified" | "not_qualified" | "cannot_evaluate" | "pending";

const FINDING_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    qualified: { label: "Qualified", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: CheckCircle },
    not_qualified: { label: "Not Qualified", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle },
    cannot_evaluate: { label: "Cannot Evaluate", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30", icon: HelpCircle },
    pending: { label: "Awaiting Evaluation", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: Clock },
};

const BIDDER_STATUS_COLOR: Record<BidderPqStatus, string> = {
    qualified: "bg-green-500/20 text-green-400 border-green-500/30",
    not_qualified: "bg-red-500/20 text-red-400 border-red-500/30",
    cannot_evaluate: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    pending: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

function getBidderPqStatus(bidderId: string, findings: PqFinding[]): BidderPqStatus {
    const bidderFindings = findings.filter(f => f.bidderId === bidderId);
    if (!bidderFindings.length) return "pending";
    if (bidderFindings.some(f => f.status === "not_qualified")) return "not_qualified";
    if (bidderFindings.some(f => f.status === "cannot_evaluate")) return "cannot_evaluate";
    return "qualified";
}

export function PQPanel({ bidders, pqFindings, onAction }: PQPanelProps) {
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Pre-Qualification scrutiny against GFR 2017 eligibility criteria. Each criterion cites the source document and page.
            </p>

            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3">
                {bidders.map(b => {
                    const bStatus = getBidderPqStatus(b.id, pqFindings);
                    const cfg = FINDING_CONFIG[bStatus];
                    const Icon = cfg.icon;
                    return (
                        <div key={b.id} className="p-3 rounded-lg border border-border/50 bg-card">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-mono text-muted-foreground">{b.displayLabel}</span>
                                <Badge className={`${BIDDER_STATUS_COLOR[bStatus]} border text-xs`}>
                                    <Icon className="w-3 h-3 mr-1" />{cfg.label}
                                </Badge>
                            </div>
                            <p className="text-sm font-medium text-foreground truncate">{b.name}</p>
                        </div>
                    );
                })}
            </div>

            {/* Per-bidder findings */}
            {bidders.map(b => {
                const bidderFindings = pqFindings.filter(f => f.bidderId === b.id);
                if (!bidderFindings.length) return null;
                return (
                    <Card key={b.id} className="border-border bg-card">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-foreground">
                                {b.displayLabel} — {b.name}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {bidderFindings.map(f => {
                                const cfg = FINDING_CONFIG[f.status];
                                const Icon = cfg.icon;
                                return (
                                    <div key={f.id} className="p-3 rounded-lg border border-border/40 bg-muted/10">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <Icon className={`w-4 h-4 flex-shrink-0 ${cfg.color.split(' ')[1]}`} />
                                                <span className="text-sm font-medium text-foreground">{f.ruleName}</span>
                                                <span className="text-xs font-mono text-muted-foreground">({f.ruleId})</span>
                                            </div>
                                            <Badge className={`${cfg.color} border text-xs flex-shrink-0`}>{cfg.label}</Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-2">{f.narration}</p>
                                        {f.declaredValue && f.thresholdValue && (
                                            <div className="flex gap-4 mt-2 text-xs">
                                                <span className="text-muted-foreground">Declared: <span className={f.status === "qualified" ? "text-green-400" : "text-red-400"}>{f.declaredValue}</span></span>
                                                <span className="text-muted-foreground">Required: <span className="text-foreground">{f.thresholdValue}</span></span>
                                            </div>
                                        )}
                                        {f.sourceDoc && (
                                            <div className="flex items-center gap-1 mt-2 text-xs text-blue-400">
                                                <FileText className="w-3 h-3" />
                                                <span>{f.sourceDoc}{f.sourcePage ? `, p.${f.sourcePage}` : ""}</span>
                                            </div>
                                        )}
                                        <p className="text-xs text-muted-foreground mt-1 italic">{f.provision}</p>
                                        <button
                                            onClick={() => onAction(f.id, "pq")}
                                            className="mt-2 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                                        >
                                            Officer action →
                                        </button>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
