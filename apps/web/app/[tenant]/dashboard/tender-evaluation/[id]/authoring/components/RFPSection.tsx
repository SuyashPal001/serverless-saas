"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Edit2, RefreshCw, AlertTriangle, X, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface Clause { clauseNo: string; title: string; text: string; source: "library" | "drafted"; libraryRef?: string | null; cvcFlag?: { code: string; message: string } | null }
interface CriteriaRow { criterion: string; threshold: string; verification: string; source?: string; libraryRef?: string | null; cvcFlag?: { code: string; message: string } | null }
interface SpecRow { metric: string; target: string; measurement: string; source?: string; libraryRef?: string | null; cvcFlag?: { code: string; message: string } | null }
interface BoqRow { slNo: number; item: string; unit: string; qty: number; remarks?: string }
interface SectionContent { text?: string; rows?: unknown[]; clauses?: Clause[] }

interface Section {
    id: string; sectionNo: string; title: string; blockType: string;
    content: Record<string, unknown>; version: number; acceptedAt: string | null;
}

async function acceptSection(tenderId: string, sectionId: string) {
    const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}/sections/${sectionId}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) throw new Error("Accept failed");
}

async function editSection(tenderId: string, sectionId: string, content: object, changeNote?: string) {
    const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}/sections/${sectionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, changeNote }) });
    if (!res.ok) throw new Error("Edit failed");
}

async function regenerateSection(tenderId: string, sectionId: string, steer?: string) {
    const res = await fetch(`/api/proxy/api/v1/tender/authoring/${tenderId}/sections/${sectionId}/regenerate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steer }) });
    if (!res.ok) throw new Error("Regenerate failed");
}

export function RFPSection({ section, tenderId, onMutate }: { section: Section; tenderId: string; onMutate: () => void }) {
    const [editMode, setEditMode] = useState(false);
    const [steerInput, setSteerInput] = useState("");
    const [showSteer, setShowSteer] = useState(false);
    const [editText, setEditText] = useState("");
    const [dismissedFlags, setDismissedFlags] = useState<Set<string>>(new Set());

    const content = section.content as SectionContent;
    const clauses: Clause[] = content.clauses ?? [];
    const allCvcFlags = [
        ...clauses.filter(c => c.cvcFlag && !dismissedFlags.has(`${section.id}-clause-${c.clauseNo}`)).map(c => ({ ...c.cvcFlag!, key: `${section.id}-clause-${c.clauseNo}` })),
        ...((content.rows ?? []) as (CriteriaRow | SpecRow)[]).filter((r: any) => r.cvcFlag && !dismissedFlags.has(`${section.id}-row-${(r as CriteriaRow).criterion ?? (r as SpecRow).metric}`)).map((r: any) => ({ ...r.cvcFlag!, key: `${section.id}-row-${r.criterion ?? r.metric}` })),
    ];

    const acceptMutation = useMutation({ mutationFn: () => acceptSection(tenderId, section.id), onSuccess: onMutate });
    const editMutation = useMutation({ mutationFn: (c: object) => editSection(tenderId, section.id, c, "edit"), onSuccess: () => { setEditMode(false); onMutate(); } });
    const regenMutation = useMutation({ mutationFn: (steer?: string) => regenerateSection(tenderId, section.id, steer), onSuccess: () => { setShowSteer(false); setSteerInput(""); onMutate(); } });

    const isAccepted = !!section.acceptedAt;
    const busy = acceptMutation.isPending || editMutation.isPending || regenMutation.isPending;

    function startEdit() {
        setEditText(content.text ?? JSON.stringify(content, null, 2));
        setEditMode(true);
    }

    function saveEdit() {
        const newContent = section.blockType === "prose" ? { ...content, text: editText } : JSON.parse(editText);
        editMutation.mutate(newContent);
    }

    return (
        <div className={`rounded-lg border ${isAccepted ? "border-green-500/30 bg-green-500/5" : "border-border bg-card"} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{section.sectionNo}</span>
                    <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
                    <Badge className="text-xs border border-border/50 bg-muted/30 text-muted-foreground">{section.blockType}</Badge>
                    {isAccepted && <Badge className="text-xs border border-green-500/30 bg-green-500/10 text-green-400 gap-1"><CheckCircle2 className="w-3 h-3" />Accepted</Badge>}
                    <span className="text-xs text-muted-foreground/60">v{section.version}</span>
                </div>
                <div className="flex items-center gap-1">
                    {!isAccepted && <Button size="sm" variant="ghost" onClick={() => acceptMutation.mutate()} disabled={busy} className="h-7 px-2 text-xs text-green-400 hover:text-green-300 hover:bg-green-500/10"><Check className="w-3 h-3 mr-1" />Accept</Button>}
                    <Button size="sm" variant="ghost" onClick={startEdit} disabled={busy} className="h-7 px-2 text-xs text-muted-foreground"><Edit2 className="w-3 h-3 mr-1" />Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowSteer(v => !v)} disabled={busy} className="h-7 px-2 text-xs text-muted-foreground"><RefreshCw className="w-3 h-3 mr-1" />Regen</Button>
                </div>
            </div>

            {/* CVC advisory flags */}
            {allCvcFlags.map(flag => (
                <div key={flag.key} className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <span className="text-xs text-amber-300 flex-1"><b>{flag.code}</b> — {flag.message}</span>
                    <button onClick={() => setDismissedFlags(s => new Set([...s, flag.key]))} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
                </div>
            ))}

            {/* Content render */}
            {editMode ? (
                <div className="space-y-2">
                    <Textarea value={editText} onChange={e => setEditText(e.target.value)} rows={8} className="text-xs font-mono" />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={saveEdit} disabled={editMutation.isPending} className="text-xs">{editMutation.isPending ? "Saving…" : "Save"}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditMode(false)} className="text-xs">Cancel</Button>
                    </div>
                </div>
            ) : (
                <SectionBody blockType={section.blockType} content={content} />
            )}

            {/* Clause provenance */}
            {clauses.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-border/30">
                    {clauses.map(cl => (
                        <div key={cl.clauseNo} className="text-xs text-muted-foreground flex items-start gap-2">
                            <span className="font-mono shrink-0">{cl.clauseNo}</span>
                            <span className="flex-1">{cl.title}</span>
                            <Badge className={`text-xs border shrink-0 ${cl.source === "library" ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-muted/20 border-border text-muted-foreground"}`}>
                                {cl.source === "library" ? `${cl.libraryRef ?? "lib"}` : "drafted"}
                            </Badge>
                        </div>
                    ))}
                </div>
            )}

            {/* Regenerate steer */}
            {showSteer && (
                <div className="space-y-2 pt-2 border-t border-border/30">
                    <input className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground"
                        placeholder="Optional steer (e.g. make eligibility less restrictive)…"
                        value={steerInput} onChange={e => setSteerInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && regenMutation.mutate(steerInput || undefined)} />
                    <Button size="sm" onClick={() => regenMutation.mutate(steerInput || undefined)} disabled={regenMutation.isPending} className="text-xs">
                        {regenMutation.isPending ? <><RefreshCw className="w-3 h-3 animate-spin mr-1" />Regenerating…</> : "Regenerate"}
                    </Button>
                </div>
            )}
        </div>
    );
}

function SectionBody({ blockType, content }: { blockType: string; content: SectionContent }) {
    if (blockType === "prose") {
        return <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{content.text ?? ""}</p>;
    }
    if (blockType === "criteria-table") {
        const rows = (content.rows ?? []) as CriteriaRow[];
        return (
            <table className="w-full text-xs border-collapse">
                <thead><tr className="border-b border-border/50"><th className="text-left py-1.5 pr-3 font-medium text-muted-foreground w-1/3">Criterion</th><th className="text-left py-1.5 pr-3 font-medium text-muted-foreground w-1/3">Threshold</th><th className="text-left py-1.5 font-medium text-muted-foreground">Verification</th></tr></thead>
                <tbody>{rows.map((r, i) => (<tr key={i} className="border-b border-border/20"><td className="py-2 pr-3 text-foreground">{r.criterion}</td><td className="py-2 pr-3 text-foreground">{r.threshold} {r.libraryRef && <span className="ml-1 text-blue-400 font-mono">{r.libraryRef}</span>}</td><td className="py-2 text-foreground">{r.verification}</td></tr>))}</tbody>
            </table>
        );
    }
    if (blockType === "spec-table") {
        const rows = (content.rows ?? []) as SpecRow[];
        return (
            <table className="w-full text-xs border-collapse">
                <thead><tr className="border-b border-border/50"><th className="text-left py-1.5 pr-3 font-medium text-muted-foreground w-1/3">Metric</th><th className="text-left py-1.5 pr-3 font-medium text-muted-foreground w-1/3">Target</th><th className="text-left py-1.5 font-medium text-muted-foreground">Measurement</th></tr></thead>
                <tbody>{rows.map((r, i) => (<tr key={i} className="border-b border-border/20"><td className="py-2 pr-3 text-foreground">{r.metric}</td><td className="py-2 pr-3 text-foreground">{r.target} {r.libraryRef && <span className="ml-1 text-blue-400 font-mono">{r.libraryRef}</span>}</td><td className="py-2 text-foreground">{r.measurement}</td></tr>))}</tbody>
            </table>
        );
    }
    if (blockType === "line-item-table") {
        const rows = (content.rows ?? []) as BoqRow[];
        return (
            <table className="w-full text-xs border-collapse">
                <thead><tr className="border-b border-border/50"><th className="text-left py-1.5 pr-2 font-medium text-muted-foreground">S.No</th><th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Item</th><th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Unit</th><th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Qty</th><th className="text-left py-1.5 font-medium text-muted-foreground">Remarks</th></tr></thead>
                <tbody>{rows.map((r, i) => (<tr key={i} className="border-b border-border/20"><td className="py-2 pr-2 text-foreground">{r.slNo}</td><td className="py-2 pr-3 text-foreground">{r.item}</td><td className="py-2 pr-3 text-foreground">{r.unit}</td><td className="py-2 pr-3 text-foreground">{r.qty}</td><td className="py-2 text-foreground">{r.remarks ?? ""}</td></tr>))}</tbody>
            </table>
        );
    }
    return <pre className="text-xs text-muted-foreground">{JSON.stringify(content, null, 2)}</pre>;
}
