"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Upload, X, CheckCircle2, AlertCircle } from "lucide-react";

interface FileStatus { name: string; status: "extracting" | "done" | "failed"; error?: string }

interface FormState {
    title: string; department: string; estimatedValue: string;
    category: string; procurementMode: string; contractDuration: string;
    bidSubmissionDate: string; preBidDate: string;
    requirementText: string;
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

    function setField(k: keyof FormState) { return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value })); }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;

        setFileStatuses(files.map(f => ({ name: f.name, status: "extracting" })));
        setForm(f => ({ ...f, requirementText: "" }));

        // Base64-encode each file and send as JSON — avoids API Gateway multipart corruption
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

            setFileStatuses(results.map(r => ({ name: r.filename, status: r.status as "done" | "failed", error: r.error })));

            const combined = results
                .filter(r => r.status === "done" && r.text)
                .map(r => `--- ${r.filename} ---\n${r.text}`)
                .join("\n\n");
            if (combined) setForm(f => ({ ...f, requirementText: combined }));
        } catch (err) {
            setFileStatuses(files.map(f => ({ name: f.name, status: "failed", error: (err as Error).message })));
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!form.title.trim() || !form.department.trim()) { setError("Title and Department are required."); return; }
        setSubmitting(true); setError("");

        try {
            const res = await fetch("/api/proxy/api/v1/tender/authoring", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: form.title.trim(),
                    department: form.department.trim(),
                    budget: form.estimatedValue ? Number(form.estimatedValue.replace(/[₹,\s]/g, "")) : undefined,
                    category: form.category,
                    procurementMode: form.procurementMode,
                    contractDuration: `${form.contractDuration} months`,
                    keyDates: {
                        ...(form.preBidDate ? { preBidMeeting: form.preBidDate } : {}),
                        ...(form.bidSubmissionDate ? { bidSubmission: form.bidSubmissionDate } : {}),
                    },
                    requirementText: form.requirementText.trim() || undefined,
                }),
            });

            if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed to create tender"); }
            const data = await res.json();
            router.push(`/${tenant}/dashboard/tender-evaluation/${data.tenderId}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
            setSubmitting(false);
        }
    }

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <button onClick={() => router.push(`/${tenant}/dashboard/tender-evaluation`)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3">
                    <ArrowLeft className="w-3 h-3" /> All Tenders
                </button>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Create Tender</h1>
                <p className="text-sm text-muted-foreground mt-1">Fill the template below. Saarthi will draft a complete 8-section RFP.</p>
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
                                    This demo runs the Two-Bid (Technical + Financial) evaluation flow. The production platform supports all procurement methods; this mode is not enabled in the demo.
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
                                {fileStatuses.length ? `${fileStatuses.length} file${fileStatuses.length > 1 ? "s" : ""} attached` : "Attach indent / DPR / note"}
                                {fileStatuses.length > 0 && (
                                    <button type="button" onClick={() => { setFileStatuses([]); setForm(f => ({ ...f, requirementText: "" })); }} className="ml-1"><X className="w-3 h-3" /></button>
                                )}
                                <input type="file" accept=".txt,.md,.pdf,.docx" multiple onChange={handleFileChange} className="hidden" />
                            </label>
                            <span className="text-xs text-muted-foreground">PDF, DOCX, TXT, MD · up to 5 files · or paste text below</span>
                        </div>
                        {fileStatuses.length > 0 && (
                            <div className="space-y-1">
                                {fileStatuses.map(f => (
                                    <div key={f.name} className="flex items-center gap-2 text-xs">
                                        {f.status === "extracting" && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                                        {f.status === "done" && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                                        {f.status === "failed" && <AlertCircle className="w-3 h-3 text-red-400" />}
                                        <span className={f.status === "failed" ? "text-red-400" : "text-foreground"}>{f.name}</span>
                                        {f.status === "extracting" && <span className="text-muted-foreground">extracting…</span>}
                                        {f.status === "failed" && <span className="text-red-400">{f.error ?? "failed"}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                        <Textarea value={form.requirementText} onChange={setField("requirementText")} rows={6}
                            placeholder="Paste the requirement document text here (indent / DPR / note). The agent will use this to draft a contextually accurate RFP. If left blank, Saarthi drafts from the title and department." className="text-xs" />
                        <p className="text-xs text-muted-foreground">Scanned PDFs are OCR'd via Gemini Vision. The agent reads up to 8,000 characters.</p>
                    </div>
                </Section>

                {error && <p className="text-sm text-red-400">{error}</p>}

                <Button type="submit" disabled={submitting || form.category !== "IT/Software" || form.procurementMode !== PROC_MODES[0]} className="w-full bg-primary text-primary-foreground gap-2">
                    {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" />Generating RFP — this takes ~30s…</>) : "Generate RFP →"}
                </Button>
            </form>
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
