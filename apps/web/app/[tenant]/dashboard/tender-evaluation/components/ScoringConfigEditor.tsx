"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BidderTechnicalScore } from "./types";

interface ScoringConfigEditorProps {
    tenderId: string;
    clauses: Array<{ clauseNo: string; clauseTitle: string }>;
    initialWeights: Record<string, number>;
    onSaved: (scores: BidderTechnicalScore[]) => void;
}

function computeEqualWeights(clauses: Array<{ clauseNo: string }>): Record<string, number> {
    const n = clauses.length;
    if (n === 0) return {};
    const base = Math.floor((100 / n) * 10) / 10;
    const weights: Record<string, number> = {};
    let assigned = 0;
    clauses.forEach((c, i) => {
        if (i === n - 1) {
            weights[c.clauseNo] = Math.round((100 - assigned) * 10) / 10;
        } else {
            weights[c.clauseNo] = base;
            assigned += base;
        }
    });
    return weights;
}

export function ScoringConfigEditor({ tenderId, clauses, initialWeights, onSaved }: ScoringConfigEditorProps) {
    const [open, setOpen] = useState(false);

    const defaultWeights = Object.keys(initialWeights).length > 0
        ? initialWeights
        : computeEqualWeights(clauses);

    const [weights, setWeights] = useState<Record<string, number>>(defaultWeights);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const total = Object.values(weights).reduce((s, v) => s + (Number(v) || 0), 0);
    const sumOk = Math.abs(total - 100) <= 0.01;

    function setWeight(clauseNo: string, raw: string) {
        const val = parseFloat(raw);
        setWeights(prev => ({ ...prev, [clauseNo]: isNaN(val) ? 0 : val }));
        setMessage(null);
    }

    function resetEqual() {
        setWeights(computeEqualWeights(clauses));
        setMessage(null);
    }

    async function saveWeights() {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${tenderId}/scoring-config`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ weights }),
            });
            if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
            const data = await res.json() as { ok: boolean; scores: BidderTechnicalScore[] };
            onSaved(data.scores);
            setMessage({ type: "success", text: "Weights saved — scores recalculated." });
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Save failed" });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/20 transition-colors"
            >
                <span>Scoring Configuration</span>
                {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-4 border-t border-border">
                    <div className="overflow-x-auto mt-3">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="text-left py-2 pr-4 font-medium w-20">Clause</th>
                                    <th className="text-left py-2 pr-4 font-medium">Title</th>
                                    <th className="text-left py-2 font-medium w-28">Weight (%)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {clauses.map(c => (
                                    <tr key={c.clauseNo} className="border-b border-border/40">
                                        <td className="py-1.5 pr-4 font-mono text-muted-foreground">{c.clauseNo}</td>
                                        <td className="py-1.5 pr-4 text-foreground">{c.clauseTitle}</td>
                                        <td className="py-1.5">
                                            <Input
                                                type="number"
                                                min={0}
                                                max={100}
                                                step={0.1}
                                                value={weights[c.clauseNo] ?? 0}
                                                onChange={e => setWeight(c.clauseNo, e.target.value)}
                                                className="h-7 w-24 text-xs bg-background border-border"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Total:</span>
                            <Badge className={sumOk
                                ? "bg-green-500/20 text-green-400 border-green-500/30 border"
                                : "bg-red-500/20 text-red-400 border-red-500/30 border"}>
                                {total.toFixed(1)}%
                            </Badge>
                            {!sumOk && <span className="text-xs text-red-400">Must equal 100%</span>}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={resetEqual}
                                className="text-xs h-7 border-border text-muted-foreground hover:text-foreground"
                            >
                                Equal Weights
                            </Button>
                            <Button
                                size="sm"
                                disabled={!sumOk || saving}
                                onClick={saveWeights}
                                className="text-xs h-7 bg-primary text-primary-foreground"
                            >
                                {saving ? "Saving…" : "Save Weights"}
                            </Button>
                        </div>
                    </div>

                    {message && (
                        <p className={`text-xs px-3 py-2 rounded border ${
                            message.type === "success"
                                ? "bg-green-500/10 border-green-500/20 text-green-400"
                                : "bg-red-500/10 border-red-500/20 text-red-400"
                        }`}>
                            {message.text}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
