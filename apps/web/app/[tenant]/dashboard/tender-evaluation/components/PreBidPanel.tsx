"use client";

import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, X, CheckCircle2, AlertCircle, Eye, MessageSquare, GitBranch, PlusCircle } from "lucide-react";
import { QueryCard } from "./QueryCard";

interface PrebidQuery {
  id: string; queryNo: string; raisedBy: string | null; queryText: string;
  draftedResponse: string | null; finalResponse: string | null; status: string;
}
interface Corrigendum {
  id: string; corrigendumNo: string; changesSummary: string;
  changedClauses: Array<{ sectionNo: string; clauseNo?: string; from: string; to: string }>;
  rfpVersionBefore: number | null; rfpVersionAfter: number | null; issuedAt: string;
}
interface FileStatus { name: string; status: "pending" | "extracting" | "done" | "failed"; error?: string; charCount?: number }
interface RfpSection { id: string; sectionNo: string; title: string; blockType: string; content: Record<string, unknown> }
interface CorrForm { queryId: string; changesSummary: string; sectionNo: string; from: string; to: string; fromPrefilled: boolean }

async function apiPost(path: string, body?: object) {
  const res = await fetch(`/api/proxy/api/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

function getSectionText(s: RfpSection): string {
  const c = s.content as any;
  return s.blockType === "prose" ? (c.text ?? "") : JSON.stringify(c.rows ?? c, null, 2).slice(0, 600);
}

export function PreBidPanel({ tenderId }: { tenderId: string }) {
  const qc = useQueryClient();
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [extractedTexts, setExtractedTexts] = useState<Record<string, string>>({});
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newQuery, setNewQuery] = useState({ queryText: "", raisedBy: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [corrForm, setCorrForm] = useState<CorrForm | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setFileStatuses(prev => [...prev, ...files.map(f => ({ name: f.name, status: "extracting" as const }))]);
    const encoded = await Promise.all(files.map(async f => {
      const buf = await f.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      return { filename: f.name, mimeType: f.type, data: b64 };
    }));
    try {
      const res = await fetch('/api/proxy/api/v1/tender/authoring/extract-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: encoded }),
      });
      const json = await res.json();
      const results: Array<{ filename: string; text: string; charCount: number; error?: string }> = json.results ?? [];
      setFileStatuses(prev => prev.map(fs => {
        const r = results.find(x => x.filename === fs.name);
        if (!r) return fs;
        return r.error ? { ...fs, status: "failed", error: r.error } : { ...fs, status: "done", charCount: r.charCount };
      }));
      setExtractedTexts(prev => {
        const next = { ...prev };
        results.forEach(r => { if (!r.error) next[r.filename] = r.text; });
        return next;
      });
    } catch (e) {
      setFileStatuses(prev => prev.map(fs => files.some(f => f.name === fs.name) ? { ...fs, status: "failed", error: (e as Error).message } : fs));
    }
    e.target.value = '';
  }

  function removeFile(name: string) {
    setFileStatuses(prev => prev.filter(f => f.name !== name));
    setExtractedTexts(prev => { const n = { ...prev }; delete n[name]; return n; });
  }

  async function handleUpload() {
    const doneFiles = fileStatuses.filter(f => f.status === "done");
    if (!doneFiles.length) return;
    setUploading(true); setUploadErr("");
    try {
      const texts = doneFiles.map(f => ({ filename: f.name, text: extractedTexts[f.name] }));
      await apiPost(`/tender/prebid/${tenderId}/upload-queries`, { texts });
      setFileStatuses([]); setExtractedTexts({}); invalidate();
    } catch (e) { setUploadErr((e as Error).message); }
    setUploading(false);
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

  async function handleCorrigendum() {
    if (!corrForm || !corrForm.changesSummary || !corrForm.to) return;
    setSubmitting(true); setErr("");
    try {
      await apiPost(`/tender/prebid/${tenderId}/corrigendum`, {
        queryId: corrForm.queryId || undefined,
        changesSummary: corrForm.changesSummary,
        changedClauses: [{ sectionNo: corrForm.sectionNo, from: corrForm.from, to: corrForm.to }],
      });
      setCorrForm(null); invalidate(); qc.invalidateQueries({ queryKey: ["tender", tenderId] });
    } catch (e) { setErr((e as Error).message); }
    setSubmitting(false);
  }

  function openCorrigendum(queryId: string, sectionNo: string) {
    const sec = rfpSections.find(s => s.sectionNo === sectionNo);
    const sectionText = sec ? getSectionText(sec) : '';
    setCorrForm({ queryId, sectionNo, changesSummary: "", from: sectionText, to: "", fromPrefilled: !!sectionText });
  }

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading pre-bid data…</div>;

  return (
    <div className="space-y-6">
      {(err || uploadErr) && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{err || uploadErr}</p>}

      {/* Upload section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Upload Query Sheet(s)</h3>
          {fileStatuses.length > 0 && <Badge className="text-xs">{fileStatuses.length} file{fileStatuses.length > 1 ? 's' : ''}</Badge>}
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,.docx" multiple className="hidden" onChange={handleFileChange} />
        <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => fileInputRef.current?.click()}>
          <Upload className="w-3 h-3" />Attach sheets (PDF · DOCX)
        </Button>
        {fileStatuses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {fileStatuses.map(f => (
              <div key={f.name} className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-muted/20 text-xs">
                {f.status === "extracting" && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
                {f.status === "done" && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                {f.status === "failed" && <AlertCircle className="w-3 h-3 text-red-400" />}
                <span className="max-w-[120px] truncate">{f.name}</span>
                {f.charCount && <span className="text-muted-foreground">({f.charCount.toLocaleString()} chars)</span>}
                {f.status === "done" && <button onClick={() => setPreviewFile(previewFile === f.name ? null : f.name)} className="text-muted-foreground hover:text-foreground"><Eye className="w-3 h-3" /></button>}
                <button onClick={() => removeFile(f.name)} className="text-muted-foreground hover:text-red-400"><X className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        )}
        {fileStatuses.some(f => f.status === "done") && (
          <Button size="sm" className="text-xs gap-1" disabled={uploading} onClick={handleUpload}>
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}Upload & Parse Queries
          </Button>
        )}
      </div>

      {/* Queries section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><MessageSquare className="w-4 h-4 text-purple-400" />Pre-Bid Queries ({queries.length})</h3>
          <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => setShowAdd(v => !v)}><PlusCircle className="w-3 h-3" />Add Query</Button>
        </div>
        {showAdd && (
          <div className="p-4 rounded-lg border border-border bg-card space-y-2">
            <Input className="text-xs" placeholder="Raised by (company / name)" value={newQuery.raisedBy} onChange={e => setNewQuery(f => ({ ...f, raisedBy: e.target.value }))} />
            <Textarea className="text-xs min-h-[60px]" placeholder="Query text…" value={newQuery.queryText} onChange={e => setNewQuery(f => ({ ...f, queryText: e.target.value }))} />
            <Button size="sm" className="text-xs" disabled={submitting} onClick={handleAddQuery}>{submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Capture Query"}</Button>
          </div>
        )}
        {queries.length === 0 && <p className="text-xs text-muted-foreground">No queries captured yet.</p>}
        {queries.map(q => <QueryCard key={q.id} query={q} tenderId={tenderId} onMutate={invalidate} onIssueCorrigendum={openCorrigendum} />)}
      </div>

      {/* Corrigendum form */}
      {corrForm && (
        <div className="p-4 rounded-lg border border-border bg-card space-y-2">
          <p className="text-xs font-medium text-foreground flex items-center gap-2"><GitBranch className="w-3 h-3 text-amber-400" />Issue Corrigendum</p>
          {corrForm.fromPrefilled ? (
            <>
              <p className="text-xs text-muted-foreground font-mono">Section: {corrForm.sectionNo}</p>
              <div className="p-2 rounded bg-muted/20 text-xs text-foreground max-h-24 overflow-auto whitespace-pre-wrap">{corrForm.from}</div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Input className="text-xs" placeholder="Section (e.g. S4)" value={corrForm.sectionNo} onChange={e => setCorrForm(f => f && ({ ...f, sectionNo: e.target.value }))} />
              <Input className="text-xs" placeholder="Before text" value={corrForm.from} onChange={e => setCorrForm(f => f && ({ ...f, from: e.target.value }))} />
            </div>
          )}
          <Input className="text-xs" placeholder="Changes summary…" value={corrForm.changesSummary} onChange={e => setCorrForm(f => f && ({ ...f, changesSummary: e.target.value }))} />
          <Textarea className="text-xs min-h-[60px]" placeholder="After text (required)…" value={corrForm.to} onChange={e => setCorrForm(f => f && ({ ...f, to: e.target.value }))} />
          <div className="flex gap-2">
            <Button size="sm" className="text-xs" disabled={submitting} onClick={handleCorrigendum}>{submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Issue"}</Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setCorrForm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Corrigenda list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><GitBranch className="w-4 h-4 text-amber-400" />Corrigenda</h3>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => setCorrForm({ queryId: "", changesSummary: "", sectionNo: "S1", from: "", to: "", fromPrefilled: false })}>Issue Corrigendum</Button>
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
              <div key={i} className="text-xs text-muted-foreground">
                <span className="font-mono text-amber-400">{ch.sectionNo}{ch.clauseNo ? `·${ch.clauseNo}` : ""}:</span>{" "}
                <span className="line-through opacity-60">{String(ch.from).slice(0, 50)}</span> → <span className="text-foreground">{String(ch.to).slice(0, 50)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Preview modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPreviewFile(null)}>
          <div className="bg-card border border-border rounded-lg p-4 max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium">{previewFile}</span>
              <button onClick={() => setPreviewFile(null)}><X className="w-4 h-4" /></button>
            </div>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{extractedTexts[previewFile]?.slice(0, 3000)}{extractedTexts[previewFile]?.length > 3000 ? "\n…(truncated)" : ""}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
