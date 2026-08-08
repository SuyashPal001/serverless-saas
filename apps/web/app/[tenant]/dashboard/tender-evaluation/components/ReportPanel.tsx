"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Bidder { id: string; name: string; displayLabel: string; status: string }
interface PQFinding { bidderId: string; status: "qualified" | "not_qualified" | "cannot_evaluate" }
interface TechFinding { bidderId: string; status: "complied" | "deviation" | "not_found" | "cannot_evaluate" }
interface FinFinding {
    bidderId: string; correctedTotal: string; isL1: string; l1Margin: string | null;
    totalAmount: string; arithmeticCorrection: string;
}
interface Report { id: string; recommendation: string }

interface ReportPanelProps {
    tender: { rfpNumber: string; title: string; department: string }
    bidders: Bidder[]
    pqFindings: PQFinding[]
    technicalFindings: TechFinding[]
    financialFindings: FinFinding[]
    report: Report | null
}

function cr(rupees: number) { return `₹${(rupees / 1e7).toFixed(2)} Cr` }

function pqStatusFor(bidderId: string, pqFindings: PQFinding[]): "qualified" | "not_qualified" | "cannot_evaluate" | "pending" {
    const rows = pqFindings.filter(f => f.bidderId === bidderId)
    if (!rows.length) return "pending"
    if (rows.some(r => r.status === "not_qualified")) return "not_qualified"
    if (rows.some(r => r.status === "cannot_evaluate")) return "cannot_evaluate"
    return "qualified"
}

function techStatsFor(bidderId: string, techFindings: TechFinding[]) {
    const rows = techFindings.filter(f => f.bidderId === bidderId)
    return {
        complied: rows.filter(r => r.status === "complied").length,
        deviations: rows.filter(r => r.status === "deviation").length,
        notFound: rows.filter(r => r.status === "not_found").length,
        total: rows.length,
    }
}

function mechanicalRecommendation(bidders: Bidder[], finFindings: FinFinding[]): string {
    const l1 = finFindings.find(f => f.isL1 === "yes")
    if (!l1) return "Financial evaluation not yet run. Complete all evaluation stages to generate recommendation."
    const bidder = bidders.find(b => b.id === l1.bidderId)
    return `Lowest evaluated responsive bidder is ${bidder?.name ?? "—"} (${bidder?.displayLabel ?? "—"}) at ${cr(Number(l1.correctedTotal))}; recommended for award subject to approver sign-off.`
}

function exportCsv(bidders: Bidder[], finFindings: FinFinding[], rfpNumber: string) {
    const sorted = [...finFindings].sort((a, b) => Number(a.correctedTotal) - Number(b.correctedTotal))
    const header = ["Rank", "Bidder", "Label", "Total Bid (₹)", "Arithmetic Correction (₹)", "Corrected Total (₹)", "L1 Margin (₹)", "Status"]
    const rows = sorted.map((f, i) => {
        const b = bidders.find(x => x.id === f.bidderId)
        return [
            i + 1,
            b?.name ?? "",
            b?.displayLabel ?? "",
            f.totalAmount,
            f.arithmeticCorrection ?? "0",
            f.correctedTotal,
            f.l1Margin ?? "0",
            f.isL1 === "yes" ? "L1" : `L${i + 1}`,
        ].join(",")
    })
    const csv = [header.join(","), ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `${rfpNumber}-financial-report.csv`
    a.click(); URL.revokeObjectURL(url)
}

const PQ_BADGE: Record<string, string> = {
    qualified: "bg-green-500/20 text-green-400 border-green-500/30 border",
    not_qualified: "bg-red-500/20 text-red-400 border-red-500/30 border",
    cannot_evaluate: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 border",
    pending: "bg-muted/40 text-muted-foreground border-border border",
}
const PQ_LABEL: Record<string, string> = {
    qualified: "Qualified", not_qualified: "Disqualified",
    cannot_evaluate: "Cannot Evaluate", pending: "Pending",
}

export function ReportPanel({ tender, bidders, pqFindings, technicalFindings, financialFindings, report }: ReportPanelProps) {
    const noData = !pqFindings.length && !financialFindings.length
    const recommendation = mechanicalRecommendation(bidders, financialFindings)
    const sortedFin = [...financialFindings].sort((a, b) => Number(a.correctedTotal) - Number(b.correctedTotal))
    const l1 = sortedFin[0]

    return (
        <div className="space-y-6">
            {/* Header + export buttons */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs text-muted-foreground font-mono">{tender.rfpNumber}</p>
                    <h2 className="text-lg font-semibold text-foreground">{tender.title}</h2>
                    <p className="text-sm text-muted-foreground">{tender.department}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                        onClick={() => exportCsv(bidders, financialFindings, tender.rfpNumber)}>
                        <FileSpreadsheet className="w-3.5 h-3.5" /> Export CSV
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                        onClick={() => window.print()}>
                        <Printer className="w-3.5 h-3.5" /> Print / PDF
                    </Button>
                </div>
            </div>

            {noData && (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                    Run evaluation to generate the report.
                </div>
            )}

            {/* Recommendation — mechanical L1 statement */}
            {financialFindings.length > 0 && (
                <div className={`flex items-start gap-3 p-4 rounded-lg border ${l1 ? "border-green-500/30 bg-green-500/5" : "border-border bg-muted/10"}`}>
                    <Trophy className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">§6.1 Recommendation (GFR 2017 Rule 166)</p>
                        <p className="text-sm font-medium text-foreground">{recommendation}</p>
                    </div>
                </div>
            )}

            {/* PQ Summary */}
            {pqFindings.length > 0 && (
                <Card className="border-border bg-card">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Stage 3 — Pre-Qualification Summary</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="text-left py-2 px-4 font-medium">Bidder</th>
                                    <th className="text-left py-2 px-4 font-medium">Label</th>
                                    <th className="text-left py-2 px-4 font-medium">PQ Outcome</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bidders.map(b => {
                                    const status = pqStatusFor(b.id, pqFindings)
                                    return (
                                        <tr key={b.id} className="border-b border-border/40 hover:bg-muted/20">
                                            <td className="py-2 px-4 text-foreground">{b.name}</td>
                                            <td className="py-2 px-4 text-muted-foreground font-mono">{b.displayLabel}</td>
                                            <td className="py-2 px-4">
                                                <Badge className={`text-xs ${PQ_BADGE[status]}`}>{PQ_LABEL[status]}</Badge>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            )}

            {/* Technical Summary */}
            {technicalFindings.length > 0 && (
                <Card className="border-border bg-card">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Stage 4 — Technical Evaluation Summary</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="text-left py-2 px-4 font-medium">Bidder</th>
                                    <th className="text-right py-2 px-4 font-medium">Complied</th>
                                    <th className="text-right py-2 px-4 font-medium">Deviations</th>
                                    <th className="text-right py-2 px-4 font-medium">Not Found</th>
                                    <th className="text-right py-2 px-4 font-medium">Total Clauses</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bidders.filter(b => b.status !== "pq_disqualified").map(b => {
                                    const s = techStatsFor(b.id, technicalFindings)
                                    return (
                                        <tr key={b.id} className="border-b border-border/40 hover:bg-muted/20">
                                            <td className="py-2 px-4 text-foreground">{b.name} <span className="text-muted-foreground">({b.displayLabel})</span></td>
                                            <td className="py-2 px-4 text-right text-green-400">{s.complied}</td>
                                            <td className="py-2 px-4 text-right text-yellow-400">{s.deviations}</td>
                                            <td className="py-2 px-4 text-right text-red-400">{s.notFound}</td>
                                            <td className="py-2 px-4 text-right text-muted-foreground">{s.total}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            )}

            {/* Financial Summary */}
            {financialFindings.length > 0 && (
                <Card className="border-border bg-card">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Stage 6 — Financial Bid Comparison Statement</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="text-left py-2 px-4 font-medium">Rank</th>
                                    <th className="text-left py-2 px-4 font-medium">Bidder</th>
                                    <th className="text-right py-2 px-4 font-medium">Stated Total</th>
                                    <th className="text-right py-2 px-4 font-medium">Correction</th>
                                    <th className="text-right py-2 px-4 font-medium">Corrected Total</th>
                                    <th className="text-right py-2 px-4 font-medium">Above L1</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedFin.map((f, i) => {
                                    const b = bidders.find(x => x.id === f.bidderId)
                                    const margin = f.l1Margin ? Number(f.l1Margin) : null
                                    const correction = Number(f.arithmeticCorrection ?? 0)
                                    return (
                                        <tr key={f.bidderId} className={`border-b border-border/40 hover:bg-muted/20 ${f.isL1 === "yes" ? "bg-green-500/5" : ""}`}>
                                            <td className="py-2 px-4 font-semibold text-foreground">
                                                {f.isL1 === "yes" ? <span className="text-green-400">L1 ★</span> : `L${i + 1}`}
                                            </td>
                                            <td className="py-2 px-4 text-foreground">{b?.name} <span className="text-muted-foreground">({b?.displayLabel})</span></td>
                                            <td className="py-2 px-4 text-right text-muted-foreground font-mono">{cr(Number(f.totalAmount))}</td>
                                            <td className={`py-2 px-4 text-right font-mono ${correction !== 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
                                                {correction !== 0 ? (correction > 0 ? "+" : "") + cr(correction) : "—"}
                                            </td>
                                            <td className={`py-2 px-4 text-right font-mono font-semibold ${f.isL1 === "yes" ? "text-green-400" : "text-foreground"}`}>
                                                {cr(Number(f.correctedTotal))}
                                            </td>
                                            <td className="py-2 px-4 text-right text-muted-foreground font-mono">
                                                {margin != null ? `+${cr(margin)}` : "—"}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            )}

            {report && (
                <p className="text-xs text-muted-foreground text-right">Report ID: {report.id}</p>
            )}
        </div>
    )
}
