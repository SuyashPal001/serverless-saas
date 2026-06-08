"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Sparkles, Loader2, GitBranch } from "lucide-react";

interface PrebidQuery {
  id: string; queryNo: string; raisedBy: string | null; queryText: string;
  draftedResponse: string | null; finalResponse: string | null; status: string;
}

interface ParsedText { clauseRef: string; text: string; suggestedChange: string }

const STATUS_BADGE: Record<string, string> = {
  received: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  draft_ready: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  responded: "bg-green-500/10 text-green-400 border-green-500/20",
};

function parseQueryText(raw: string): ParsedText {
  const clauseMatch = raw.match(/^\[([^\]]+)\]\s*([\s\S]*)$/)
  const clauseRef = clauseMatch ? clauseMatch[1] : ''
  const rest = clauseMatch ? clauseMatch[2] : raw
  const suggestMatch = rest.match(/^([\s\S]*?)\s*\|\s*Suggests:\s*([\s\S]*)$/)
  return {
    clauseRef,
    text: (suggestMatch ? suggestMatch[1] : rest).trim(),
    suggestedChange: (suggestMatch ? suggestMatch[2] : '').trim(),
  }
}

async function apiPost(path: string, body?: object) {
  const res = await fetch(`/api/proxy/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

interface QueryCardProps {
  query: PrebidQuery;
  tenderId: string;
  onMutate: () => void;
  hasAmendment: boolean;
  isAmendmentLoading: boolean;
  onToggleAmendment: () => void;
}

export function QueryCard({ query: q, tenderId, onMutate, hasAmendment, isAmendmentLoading, onToggleAmendment }: QueryCardProps) {
  const [editText, setEditText] = useState(q.draftedResponse ?? '');
  const [showEdit, setShowEdit] = useState(false);

  const draftMut = useMutation({
    mutationFn: () => apiPost(`/tender/prebid/${tenderId}/queries/${q.id}/draft`),
    onSuccess: onMutate,
  });
  const acceptMut = useMutation({
    mutationFn: () => apiPost(
      `/tender/prebid/${tenderId}/queries/${q.id}/accept`,
      showEdit && editText !== q.draftedResponse ? { finalResponse: editText } : {},
    ),
    onSuccess: onMutate,
  });

  const { clauseRef, text, suggestedChange } = parseQueryText(q.queryText);
  const responded = q.status === "responded";
  const busy = draftMut.isPending || acceptMut.isPending;

  return (
    <div className="p-3 rounded-lg border border-border/30 bg-muted/10 space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0">{q.queryNo}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {q.raisedBy && <span className="text-xs text-muted-foreground">by {q.raisedBy}</span>}
            {clauseRef && (
              <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 border text-xs font-mono">{clauseRef}</Badge>
            )}
            <Badge className={`${STATUS_BADGE[q.status] ?? ""} border text-xs`}>{q.status.replace("_", " ")}</Badge>
          </div>
          <p className="text-xs text-foreground">{text}</p>
          {suggestedChange && (
            <p className="text-xs text-amber-400 italic mt-1">Suggests: {suggestedChange}</p>
          )}
          {q.draftedResponse && !responded && (
            <div className="mt-2 p-2 rounded bg-blue-500/5 border border-blue-500/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-blue-400">AI Draft:</p>
                <button className="text-xs text-muted-foreground underline" onClick={() => setShowEdit(v => !v)}>
                  {showEdit ? "View draft" : "Edit"}
                </button>
              </div>
              {showEdit
                ? <Textarea className="text-xs min-h-[60px] bg-transparent border-0 p-0 focus-visible:ring-0 resize-none" value={editText} onChange={e => setEditText(e.target.value)} />
                : <p className="text-xs text-foreground">{q.draftedResponse}</p>}
            </div>
          )}
          {responded && q.finalResponse && (
            <div className="mt-2 flex items-start gap-1">
              <CheckCircle className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">{q.finalResponse}</p>
            </div>
          )}
          {(q.draftedResponse || responded) && (
            <button
              onClick={onToggleAmendment}
              disabled={isAmendmentLoading}
              className={`mt-2 flex items-center gap-1.5 text-xs transition-colors ${hasAmendment ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground hover:text-foreground"}`}
            >
              {isAmendmentLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <GitBranch className="w-3 h-3" />}
              {isAmendmentLoading ? "Proposing amendment…" : hasAmendment ? "Amendment flagged ✓" : "Requires amendment"}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {!responded && (
            <Button size="sm" variant="outline" className="text-xs gap-1 h-7" disabled={busy} onClick={() => draftMut.mutate()}>
              {draftMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Draft
            </Button>
          )}
          {q.draftedResponse && !responded && (
            <Button size="sm" className="text-xs gap-1 h-7 bg-green-600 hover:bg-green-700" disabled={busy} onClick={() => acceptMut.mutate()}>
              {acceptMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}Accept
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
