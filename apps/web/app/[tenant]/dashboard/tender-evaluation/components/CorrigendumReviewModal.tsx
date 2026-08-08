"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, GitBranch, X } from "lucide-react";

export interface AmendmentEntry {
  queryId: string;
  queryNo: string;
  clauseRef: string;
  sectionNo: string;
  from: string;
  to: string;
  queryText: string;
}

interface Props {
  amendments: AmendmentEntry[];
  onUpdateTo: (queryId: string, to: string) => void;
  onIssue: (summary: string, entries: AmendmentEntry[]) => Promise<void>;
  onClose: () => void;
}

export function CorrigendumReviewModal({ amendments, onUpdateTo, onIssue, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const autoSummary = amendments.length === 1
    ? `Amendment to ${amendments[0].clauseRef} per query ${amendments[0].queryNo}. All other terms and conditions of the RFP remain unchanged.`
    : `Amendments to ${amendments.map(a => a.clauseRef).join(", ")} per queries ${amendments.map(a => a.queryNo).join(", ")}. All other terms and conditions of the RFP remain unchanged.`;

  async function handleIssue() {
    setSubmitting(true); setErr("");
    try { await onIssue(autoSummary, amendments); }
    catch (e) { setErr((e as Error).message); setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-amber-400" />Review Corrigendum
          </span>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Summary: <span className="text-foreground">{autoSummary}</span>
          </p>
          {amendments.map(a => (
            <div key={a.queryId} className="space-y-2 p-3 rounded-lg border border-border bg-muted/10">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground">{a.queryNo}</span>
                <span className="text-xs font-mono text-amber-400 font-semibold">{a.clauseRef}</span>
              </div>
              <p className="text-xs text-muted-foreground italic">
                {a.queryText.slice(0, 140)}{a.queryText.length > 140 ? "…" : ""}
              </p>
              <div className="space-y-1">
                <p className="text-xs font-medium text-red-400">Before:</p>
                <div className="p-2 rounded bg-red-500/5 border border-red-500/20 text-xs text-muted-foreground whitespace-pre-wrap max-h-28 overflow-auto">
                  {a.from || "(clause text not available)"}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-green-400">After (AI-proposed — edit if needed):</p>
                <Textarea
                  className="text-xs min-h-[72px]"
                  value={a.to}
                  onChange={e => onUpdateTo(a.queryId, e.target.value)}
                />
              </div>
            </div>
          ))}
        </div>

        {err && <p className="text-xs text-red-400 px-4 pb-1">{err}</p>}

        <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0">
          <Button
            size="sm" className="text-xs gap-1"
            disabled={submitting || amendments.some(a => !a.to.trim())}
            onClick={handleIssue}
          >
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
            Issue Corrigendum
          </Button>
          <Button size="sm" variant="ghost" className="text-xs" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
