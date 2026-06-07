"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, MessageSquare, GitBranch, CheckCircle, Sparkles, PlusCircle } from "lucide-react";

interface PrebidQuery {
    id: string; queryNo: string; raisedBy: string | null; queryText: string;
    draftedResponse: string | null; finalResponse: string | null;
    status: string; createdAt: string;
}
interface Corrigendum {
    id: string; corrigendumNo: string; changesSummary: string;
    changedClauses: Array<{ sectionNo: string; clauseNo?: string; from: string; to: string }>;
    rfpVersionBefore: number | null; rfpVersionAfter: number | null; issuedAt: string;
}

const STATUS_BADGE: Record<string, string> = {
    received: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    draft_ready: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    responded: "bg-green-500/10 text-green-400 border-green-500/20",
};

async function api(path: string, method = "GET", body?: object) {
    const res = await fetch(`/api/proxy/api/v1${path}`, {
        method, headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json();
}

export function PreBidPanel({ tenderId }: { tenderId: string }) {
    const qc = useQueryClient();
    const [draftingId, setDraftingId] = useState<string | null>(null);
    const [acceptingId, setAcceptingId] = useState<string | null>(null);
    const [editText, setEditText] = useState<Record<string, string>>({});
    const [showAdd, setShowAdd] = useState(false);
    const [newQuery, setNewQuery] = useState({ queryText: "", raisedBy: "" });
    const [showCorr, setShowCorr] = useState(false);
    const [corrForm, setCorrForm] = useState({ queryId: "", changesSummary: "", sectionNo: "S1", from: "", to: "" });
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState("");

    const { data, isLoading } = useQuery({
        queryKey: ["prebid", tenderId],
        queryFn: () => api(`/tender/prebid/${tenderId}`),
    });

    const queries: PrebidQuery[] = data?.queries ?? [];
    const corrigenda: Corrigendum[] = data?.corrigenda ?? [];
    const invalidate = () => qc.invalidateQueries({ queryKey: ["prebid", tenderId] });

    async function handleDraft(q: PrebidQuery) {
        setDraftingId(q.id); setErr("");
        try {
            await api(`/tender/prebid/${tenderId}/queries/${q.id}/draft`, "POST");
            invalidate();
        } catch (e) { setErr((e as Error).message); }
        finally { setDraftingId(null); }
    }

    async function handleAccept(q: PrebidQuery) {
        setAcceptingId(q.id); setErr("");
        try {
            await api(`/tender/prebid/${tenderId}/queries/${q.id}/accept`, "POST",
                editText[q.id] ? { finalResponse: editText[q.id] } : {});
            invalidate();
        } catch (e) { setErr((e as Error).message); }
        finally { setAcceptingId(null); }
    }

    async function handleAddQuery() {
        if (!newQuery.queryText.trim()) return;
        setSubmitting(true); setErr("");
        try {
            await api(`/tender/prebid/${tenderId}/queries`, "POST", newQuery);
            setNewQuery({ queryText: "", raisedBy: "" }); setShowAdd(false); invalidate();
        } catch (e) { setErr((e as Error).message); }
        finally { setSubmitting(false); }
    }

    async function handleCorrigendum() {
        if (!corrForm.changesSummary || !corrForm.from || !corrForm.to) return;
        setSubmitting(true); setErr("");
        try {
            await api(`/tender/prebid/${tenderId}/corrigendum`, "POST", {
                queryId: corrForm.queryId || undefined,
                changesSummary: corrForm.changesSummary,
                changedClauses: [{ sectionNo: corrForm.sectionNo, from: corrForm.from, to: corrForm.to }],
            });
            setCorrForm({ queryId: "", changesSummary: "", sectionNo: "S1", from: "", to: "" });
            setShowCorr(false); invalidate();
            qc.invalidateQueries({ queryKey: ["tender", tenderId] });
        } catch (e) { setErr((e as Error).message); }
        finally { setSubmitting(false); }
    }

    if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading pre-bid data…</div>;

    return (
        <div className="space-y-6">
            {err && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{err}</p>}

            {/* Corrigenda */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><GitBranch className="w-4 h-4 text-amber-400" />Corrigenda</h3>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowCorr(v => !v)}>Issue Corrigendum</Button>
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
                {showCorr && (
                    <div className="p-4 rounded-lg border border-border bg-card space-y-2">
                        <p className="text-xs font-medium text-foreground">Issue New Corrigendum</p>
                        <Input className="text-xs" placeholder="Changes summary…" value={corrForm.changesSummary} onChange={e => setCorrForm(f => ({ ...f, changesSummary: e.target.value }))} />
                        <div className="grid grid-cols-3 gap-2">
                            <Input className="text-xs" placeholder="Section (e.g. S4)" value={corrForm.sectionNo} onChange={e => setCorrForm(f => ({ ...f, sectionNo: e.target.value }))} />
                            <Input className="text-xs" placeholder="Before text" value={corrForm.from} onChange={e => setCorrForm(f => ({ ...f, from: e.target.value }))} />
                            <Input className="text-xs" placeholder="After text" value={corrForm.to} onChange={e => setCorrForm(f => ({ ...f, to: e.target.value }))} />
                        </div>
                        <Button size="sm" className="text-xs" disabled={submitting} onClick={handleCorrigendum}>{submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Issue"}</Button>
                    </div>
                )}
            </div>

            {/* Queries */}
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
                {queries.map(q => (
                    <div key={q.id} className="p-3 rounded-lg border border-border/30 bg-muted/10 space-y-2">
                        <div className="flex items-start gap-2">
                            <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0">{q.queryNo}</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    {q.raisedBy && <span className="text-xs text-muted-foreground">by {q.raisedBy}</span>}
                                    <Badge className={`${STATUS_BADGE[q.status] ?? ""} border text-xs`}>{q.status.replace("_", " ")}</Badge>
                                </div>
                                <p className="text-xs text-foreground">{q.queryText}</p>
                                {q.draftedResponse && (
                                    <div className="mt-2 p-2 rounded bg-blue-500/5 border border-blue-500/20">
                                        <p className="text-xs font-medium text-blue-400 mb-1">AI Draft:</p>
                                        <Textarea className="text-xs min-h-[60px] bg-transparent border-0 p-0 focus-visible:ring-0 resize-none"
                                            value={editText[q.id] ?? q.draftedResponse}
                                            onChange={e => setEditText(t => ({ ...t, [q.id]: e.target.value }))} />
                                    </div>
                                )}
                                {q.finalResponse && q.status === "responded" && (
                                    <div className="mt-2 flex items-start gap-1">
                                        <CheckCircle className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
                                        <p className="text-xs text-muted-foreground">{q.finalResponse}</p>
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                                {q.status !== "responded" && (
                                    <Button size="sm" variant="outline" className="text-xs gap-1 h-7" disabled={draftingId === q.id} onClick={() => handleDraft(q)}>
                                        {draftingId === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Draft
                                    </Button>
                                )}
                                {q.status === "draft_ready" && (
                                    <Button size="sm" className="text-xs gap-1 h-7 bg-green-600 hover:bg-green-700" disabled={acceptingId === q.id} onClick={() => handleAccept(q)}>
                                        {acceptingId === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}Accept
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
