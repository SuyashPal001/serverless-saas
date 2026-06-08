"use client";

import { cn } from "@/lib/utils";

export interface ToolResult {
    toolCallId: string;
    toolName: string;
    result: Record<string, unknown>;
}

// ── PQ result card ────────────────────────────────────────────────────────────

function statusBadge(status: string) {
    const map: Record<string, string> = {
        qualified: "bg-green-500/15 text-green-400 border-green-500/25",
        not_qualified: "bg-red-500/15 text-red-400 border-red-500/25",
        cannot_evaluate: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    };
    const label: Record<string, string> = {
        qualified: "Qualified",
        not_qualified: "Disqualified",
        cannot_evaluate: "Cannot Evaluate",
    };
    return (
        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", map[status] ?? "bg-muted/20 text-muted-foreground border-border")}>
            {label[status] ?? status}
        </span>
    );
}

function PqCard({ result }: { result: Record<string, unknown> }) {
    const rows = (result.pqResults as any[]) ?? [];
    const qualified = result.qualifiedCount as number ?? 0;
    const total = result.totalBidders as number ?? 0;
    return (
        <div className="rounded-xl border border-border/60 overflow-hidden text-sm">
            <div className="px-4 py-2.5 bg-muted/20 border-b border-border/40 flex items-center justify-between">
                <span className="font-medium text-foreground text-xs">PQ Evaluation</span>
                <span className="text-xs text-muted-foreground">{qualified} of {total} qualified</span>
            </div>
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-border/30">
                        <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">Bidder</th>
                        <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">Status</th>
                        <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">Failed Rules</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-border/20 last:border-0">
                            <td className="px-4 py-2 text-foreground">{r.displayLabel ?? r.bidderName}</td>
                            <td className="px-4 py-2">{statusBadge(r.overallStatus)}</td>
                            <td className="px-4 py-2 text-muted-foreground">{(r.failedRules as string[])?.join(", ") || "—"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Technical result card ─────────────────────────────────────────────────────

function TechCard({ result }: { result: Record<string, unknown> }) {
    const rows = (result.techResults as any[]) ?? [];
    return (
        <div className="rounded-xl border border-border/60 overflow-hidden text-sm">
            <div className="px-4 py-2.5 bg-muted/20 border-b border-border/40">
                <span className="font-medium text-foreground text-xs">Technical Evaluation</span>
            </div>
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-border/30">
                        <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">Bidder</th>
                        <th className="text-center px-3 py-1.5 text-green-500/80 font-medium">Complied</th>
                        <th className="text-center px-3 py-1.5 text-amber-500/80 font-medium">Deviations</th>
                        <th className="text-center px-3 py-1.5 text-red-500/80 font-medium">Not Found</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-border/20 last:border-0">
                            <td className="px-4 py-2 text-foreground">{r.displayLabel ?? r.bidderName}</td>
                            <td className="px-3 py-2 text-center text-green-400 font-medium">{r.compliedCount}</td>
                            <td className="px-3 py-2 text-center text-amber-400 font-medium">{r.deviationCount}</td>
                            <td className="px-3 py-2 text-center text-red-400 font-medium">{r.notFoundCount}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Shortfall card ────────────────────────────────────────────────────────────

function ShortfallCard({ result }: { result: Record<string, unknown> }) {
    const items = (result.shortfalls as any[]) ?? [];
    const count = result.shortfallCount as number ?? items.length;
    return (
        <div className="rounded-xl border border-border/60 overflow-hidden text-sm">
            <div className="px-4 py-2.5 bg-muted/20 border-b border-border/40 flex items-center justify-between">
                <span className="font-medium text-foreground text-xs">Shortfall Detection</span>
                <span className="text-xs text-muted-foreground">{count} shortfall{count !== 1 ? "s" : ""} detected</span>
            </div>
            {items.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">No shortfalls found.</p>
            ) : (
                <div className="divide-y divide-border/20">
                    {items.slice(0, 8).map((s: any, i: number) => (
                        <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                            <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{s.displayLabel ?? s.bidderName}</span>
                            <span className="text-xs text-foreground flex-1 leading-relaxed">{s.discrepancy}</span>
                        </div>
                    ))}
                    {items.length > 8 && (
                        <p className="px-4 py-2 text-xs text-muted-foreground">+{items.length - 8} more</p>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Financial card ────────────────────────────────────────────────────────────

function FinancialCard({ result }: { result: Record<string, unknown> }) {
    const rankings = (result.rankings as any[]) ?? [];
    const l1Amount = result.l1Amount as number ?? 0;
    const sorted = [...rankings].sort((a, b) => a.correctedTotal - b.correctedTotal);
    return (
        <div className="rounded-xl border border-border/60 overflow-hidden text-sm">
            <div className="px-4 py-2.5 bg-muted/20 border-b border-border/40 flex items-center justify-between">
                <span className="font-medium text-foreground text-xs">Financial Evaluation</span>
                <span className="text-xs text-muted-foreground">L1: ₹{(l1Amount / 1e7).toFixed(2)} Cr</span>
            </div>
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-border/30">
                        <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">Rank</th>
                        <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">Bidder</th>
                        <th className="text-right px-4 py-1.5 text-muted-foreground font-medium">Amount (Cr)</th>
                        <th className="text-right px-4 py-1.5 text-muted-foreground font-medium">Margin</th>
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((r: any, i: number) => (
                        <tr key={i} className={cn("border-b border-border/20 last:border-0", r.isL1 && "bg-green-500/5")}>
                            <td className="px-4 py-2 font-medium text-foreground">
                                {r.isL1 ? <span className="text-green-400">L1</span> : `L${i + 1}`}
                            </td>
                            <td className="px-4 py-2 text-foreground">{r.displayLabel ?? r.bidderName}</td>
                            <td className="px-4 py-2 text-right font-mono text-foreground">
                                {(r.correctedTotal / 1e7).toFixed(2)}
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground">
                                {r.l1Margin != null ? `+₹${(r.l1Margin / 1e7).toFixed(2)} Cr` : "—"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Report card ───────────────────────────────────────────────────────────────

function ReportCard({ result }: { result: Record<string, unknown> }) {
    return (
        <div className="rounded-xl border border-border/60 overflow-hidden text-sm">
            <div className="px-4 py-2.5 bg-muted/20 border-b border-border/40">
                <span className="font-medium text-foreground text-xs">Evaluation Report</span>
            </div>
            <div className="px-4 py-3">
                <p className="text-xs text-foreground/80 leading-relaxed">{result.recommendation as string}</p>
            </div>
        </div>
    );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

const RUN_CARDS: Record<string, (r: Record<string, unknown>) => React.ReactNode> = {
    run_pq: (r) => <PqCard result={r} />,
    run_technical: (r) => <TechCard result={r} />,
    run_shortfall: (r) => <ShortfallCard result={r} />,
    run_financial: (r) => <FinancialCard result={r} />,
    run_report: (r) => <ReportCard result={r} />,
};

export function TenderToolCards({ toolResults }: { toolResults: ToolResult[] }) {
    const runResults = toolResults.filter(t => t.toolName in RUN_CARDS);
    if (!runResults.length) return null;
    return (
        <div className="space-y-2 w-full">
            {runResults.map(t => (
                <div key={t.toolCallId}>
                    {RUN_CARDS[t.toolName]?.(t.result)}
                </div>
            ))}
        </div>
    );
}
