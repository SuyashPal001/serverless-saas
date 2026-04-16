"use client";

import { useState, useRef } from "react";
import { ArrowLeft, ArrowRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PillType = "summarize" | "schedule" | "research" | "draft";

interface WizardViewProps {
    pill: PillType;
    onSubmit: (prompt: string) => void;
    onBack: () => void;
    children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WIZARD_CONFIG: Record<PillType, { title: string; step1Label: string }> = {
    summarize: {
        title: "📄 Summarize a document",
        step1Label: "Paste your text or upload a file",
    },
    schedule: {
        title: "📅 Schedule a meeting",
        step1Label: "Meeting details",
    },
    research: {
        title: "🔍 Research a topic",
        step1Label: "What would you like to research?",
    },
    draft: {
        title: "✍️ Draft an email",
        step1Label: "Who and what",
    },
};

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(pill: PillType, fields: Record<string, string>): string {
    switch (pill) {
        case "summarize":
            return `Please summarize the following text. Focus on ${fields.summaryType || "key points"}.\n\n${fields.content}`;
        case "schedule":
            return `Schedule a meeting titled '${fields.title}' with ${fields.invitees || "no additional invitees"} on ${fields.date} at ${fields.time} for ${fields.duration}. Send calendar invites.`;
        case "research":
            return `Research '${fields.topic}' and give me a ${fields.depth || "quick overview"}.`;
        case "draft":
            return `Draft a ${fields.tone} email to ${fields.recipient} about: ${fields.subject}.`;
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function canAdvance(pill: PillType, fields: Record<string, string>): boolean {
    switch (pill) {
        case "summarize": return (fields.content ?? "").trim().length > 0;
        case "schedule":  return (fields.title ?? "").trim().length > 0;
        case "research":  return (fields.topic ?? "").trim().length > 0;
        case "draft":     return (fields.recipient ?? "").trim().length > 0 && (fields.subject ?? "").trim().length > 0;
    }
}

function canSubmit(pill: PillType, fields: Record<string, string>): boolean {
    switch (pill) {
        case "summarize": return (fields.content ?? "").trim().length > 0;
        case "schedule":  return !!(fields.title && fields.date && fields.time && fields.duration);
        case "research":  return !!(fields.topic && fields.depth);
        case "draft":     return !!(fields.recipient && fields.subject && fields.tone);
    }
}

// ---------------------------------------------------------------------------
// Pill choice button
// ---------------------------------------------------------------------------

function ChoicePill({
    label,
    selected,
    onSelect,
}: {
    label: string;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <Button
            type="button"
            variant={selected ? "default" : "outline"}
            className="rounded-full px-5 py-2 h-auto text-sm font-medium transition-colors"
            onClick={onSelect}
        >
            {label}
        </Button>
    );
}

// ---------------------------------------------------------------------------
// Field label
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
    return (
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            {children}
        </label>
    );
}

// ---------------------------------------------------------------------------
// Step renderers
// ---------------------------------------------------------------------------

function SummarizeStep1({
    fields,
    setField,
}: {
    fields: Record<string, string>;
    setField: (k: string, v: string) => void;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            setField("content", ev.target?.result as string ?? "");
        };
        reader.readAsText(file);
        // Reset so the same file can be re-selected
        e.target.value = "";
    };

    return (
        <div className="space-y-3 w-full">
            <FieldLabel>Paste your document or text here</FieldLabel>
            <Textarea
                value={fields.content ?? ""}
                onChange={(e) => setField("content", e.target.value)}
                placeholder="Paste text here..."
                className="min-h-[180px] resize-none text-sm"
                autoFocus
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>or</span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 px-3 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Upload className="h-3 w-3" />
                    Upload file
                </Button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.csv,.json"
                    className="hidden"
                    onChange={handleFile}
                />
                <span className="text-muted-foreground/60">.txt, .md, .csv, .json</span>
            </div>
        </div>
    );
}

function SummarizeStep2({
    fields,
    setField,
}: {
    fields: Record<string, string>;
    setField: (k: string, v: string) => void;
}) {
    const choices = ["Key points", "Brief overview", "Detailed analysis"];
    return (
        <div className="space-y-3 w-full">
            <FieldLabel>What kind of summary?</FieldLabel>
            <div className="flex flex-wrap gap-2">
                {choices.map((c) => (
                    <ChoicePill
                        key={c}
                        label={c}
                        selected={fields.summaryType === c}
                        onSelect={() => setField("summaryType", c)}
                    />
                ))}
            </div>
        </div>
    );
}

function ScheduleStep1({
    fields,
    setField,
}: {
    fields: Record<string, string>;
    setField: (k: string, v: string) => void;
}) {
    return (
        <div className="space-y-4 w-full">
            <div>
                <FieldLabel>Meeting title</FieldLabel>
                <Input
                    value={fields.title ?? ""}
                    onChange={(e) => setField("title", e.target.value)}
                    placeholder="e.g. Weekly sync"
                    autoFocus
                />
            </div>
            <div>
                <FieldLabel>Invite (email addresses, comma separated)</FieldLabel>
                <Input
                    value={fields.invitees ?? ""}
                    onChange={(e) => setField("invitees", e.target.value)}
                    placeholder="alice@example.com, bob@example.com"
                />
            </div>
        </div>
    );
}

function ScheduleStep2({
    fields,
    setField,
}: {
    fields: Record<string, string>;
    setField: (k: string, v: string) => void;
}) {
    const durations = ["30 min", "1 hour", "2 hours"];
    return (
        <div className="space-y-4 w-full">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <FieldLabel>Date</FieldLabel>
                    <Input
                        value={fields.date ?? ""}
                        onChange={(e) => setField("date", e.target.value)}
                        placeholder="e.g. tomorrow, Dec 20"
                        autoFocus
                    />
                </div>
                <div>
                    <FieldLabel>Time</FieldLabel>
                    <Input
                        value={fields.time ?? ""}
                        onChange={(e) => setField("time", e.target.value)}
                        placeholder="e.g. 3pm, 15:00"
                    />
                </div>
            </div>
            <div>
                <FieldLabel>Duration</FieldLabel>
                <div className="flex flex-wrap gap-2">
                    {durations.map((d) => (
                        <ChoicePill
                            key={d}
                            label={d}
                            selected={fields.duration === d}
                            onSelect={() => setField("duration", d)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ResearchStep1({
    fields,
    setField,
}: {
    fields: Record<string, string>;
    setField: (k: string, v: string) => void;
}) {
    return (
        <div className="space-y-3 w-full">
            <FieldLabel>What would you like to research?</FieldLabel>
            <Input
                value={fields.topic ?? ""}
                onChange={(e) => setField("topic", e.target.value)}
                placeholder="e.g. quantum computing, market trends in SaaS..."
                autoFocus
            />
        </div>
    );
}

function ResearchStep2({
    fields,
    setField,
}: {
    fields: Record<string, string>;
    setField: (k: string, v: string) => void;
}) {
    const choices = ["Quick overview", "Deep dive", "Recent news only"];
    return (
        <div className="space-y-3 w-full">
            <FieldLabel>How deep should I go?</FieldLabel>
            <div className="flex flex-wrap gap-2">
                {choices.map((c) => (
                    <ChoicePill
                        key={c}
                        label={c}
                        selected={fields.depth === c}
                        onSelect={() => setField("depth", c)}
                    />
                ))}
            </div>
        </div>
    );
}

function DraftStep1({
    fields,
    setField,
}: {
    fields: Record<string, string>;
    setField: (k: string, v: string) => void;
}) {
    return (
        <div className="space-y-4 w-full">
            <div>
                <FieldLabel>To (name or email)</FieldLabel>
                <Input
                    value={fields.recipient ?? ""}
                    onChange={(e) => setField("recipient", e.target.value)}
                    placeholder="e.g. Sarah, sarah@example.com"
                    autoFocus
                />
            </div>
            <div>
                <FieldLabel>Subject / what&apos;s it about?</FieldLabel>
                <Input
                    value={fields.subject ?? ""}
                    onChange={(e) => setField("subject", e.target.value)}
                    placeholder="e.g. project update, meeting request..."
                />
            </div>
        </div>
    );
}

function DraftStep2({
    fields,
    setField,
}: {
    fields: Record<string, string>;
    setField: (k: string, v: string) => void;
}) {
    const choices = ["Formal", "Friendly", "Brief and direct"];
    return (
        <div className="space-y-3 w-full">
            <FieldLabel>Tone</FieldLabel>
            <div className="flex flex-wrap gap-2">
                {choices.map((c) => (
                    <ChoicePill
                        key={c}
                        label={c}
                        selected={fields.tone === c}
                        onSelect={() => setField("tone", c)}
                    />
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WizardView({ pill, onSubmit, onBack, children }: WizardViewProps) {
    const [step, setStep] = useState<1 | 2>(1);
    const [fields, setFields] = useState<Record<string, string>>({});

    const setField = (key: string, value: string) =>
        setFields((prev) => ({ ...prev, [key]: value }));

    const config = WIZARD_CONFIG[pill];
    const advanceOk = canAdvance(pill, fields);
    const submitOk = canSubmit(pill, fields);

    const handleSubmit = () => {
        if (!submitOk) return;
        onSubmit(buildPrompt(pill, fields));
    };

    const renderStepContent = () => {
        if (pill === "summarize") {
            return step === 1
                ? <SummarizeStep1 fields={fields} setField={setField} />
                : <SummarizeStep2 fields={fields} setField={setField} />;
        }
        if (pill === "schedule") {
            return step === 1
                ? <ScheduleStep1 fields={fields} setField={setField} />
                : <ScheduleStep2 fields={fields} setField={setField} />;
        }
        if (pill === "research") {
            return step === 1
                ? <ResearchStep1 fields={fields} setField={setField} />
                : <ResearchStep2 fields={fields} setField={setField} />;
        }
        // draft
        return step === 1
            ? <DraftStep1 fields={fields} setField={setField} />
            : <DraftStep2 fields={fields} setField={setField} />;
    };

    return (
        <div className="flex flex-col h-full">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-3 shrink-0">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2"
                    onClick={onBack}
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
                <span className="text-xs text-muted-foreground">
                    Step {step} of 2
                </span>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col items-center justify-center px-8 py-6">
                <div className="w-full max-w-lg">
                    <h2 className="text-xl font-semibold mb-1">{config.title}</h2>
                    <p className="text-sm text-muted-foreground mb-6">{config.step1Label}</p>

                    {renderStepContent()}

                    {/* Action button */}
                    <div className="flex justify-end mt-6">
                        {step === 1 ? (
                            <Button
                                type="button"
                                className="gap-1.5"
                                disabled={!advanceOk}
                                onClick={() => setStep(2)}
                            >
                                Continue
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                className="gap-1.5"
                                disabled={!submitOk}
                                onClick={handleSubmit}
                            >
                                Send
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* ChatInput slot */}
            <div className="shrink-0 pt-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                {children}
            </div>
        </div>
    );
}
