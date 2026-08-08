"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Upload, X, CheckCircle2, AlertCircle, Eye } from "lucide-react";

interface FileStatus {
    name: string; status: "extracting" | "done" | "failed";
    error?: string; charCount?: number;
}

interface FormState {
    title: string; department: string; estimatedValue: string;
    category: string; procurementMode: string; contractDuration: string;
    bidSubmissionDate: string; preBidDate: string; requirementText: string;
}

const CATEGORIES = ["IT/Software", "Infrastructure", "Consultancy", "Supply & Installation", "Maintenance & AMC", "Other"];
const PROC_MODES = ["Two-Bid (Technical + Financial)", "Single Bid (L1)", "QCBS (Quality & Cost Based)", "Limited Tender"];

export default function CreateTenderPage() {
    const router = useRouter();
    const params = useParams();
    const tenant = params.tenant as string;

    const [form, setForm] = useState<FormState>({
        title: "", department: "", estimatedValue: "", category: CATEGORIES[0],
        procurementMode: PROC_MODES[0], contractDuration: "36",
        bidSubmissionDate: "", preBidDate: "", requirementText: "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
    const [extractedTexts, setExtractedTexts] = useState<Record<string, string>>({});
    const [previewFile, setPreviewFile] = useState<string | null>(null);

    function setField(k: keyof FormState) {
        return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
            setForm(f => ({ ...f, [k]: e.target.value }));
    }

    function removeFile(name: string) {
        setFileStatuses(fs => fs.filter(f => f.name !== name));
        setExtractedTexts(et => { const n = { ...et }; delete n[name]; return n; });
    }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;

        setFileStatuses(prev => [
            ...prev.filter(f => f.status !== "extracting"),
            ...files.map(f => ({ name: f.name, status: "extracting" as const })),
        ]);

        const encoded = await Promise.all(files.map(async (f) => {
            const buf = await f.arrayBuffer();
            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
            return { name: f.name, mimeType: f.type || "application/octet-stream", dataBase64: b64 };
        }));

        try {
            const res = await fetch("/api/proxy/api/v1/tender/authoring/extract-text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files: encoded }),
            });
            const data = await res.json() as { results?: Array<{ filename: string; text: string; status: string; error?: string }> };
            const results = data.results ?? [];

            setExtractedTexts(prev => {
                const n = { ...prev };
                results.forEach(r => { if (r.status === "done" && r.text) n[r.filename] = r.text; });
                return n;
            });
            setFileStatuses(prev => {
                const incoming = new Map(results.map(r => [r.filename, r]));
                return prev.map(f => {
                    const r = incoming.get(f.name);
                    if (!r) return f;
                    return { name: r.filename, status: r.status as "done" | "failed", error: r.error, charCount: r.text?.length };
                });
            });
        } catch (err) {
            setFileStatuses(prev => prev.map(f =>
                f.status === "extracting" ? { ...f, status: "failed" as const, error: (err as Error).message } : f
            ));
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!form.title.trim() || !form.department.trim()) { setError("Title and Department are required."); return; }
        setSubmitting(true); setError("");

        const fileText = fileStatuses
            .filter(f => f.status === "done")
            .map(f => `--- ${f.name} ---\n${extractedTexts[f.name] ?? ""}`)
            .join("\n\n");

        try {
            const res = await fetch("/api/proxy/api/v1/tender/authoring", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: form.title.trim(), department: form.department.trim(),
                    budget: form.estimatedValue ? Number(form.estimatedValue.replace(/[₹,\s]/g, "")) : undefined,
                    category: form.category, procurementMode: form.procurementMode,
                    contractDuration: `${form.contractDuration} months`,
                    keyDates: {
                        ...(form.preBidDate ? { preBidMeeting: form.preBidDate } : {}),
                        ...(form.bidSubmissionDate ? { bidSubmission: form.bidSubmissionDate } : {}),
                    },
                    requirementText: (fileText || form.requirementText).trim() || undefined,
                }),
            });
            if (!res.ok) {
                const ct = res.headers.get("content-type") ?? "";
                const e = ct.includes("application/json") ? await res.json() : {};
                throw new Error(e.error ?? `Server error ${res.status} — please retry`);
            }
            const data = await res.json();
            router.push(`/${tenant}/dashboard/tender-evaluation/${data.tenderId}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
            setSubmitting(false);
        }
    }

    const hasFiles = fileStatuses.length > 0;

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <button onClick={() => router.push(`/${tenant}/dashboard/tender-evaluation`)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3">
                    <ArrowLeft className="w-3 h-3" /> All Tenders
                </button>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Create Tender</h1>
                <p className="text-sm text-muted-foreground mt-1">Fill the template below. The Tender Author agent will draft a complete 8-section RFP.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
                <Section label="Basic Information">
                    <Field label="Tender Title *"><input value={form.title} onChange={setField("title")} placeholder="e.g. HRMS Implementation for Directorate of IT" required className={inputCls} /></Field>
                    <Field label="Department *"><input value={form.department} onChange={setField("department")} placeholder="e.g. Directorate of Information Technology" required className={inputCls} /></Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Estimated Value (₹)"><input value={form.estimatedValue} onChange={setField("estimatedValue")} placeholder="e.g. 85000000" className={inputCls} /></Field>
                        <Field label="Category">
                            <select value={form.category} onChange={setField("category")} className={inputCls}>
                                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                            </select>
                            {form.category !== "IT/Software" && (
                                <p className="mt-1.5 text-xs text-amber-400 leading-relaxed">
                                    This demo supports IT/Software procurement. The production platform handles all procurement categories; this category is not enabled in the demo.
                                </p>
                            )}
                        </Field>
                    </div>
                </Section>

                <Section label="Procurement Details">
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Procurement Mode">
                            <select value={form.procurementMode} onChange={setField("procurementMode")} className={inputCls}>
                                {PROC_MODES.map(m => <option key={m}>{m}</option>)}
                            </select>
                            {form.procurementMode !== PROC_MODES[0] && (
                                <p className="mt-1.5 text-xs text-amber-400 leading-relaxed">
                                    This demo runs the Two-Bid evaluation flow. The production platform supports all procurement methods; this mode is not enabled in the demo.
                                </p>
                            )}
                        </Field>
                        <Field label="Contract Duration (months)"><input value={form.contractDuration} onChange={setField("contractDuration")} type="number" min="1" max="120" className={inputCls} /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Pre-Bid Meeting Date"><input value={form.preBidDate} onChange={setField("preBidDate")} type="date" className={inputCls} /></Field>
                        <Field label="Bid Submission Date"><input value={form.bidSubmissionDate} onChange={setField("bidSubmissionDate")} type="date" className={inputCls} /></Field>
                    </div>
                </Section>

                <Section label="Requirement Document">
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 flex-wrap">
                            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground border border-border rounded px-3 py-2 hover:border-foreground/40 transition-colors">
                                <Upload className="w-3.5 h-3.5" />
                                {hasFiles ? "Attach more" : "Attach indent / DPR / note"}
                                <input type="file" accept=".txt,.md,.pdf,.docx" multiple onChange={handleFileChange} className="hidden" />
                            </label>
                            {!hasFiles && <span className="text-xs text-muted-foreground">PDF · DOCX · TXT · up to 5 files · or paste below</span>}
                        </div>

                        {hasFiles && (
                            <div className="space-y-1.5">
                                {fileStatuses.map(f => (
                                    <div key={f.name} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20 text-xs">
                                        {f.status === "extracting" && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
                                        {f.status === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                                        {f.status === "failed" && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                                        <span className="font-medium text-foreground truncate flex-1 min-w-0">{f.name}</span>
                                        {f.status === "done" && !!f.charCount && (
                                            <span className="text-muted-foreground shrink-0">{(f.charCount / 1000).toFixed(1)}K chars</span>
                                        )}
                                        {f.status === "extracting" && <span className="text-muted-foreground shrink-0">extracting…</span>}
                                        {f.status === "failed" && <span className="text-red-400 shrink-0 max-w-[140px] truncate">{f.error ?? "failed"}</span>}
                                        {f.status === "done" && (
                                            <button type="button" onClick={() => setPreviewFile(f.name)}
                                                className="flex items-center gap-1 shrink-0 text-primary hover:text-primary/80 font-medium transition-colors">
                                                <Eye className="w-3 h-3" /> Preview
                                            </button>
                                        )}
                                        <button type="button" onClick={() => removeFile(f.name)}
                                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                                <button type="button" onClick={() => { setFileStatuses([]); setExtractedTexts({}); }}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors pl-0.5">
                                    Clear all
                                </button>
                            </div>
                        )}

                        {!hasFiles && (
                            <Textarea value={form.requirementText} onChange={setField("requirementText")} rows={6}
                                placeholder="Paste the requirement document text here (indent / DPR / note). The Tender Author agent will use this to draft a contextually accurate RFP. If left blank, it drafts from the title and department."
                                className="text-xs" />
                        )}

                        <p className="text-xs text-muted-foreground">PDF · DOCX · scanned documents · on-platform OCR · multiple files combined.</p>
                    </div>
                </Section>

                {error && <p className="text-sm text-red-400">{error}</p>}

                <Button type="submit" disabled={submitting || form.category !== "IT/Software" || form.procurementMode !== PROC_MODES[0]}
                    className="w-full bg-primary text-primary-foreground gap-2">
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Generating RFP…</> : "Generate RFP →"}
                </Button>
            </form>

            {previewFile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewFile(null)}>
                    <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                            <span className="text-sm font-medium text-foreground truncate">{previewFile}</span>
                            <button onClick={() => setPreviewFile(null)} className="text-muted-foreground hover:text-foreground ml-4 shrink-0">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <pre className="flex-1 overflow-auto p-4 text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed">
                            {extractedTexts[previewFile] ?? "No text extracted."}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</h3>
            <div className="space-y-3 p-4 rounded-lg border border-border bg-card">{children}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">{label}</label>{children}</div>;
}

const inputCls = "w-full text-sm bg-background border border-border rounded px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60";
