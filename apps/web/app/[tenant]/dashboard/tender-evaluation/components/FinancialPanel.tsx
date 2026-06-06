"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, FileText } from "lucide-react";

interface BOQLine {
    item: string; rfpQty: number; unit: string; quotedRate: number; amount: number;
}

interface FinancialFinding {
    id: string; bidderId: string;
    boqLines: BOQLine[]; totalAmount: string;
    arithmeticCorrection: string; correctedTotal: string;
    isL1: string; l1Margin: string | null;
    sourceDoc: string | null; sourcePage: number | null;
}

interface Bidder {
    id: string; name: string; displayLabel: string;
}

interface FinancialPanelProps {
    bidders: Bidder[];
    financialFindings: FinancialFinding[];
    onAction: (findingId: string, findingType: "financial") => void;
}

function formatCrore(rupees: number): string {
    return `₹${(rupees / 1e7).toFixed(2)} Cr`;
}

function formatLakh(rupees: number): string {
    return rupees.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

export function FinancialPanel({ bidders, financialFindings, onAction }: FinancialPanelProps) {
    const bidderMap = new Map(bidders.map(b => [b.id, b]));
    const l1Finding = financialFindings.find(f => f.isL1 === "yes");

    if (!financialFindings.length) {
        return (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                Financial evaluation not yet run. Complete PQ and Technical stages first.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Financial envelopes opened for PQ-qualified, technically evaluated bidders. L1 determined by lowest corrected total (GFR 2017 Rule 166).
            </p>

            {/* L1 banner */}
            {l1Finding && (
                <div className="flex items-center gap-3 p-4 rounded-lg border border-green-500/30 bg-green-500/5">
                    <Trophy className="w-5 h-5 text-green-400 flex-shrink-0" />
                    <div>
                        <p className="text-sm font-semibold text-green-400">
                            L1 Determined: {bidderMap.get(l1Finding.bidderId)?.name} ({bidderMap.get(l1Finding.bidderId)?.displayLabel})
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Corrected total: {formatCrore(Number(l1Finding.correctedTotal))} · Recommended for award subject to officer approval
                        </p>
                    </div>
                </div>
            )}

            {/* Comparison table */}
            <Card className="border-border bg-card">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-foreground">BOQ Comparison Statement</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="text-left py-2 px-4 font-medium">Item</th>
                                    <th className="text-left py-2 px-4 font-medium">Qty</th>
                                    <th className="text-left py-2 px-4 font-medium">Unit</th>
                                    {financialFindings.map(f => (
                                        <th key={f.id} className="text-right py-2 px-4 font-medium">
                                            {bidderMap.get(f.bidderId)?.displayLabel}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {(financialFindings[0]?.boqLines ?? []).map((line, i) => (
                                    <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                                        <td className="py-2 px-4 text-foreground">{line.item}</td>
                                        <td className="py-2 px-4 text-muted-foreground">{line.rfpQty}</td>
                                        <td className="py-2 px-4 text-muted-foreground">{line.unit}</td>
                                        {financialFindings.map(f => {
                                            const bl = f.boqLines[i];
                                            return (
                                                <td key={f.id} className="py-2 px-4 text-right text-foreground font-mono">
                                                    {bl ? formatLakh(bl.amount) : "—"}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                                {/* Totals row */}
                                <tr className="border-b border-border bg-muted/10 font-semibold">
                                    <td className="py-2 px-4 text-foreground" colSpan={3}>Total Bid Value</td>
                                    {financialFindings.map(f => (
                                        <td key={f.id} className="py-2 px-4 text-right text-foreground font-mono">
                                            {formatCrore(Number(f.totalAmount))}
                                        </td>
                                    ))}
                                </tr>
                                {/* Corrected total */}
                                <tr className="font-semibold">
                                    <td className="py-2 px-4 text-foreground" colSpan={3}>Corrected Total</td>
                                    {financialFindings.map(f => (
                                        <td key={f.id} className={`py-2 px-4 text-right font-mono ${f.isL1 === "yes" ? "text-green-400" : "text-foreground"}`}>
                                            {formatCrore(Number(f.correctedTotal))}
                                            {f.isL1 === "yes" && <span className="ml-1 text-green-400">★ L1</span>}
                                        </td>
                                    ))}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Per-bidder detail cards */}
            {financialFindings.map(f => {
                const bidder = bidderMap.get(f.bidderId);
                const margin = f.l1Margin ? Number(f.l1Margin) : null;
                return (
                    <Card key={f.id} className={`border-border bg-card ${f.isL1 === "yes" ? "border-green-500/40" : ""}`}>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-semibold text-foreground">
                                    {bidder?.displayLabel} — {bidder?.name}
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    {f.isL1 === "yes" && (
                                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border">L1</Badge>
                                    )}
                                    {margin != null && (
                                        <span className="text-xs text-muted-foreground">+{formatCrore(margin)} above L1</span>
                                    )}
                                    {f.sourceDoc && (
                                        <div className="flex items-center gap-1 text-xs text-blue-400">
                                            <FileText className="w-3 h-3" />
                                            <span>{f.sourceDoc}{f.sourcePage ? `, p.${f.sourcePage}` : ""}</span>
                                        </div>
                                    )}
                                    <button onClick={() => onAction(f.id, "financial")}
                                        className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">
                                        Officer action →
                                    </button>
                                </div>
                            </div>
                        </CardHeader>
                    </Card>
                );
            })}
        </div>
    );
}
