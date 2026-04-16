"use client";

import { useEffect, useState } from "react";
import { AgentOrb } from "./AgentOrb";
import { cn } from "@/lib/utils";
import { ToolCall } from "./types";

// ---------------------------------------------------------------------------
// Tool name → human-readable label
// ---------------------------------------------------------------------------
const TOOL_LABELS: Record<string, string> = {
    retrieve_documents:  "Searching documents",
    web_search:          "Searching the web",
    GMAIL_SEND:          "Sending email",
    GMAIL_READ:          "Reading email",
    GCAL_CREATE_EVENT:   "Creating calendar event",
    GCAL_LIST_EVENTS:    "Checking calendar",
    code_execution:      "Running code",
    browser:             "Browsing the web",
    send_email:          "Sending email",
};

function friendlyToolLabel(toolName: string): string {
    if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
    if (toolName.startsWith("ZOHO_CRM")) return "Accessing CRM";
    if (toolName.startsWith("ZOHO_MAIL")) return "Sending email";
    if (toolName.startsWith("ZOHO_CLIQ")) return "Sending message";
    if (toolName.startsWith("GCAL")) return "Accessing calendar";
    if (toolName.startsWith("GMAIL")) return "Accessing email";
    if (toolName.startsWith("JIRA")) return "Accessing Jira";
    return "Using tools";
}

// ---------------------------------------------------------------------------
// Warmup steps
// ---------------------------------------------------------------------------
const WARMUP_STEPS = [
    "Starting your workspace...",
    "Loading agent runtime...",
    "Registering tools...",
    "Almost ready...",
];

const WARMUP_STEP_INTERVAL_MS = 8_000;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------


function PulsingDots() {
    return (
        <span className="flex gap-[3px] items-center">
            <span className="h-[4px] w-[4px] rounded-full bg-[#c4b5fd] animate-bounce [animation-delay:-0.3s]" />
            <span className="h-[4px] w-[4px] rounded-full bg-[#c4b5fd] animate-bounce [animation-delay:-0.15s]" />
            <span className="h-[4px] w-[4px] rounded-full bg-[#c4b5fd] animate-bounce" />
        </span>
    );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ThinkingIndicatorProps {
    isRetrying: boolean;
    isStreaming: boolean;
    activeToolCalls: ToolCall[];
    completedToolCallLabels: string[];
    hasContent: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ThinkingIndicator({
    isRetrying,
    isStreaming,
    activeToolCalls,
    completedToolCallLabels,
    hasContent,
}: ThinkingIndicatorProps) {
    const [stepIndex, setStepIndex] = useState(0);

    // Advance warmup step every 8 s; reset when retrying stops.
    useEffect(() => {
        if (!isRetrying) {
            setStepIndex(0);
            return;
        }
        setStepIndex(0);
        const id = setInterval(() => {
            setStepIndex(prev => Math.min(prev + 1, WARMUP_STEPS.length - 1));
        }, WARMUP_STEP_INTERVAL_MS);
        return () => clearInterval(id);
    }, [isRetrying]);

    // Collapse once content arrives
    if (hasContent) return null;

    // -----------------------------------------------------------------------
    // Phase 1 — container warmup
    // -----------------------------------------------------------------------
    if (isRetrying) {
        return (
            <div className="flex items-start gap-4 animate-in fade-in duration-300">
                <AgentOrb size={40} state="thinking" />
                <div className="flex flex-col gap-1.5 pt-1">
                    {WARMUP_STEPS.slice(0, stepIndex + 1).map((step, i) => {
                        const isDone = i < stepIndex;
                        const isCurrent = i === stepIndex;
                        return (
                            <div
                                key={step}
                                className={cn(
                                    "flex items-center gap-2 text-sm font-mono animate-in fade-in duration-500",
                                    isDone ? "text-[#3a3a3a]" : "text-[#c4b5fd]"
                                )}
                            >
                                {isDone ? (
                                    <span className="text-[#22c55e] text-xs w-4 shrink-0">✓</span>
                                ) : isCurrent ? (
                                    <span className="w-4 shrink-0 flex items-center">
                                        <PulsingDots />
                                    </span>
                                ) : null}
                                {step}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // -----------------------------------------------------------------------
    // Phase 2b — tool calls (active + completed)
    // -----------------------------------------------------------------------
    const loadingTools = activeToolCalls.filter(t => t.isLoading);
    if (isStreaming && (loadingTools.length > 0 || completedToolCallLabels.length > 0)) {
        return (
            <div className="flex items-start gap-4 animate-in fade-in duration-300">
                <AgentOrb size={40} state="searching" />
                <div className="flex flex-col gap-1.5 pt-1">
                    {completedToolCallLabels.map((label, i) => (
                        <div
                            key={`done-${i}`}
                            className="flex items-center gap-2 text-sm font-mono text-[#3a3a3a]"
                        >
                            <span className="text-[#22c55e] text-xs w-4 shrink-0">✓</span>
                            {label}
                        </div>
                    ))}
                    {loadingTools.map(tool => (
                        <div
                            key={tool.id}
                            className="flex items-center gap-2 text-sm font-mono text-[#c4b5fd] animate-in fade-in duration-300"
                        >
                            <span className="w-4 shrink-0 flex items-center">
                                <PulsingDots />
                            </span>
                            {friendlyToolLabel(tool.toolName)}...
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // -----------------------------------------------------------------------
    // Phase 2a — plain thinking
    // -----------------------------------------------------------------------
    if (isStreaming) {
        return (
            <div className="flex items-start gap-4 animate-in fade-in duration-300">
                <AgentOrb size={40} state="thinking" />
                <div className="flex items-center gap-2 pt-1.5">
                    <PulsingDots />
                    <span className="text-sm text-[#c4b5fd] font-mono">Thinking...</span>
                </div>
            </div>
        );
    }

    return null;
}
