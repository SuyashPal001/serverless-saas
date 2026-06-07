"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, MessageSquare, GitBranch, PlusCircle } from "lucide-react";
import { QueryCard } from "./QueryCard";
import { QuerySheetUpload } from "./QuerySheetUpload";
import { CorrigendumReviewModal, type AmendmentEntry } from "./CorrigendumReviewModal";

interface PrebidQuery {
  id: string; queryNo: string; raisedBy: string | null; queryText: string;
  draftedResponse: string | null; finalResponse: string | null; status: string;
}
interface Corrigendum {
  id: string; corrigendumNo: string; changesSummary: string;
  changedClauses: Array<{ sectionNo: string; clauseNo?: string; from: string; to: string }>;
  rfpVersionBefore: number | null; rfpVersionAfter: number | null; issuedAt: string;
}
interface RfpSection { id: string; sectionNo: string; title: string; blockType: string; content: Record<string, unknown> }

function parseQueryText(raw: string) {
  const clauseMatch = raw.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const clauseRef = clauseMatch ? clauseMatch[1] : "";
  const rest = clauseMatch ? clauseMatch[2] : raw;
  const suggestMatch = rest.match(/^([\s\S]*?)\s*\|\s*Suggests:\s*([\s\S]*)$/);
  return {
    clauseRef,
    text: (suggestMatch ? suggestMatch[1] : rest).trim(),
    suggestedChange: (suggestMatch ? suggestMatch[2] : "").trim(),
  };
}

function sectionFromRef(ref: string): string {
  const m = ref.match(/S(\d+)/i) ?? ref.match(/^(\d+)/);
  return m ? `S${m[1]}` : "";
}

function getSectionText(s: RfpSection): string {
  const c = s.content as any;
  if (s.blockType === "prose") return c.text ?? "";
  const rows = Array.isArray(c.rows) ? (c.rows as string[][]) : null;
  if (rows?.length) return rows.map(r => r.join(" | ")).join("\n");
  return "";
}

async function apiPost(path: string, body?: object) {
  const res = await fetch(`/api/proxy/api/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

export function PreBidPanel({ tenderId }: { tenderId: string }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newQuery, setNewQuery] = useState({ queryText: "", raisedBy: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [amendments, setAmendments] = useState<Map<string, AmendmentEntry>>(new Map());
  const [loadingAmendments, setLoadingAmendments] = useState<Set<string>>(new Set());
  const [showCorrReview, setShowCorrReview] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["prebid", tenderId],
    queryFn: () => fetch(`/api/proxy/api/v1/tender/prebid/${tenderId}`).then(r => r.json()),
  });
  const { data: rfpData } = useQuery({
    queryKey: ["rfp-authoring", tenderId],
    queryFn: () => fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const queries: PrebidQuery[] = data?.queries ?? [];
  const corrigenda: Corrigendum[] = data?.corrigenda ?? [];
  const rfpSections: RfpSection[] = rfpData?.sections ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["prebid", tenderId] });

  async function handleToggleAmendment(query: PrebidQuery) {
    if (amendments.has(query.id)) {
      setAmendments(prev => { const n = new Map(prev); n.delete(query.id); return n; });
      return;
    }
    const { clauseRef, text, suggestedChange } = parseQueryText(query.queryText);
    const sectionNo = sectionFromRef(clauseRef);
    const sec = rfpSections.find(s => s.sectionNo === sectionNo);
    const currentText = sec ? getSectionText(sec) : "";
    setLoadingAmendments(prev => new Set(prev).add(query.id));
    try {
      const res = await apiPost(`/tender/prebid/${tenderId}/queries/${query.id}/propose-amendment`, {
        clauseRef, currentText, suggestedChange, queryText: text,
      });
      setAmendments(prev => new Map(prev).set(query.id, {
        queryId: query.id, queryNo: query.queryNo, clauseRef, sectionNo,
        from: currentText, to: res.proposedText ?? "", queryText: text,
      }));
    } catch (e) { setErr((e as Error).message); }
    setLoadingAmendments(prev => { const n = new Set(prev); n.delete(query.id); return n; });
  }

  async function handleIssueConsolidated(summary: string, entries: AmendmentEntry[]) {
    await apiPost(`/tender/prebid/${tenderId}/corrigendum`, {
      changesSummary: summary,
      changedClauses: entries.map(a => ({ sectionNo: a.sectionNo, from: a.from, to: a.to })),
    });
    setAmendments(new Map()); setShowCorrReview(false);
    invalidate(); qc.invalidateQueries({ queryKey: ["tender", tenderId] });
  }

  async function handleAddQuery() {
    if (!newQuery.queryText.trim()) return;
    setSubmitting(true); setErr("");
    try {
      await apiPost(`/tender/prebid/${tenderId}/queries`, newQuery);
      setNewQuery({ queryText: "", raisedBy: "" }); setShowAdd(false); invalidate();
    } catch (e) { setErr((e as Error).message); }
    setSubmitting(false);
  }

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading pre-bid data…</div>;

  const amendmentList = Array.from(amendments.values());

  return (
    <div className="space-y-6">
      {err && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{err}</p>}

      <QuerySheetUpload tenderId={tenderId} currentQueryCount={queries.length} onQueriesParsed={invalidate} />

      {/* Queries */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-purple-400" />Pre-Bid Queries ({queries.length})
          </h3>
          <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => setShowAdd(v => !v)}>
            <PlusCircle className="w-3 h-3" />Add Query
          </Button>
        </div>
        {showAdd && (
          <div className="p-4 rounded-lg border border-border bg-card space-y-2">
            <Input className="text-xs" placeholder="Raised by (company / name)" value={newQuery.raisedBy} onChange={e => setNewQuery(f => ({ ...f, raisedBy: e.target.value }))} />
            <Textarea className="text-xs min-h-[60px]" placeholder="Query text…" value={newQuery.queryText} onChange={e => setNewQuery(f => ({ ...f, queryText: e.target.value }))} />
            <Button size="sm" className="text-xs" disabled={submitting} onClick={handleAddQuery}>
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Capture Query"}
            </Button>
          </div>
        )}
        {queries.length === 0 && <p className="text-xs text-muted-foreground">No queries captured yet.</p>}
        {queries.map(q => (
          <QueryCard key={q.id} query={q} tenderId={tenderId} onMutate={invalidate}
            hasAmendment={amendments.has(q.id)}
            isAmendmentLoading={loadingAmendments.has(q.id)}
            onToggleAmendment={() => handleToggleAmendment(q)}
          />
        ))}
      </div>

      {/* Corrigenda */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-amber-400" />Corrigenda
          </h3>
          <Button size="sm" variant="outline" className="text-xs gap-1"
            disabled={amendmentList.length === 0}
            onClick={() => setShowCorrReview(true)}
          >
            <GitBranch className="w-3 h-3" />
            Issue Corrigendum{amendmentList.length > 0 ? ` (${amendmentList.length})` : ""}
          </Button>
        </div>
        {corrigenda.length === 0 && <p className="text-xs text-muted-foreground">No corrigenda issued yet.</p>}
        {corrigenda.map(c => (
          <div key={c.id} className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-amber-400">{c.corrigendumNo}</span>
              <span className="text-xs text-muted-foreground">v{c.rfpVersionBefore} → v{c.rfpVersionAfter} · {new Date(c.issuedAt).toLocaleDateString()}</span>
            </div>
            <p className="text-xs text-foreground mb-2">{c.changesSummary}</p>
            {(c.changedClauses ?? []).map((ch, i) => (
              <div key={i} className="text-xs text-muted-foreground mt-1">
                <span className="font-mono text-amber-400">{ch.sectionNo}{ch.clauseNo ? `·${ch.clauseNo}` : ""}:</span>{" "}
                <span className="line-through opacity-60">{String(ch.from).slice(0, 60)}</span>
                {" → "}
                <span className="text-foreground">{String(ch.to).slice(0, 60)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {showCorrReview && (
        <CorrigendumReviewModal
          amendments={amendmentList}
          onUpdateTo={(queryId, to) => setAmendments(prev => {
            const n = new Map(prev);
            const entry = n.get(queryId);
            if (entry) n.set(queryId, { ...entry, to });
            return n;
          })}
          onIssue={handleIssueConsolidated}
          onClose={() => setShowCorrReview(false)}
        />
      )}
    </div>
  );
}
