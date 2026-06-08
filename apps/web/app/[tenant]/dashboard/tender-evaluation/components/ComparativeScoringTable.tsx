"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import type { BidderTechnicalScore } from "./types";

interface TechFinding {
    id: string; clauseNo: string; clauseTitle: string;
    status: "complied" | "deviation" | "not_found" | "cannot_evaluate";
    narration: string; sourceDoc: string | null; sourcePage: number | null;
    rfpRequirement: string | null; bidderResponse: string | null;
    bidderId: string;
}

interface ComparativeScoringTableProps {
    bidders: Array<{ id: string; displayLabel: string; name: string }>;
    technicalFindings: TechFinding[];
    bidderScores: BidderTechnicalScore[];
    weights: Record<string, number>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    complied: { label: "Complied", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: CheckCircle },
    deviation: { label: "Deviation", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: AlertTriangle },
    not_found: { label: "Not Found", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle },
    cannot_evaluate: { label: "N/E", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30", icon: XCircle },
};

export function ComparativeScoringTable({ bidders, technicalFindings, bidderScores, weights }: ComparativeScoringTableProps) {
    // Only bidders that have at least one finding
    const qualifiedBidders = bidders.filter(b =>
        technicalFindings.some(f => f.bidderId === b.id)
    );

    // Distinct ordered clauses from findings
    const clauseMap = new Map<string, string>();
    technicalFindings.forEach(f => {
        if (!clauseMap.has(f.clauseNo)) clauseMap.set(f.clauseNo, f.clauseTitle);
    });
    const clauses = Array.from(clauseMap.entries()).map(([clauseNo, clauseTitle]) => ({ clauseNo, clauseTitle }));

    if (qualifiedBidders.length === 0 || clauses.length === 0) return null;

    // Score lookup: bidderId → breakdown map
    const scoreMap = new Map(bidderScores.map(s => [s.bidderId, s]));

    // Finding lookup: bidderId+clauseNo → finding
    const findingLookup = new Map<string, TechFinding>();
    technicalFindings.forEach(f => findingLookup.set(`${f.bidderId}:${f.clauseNo}`, f));

    return (
        <Card className="border-border bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                    Comparative Technical Evaluation Statement
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="text-left py-2 px-4 font-medium w-16">Clause</th>
                                <th className="text-left py-2 px-4 font-medium">Criterion</th>
                                <th className="text-left py-2 px-4 font-medium w-16">Weight</th>
                                {qualifiedBidders.map(b => (
                                    <th key={b.id} className="text-left py-2 px-4 font-medium whitespace-nowrap">
                                        {b.displayLabel}: {b.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {clauses.map(c => {
                                const weight = weights[c.clauseNo] ?? 0;
                                return (
                                    <tr key={c.clauseNo} className="border-b border-border/40 hover:bg-muted/20">
                                        <td className="py-2 px-4 font-mono text-muted-foreground">{c.clauseNo}</td>
                                        <td className="py-2 px-4 text-foreground">{c.clauseTitle}</td>
                                        <td className="py-2 px-4 text-muted-foreground">{weight}%</td>
                                        {qualifiedBidders.map(b => {
                                            const finding = findingLookup.get(`${b.id}:${c.clauseNo}`);
                                            const scoreEntry = scoreMap.get(b.id);
                                            const breakdownItem = scoreEntry?.breakdown.find(x => x.clauseNo === c.clauseNo);
                                            const status = finding?.status ?? "cannot_evaluate";
                                            const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.cannot_evaluate;
                                            const Icon = cfg.icon;
                                            const pts = Number(breakdownItem?.points ?? 0);
                                            return (
                                                <td key={b.id} className="py-2 px-4">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <Badge className={`${cfg.color} border gap-1 whitespace-nowrap`}>
                                                            <Icon className="w-3 h-3" />
                                                            {cfg.label}
                                                        </Badge>
                                                        <span className="text-muted-foreground">→ {pts.toFixed(1)}</span>
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                            {/* Total row */}
                            <tr className="border-t-2 border-border font-bold bg-muted/10">
                                <td className="py-2 px-4" colSpan={2}>
                                    <span className="text-foreground">Total</span>
                                </td>
                                <td className="py-2 px-4 text-foreground">100%</td>
                                {qualifiedBidders.map(b => {
                                    const score = scoreMap.get(b.id);
                                    return (
                                        <td key={b.id} className="py-2 px-4 text-foreground">
                                            {score ? `${Number(score.technicalScore).toFixed(1)} / 100` : "—"}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-muted-foreground px-4 py-2 border-t border-border/40 italic">
                    Display &amp; audit only — L1 award is by lowest financial total.
                </p>
            </CardContent>
        </Card>
    );
}
