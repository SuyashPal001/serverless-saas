"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Download } from "lucide-react";

interface Proposal {
  id: string; version: number; status: string;
  execSummary: string; recommendation: string;
  rejectionGrounds: Array<{ bidderId: string; displayLabel: string; reasons: string[] }>;
  priceComparison: { internalEstimate: number | null; rows: Array<{ displayLabel: string; correctedTotal: number; isL1: boolean; varianceFromEstimatePct: number | null }> };
  generatedAt: string;
}

async function apiPost(path: string, body?: object) {
  const res = await fetch(`/api/proxy/api/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

function crFmt(rupees: number) { return `₹${(rupees / 1e7).toFixed(2)} Cr`; }

export function ProposalPanel({ tenderId }: { tenderId: string }) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["proposal", tenderId],
    queryFn: () => fetch(`/api/proxy/api/v1/tender/${tenderId}/proposal`).then(r => r.json()),
  });

  const proposals: Proposal[] = data?.proposals ?? [];
  const latest = proposals[0];

  async function handleGenerate() {
    setGenerating(true); setErr("");
    try {
      await apiPost(`/tender/${tenderId}/proposal/generate`);
      qc.invalidateQueries({ queryKey: ["proposal", tenderId] });
    } catch (e) { setErr((e as Error).message); }
    setGenerating(false);
  }

  function handleDownload(proposalId: string) {
    window.open(`/api/proxy/api/v1/tender/${tenderId}/proposal/${proposalId}/export`, "_blank");
  }

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading proposals…</div>;

  return (
    <div className="space-y-6">
      {err && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{err}</p>}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-400" />Award Proposal
        </h3>
        <Button size="sm" disabled={generating} onClick={handleGenerate} className="text-xs gap-1">
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Generate Proposal"}
        </Button>
      </div>

      {proposals.length === 0 && <p className="text-xs text-muted-foreground">No proposal generated yet.</p>}

      {latest && (
        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <Badge className="text-xs">v{latest.version}</Badge>
            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => handleDownload(latest.id)}>
              <Download className="w-3 h-3" />Download Word
            </Button>
          </div>
          <p className="text-xs text-foreground">{latest.execSummary}</p>

          {latest.priceComparison.rows.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-300 mb-1">Price Comparison</h4>
              <ul className="space-y-1">
                {latest.priceComparison.rows.map(r => (
                  <li key={r.displayLabel} className="text-xs flex justify-between">
                    <span>{r.displayLabel}{r.isL1 ? " (L1)" : ""}</span>
                    <span>{crFmt(r.correctedTotal)}{r.varianceFromEstimatePct != null ? ` (${r.varianceFromEstimatePct >= 0 ? "+" : ""}${r.varianceFromEstimatePct.toFixed(2)}%)` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {latest.rejectionGrounds.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-300 mb-1">Rejection Grounds</h4>
              {latest.rejectionGrounds.map(g => (
                <div key={g.bidderId} className="text-xs text-amber-400 mb-1">
                  <span className="font-medium">{g.displayLabel}:</span> {g.reasons.join("; ")}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-foreground border-t border-border pt-2">{latest.recommendation}</p>
        </div>
      )}

      {proposals.length > 1 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-gray-300">Previous Versions</h4>
          {proposals.slice(1).map(p => (
            <div key={p.id} className="flex items-center justify-between text-xs text-muted-foreground">
              <span>v{p.version} — {new Date(p.generatedAt).toLocaleString()}</span>
              <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => handleDownload(p.id)}>
                <Download className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
