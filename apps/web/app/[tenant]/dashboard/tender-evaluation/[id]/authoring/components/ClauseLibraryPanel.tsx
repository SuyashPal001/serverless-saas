"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, Plus, Loader2 } from "lucide-react";

interface LibraryClause {
    id: string; code: string; category: string; title: string; content: string; tags: string[];
}

const CATEGORIES = ["Eligibility/PQ", "Technical", "SLA/KPI", "Commercial", "Security/Compliance", "General Terms"];
const CATEGORY_COLORS: Record<string, string> = {
    "Eligibility/PQ":       "bg-blue-500/10 text-blue-400 border-blue-500/20",
    "Technical":            "bg-purple-500/10 text-purple-400 border-purple-500/20",
    "SLA/KPI":              "bg-amber-500/10 text-amber-400 border-amber-500/20",
    "Commercial":           "bg-green-500/10 text-green-400 border-green-500/20",
    "Security/Compliance":  "bg-red-500/10 text-red-400 border-red-500/20",
    "General Terms":        "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

async function fetchLibrary(): Promise<LibraryClause[]> {
    const res = await fetch("/api/proxy/api/v1/tender/clause-library");
    if (!res.ok) throw new Error("Failed to load clause library");
    return res.json();
}

async function saveClause(body: { id?: string; code?: string; category: string; title: string; content: string; tags?: string[] }) {
    const res = await fetch("/api/proxy/api/v1/tender/clause-library", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Save failed");
}

export function ClauseLibraryPanel({ onClose }: { onClose: () => void }) {
    const qc = useQueryClient();
    const [filterCat, setFilterCat] = useState<string>("");
    const [addMode, setAddMode] = useState(false);
    const [editClause, setEditClause] = useState<LibraryClause | null>(null);
    const [form, setForm] = useState({ category: CATEGORIES[0], title: "", content: "" });

    const { data: clauses = [], isLoading } = useQuery({ queryKey: ["clause-library"], queryFn: fetchLibrary });

    const saveMutation = useMutation({
        mutationFn: saveClause,
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["clause-library"] }); setAddMode(false); setEditClause(null); setForm({ category: CATEGORIES[0], title: "", content: "" }); },
    });

    const filtered = filterCat ? clauses.filter(c => c.category === filterCat) : clauses;

    function handleSave() {
        if (!form.title.trim() || !form.content.trim()) return;
        saveMutation.mutate({ ...(editClause ? { id: editClause.id } : {}), category: form.category, title: form.title, content: form.content });
    }

    function startEdit(cl: LibraryClause) {
        setEditClause(cl);
        setForm({ category: cl.category, title: cl.title, content: cl.content });
        setAddMode(true);
    }

    return (
        <div className="rounded-lg border border-border bg-card h-fit sticky top-4 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <h3 className="text-sm font-semibold text-foreground">Clause Library</h3>
                <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setAddMode(v => !v); setEditClause(null); setForm({ category: CATEGORIES[0], title: "", content: "" }); }} className="h-7 px-2 text-xs gap-1">
                        <Plus className="w-3 h-3" /> Add
                    </Button>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-4 h-4" /></button>
                </div>
            </div>

            {addMode && (
                <div className="px-4 py-3 border-b border-border space-y-2 shrink-0">
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground">
                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                        placeholder="Clause title" className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground" />
                    <Textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                        placeholder="Clause text…" rows={4} className="text-xs" />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} className="text-xs">
                            {saveMutation.isPending ? "Saving…" : (editClause ? "Update" : "Save")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setAddMode(false); setEditClause(null); }} className="text-xs">Cancel</Button>
                    </div>
                </div>
            )}

            {/* Category filter */}
            <div className="px-3 py-2 flex gap-1.5 flex-wrap shrink-0 border-b border-border/50">
                <button onClick={() => setFilterCat("")} className={`text-xs px-2 py-0.5 rounded-full border ${!filterCat ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>All</button>
                {CATEGORIES.map(cat => (
                    <button key={cat} onClick={() => setFilterCat(f => f === cat ? "" : cat)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${filterCat === cat ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                        {cat.split("/")[0]}
                    </button>
                ))}
            </div>

            <div className="overflow-y-auto flex-1 px-3 py-2 space-y-2">
                {isLoading && <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
                {filtered.map(cl => (
                    <div key={cl.id} className="p-2.5 rounded border border-border/50 hover:border-border bg-muted/10 space-y-1 cursor-pointer group" onClick={() => startEdit(cl)}>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-muted-foreground">{cl.code}</span>
                            <Badge className={`text-xs border shrink-0 ${CATEGORY_COLORS[cl.category] ?? "bg-muted/20 border-border text-muted-foreground"}`}>
                                {cl.category.split("/")[0]}
                            </Badge>
                        </div>
                        <p className="text-xs font-medium text-foreground">{cl.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{cl.content}</p>
                    </div>
                ))}
                {!isLoading && filtered.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No clauses in this category yet.</p>
                )}
            </div>
        </div>
    );
}
