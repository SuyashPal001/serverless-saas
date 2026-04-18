"use client";

import { useEffect, useState } from "react";
import { AgentOrb } from "./AgentOrb";
import { cn } from "@/lib/utils";
import { ToolCall, CompletedToolCall } from "./types";
import { ToolCallCard } from "./ToolCallCard";

const WARMUP_STEPS = [
    "Starting your workspace...",
    "Loading agent runtime...",
    "Registering tools...",
    "Almost ready...",
];

const WARMUP_STEP_INTERVAL_MS = 8_000;

function PulsingDots() {
    return (
        <span className="flex gap-[3px] items-center">
            <span className="h-[4px] w-[4px] rounded-full bg-[#c4b5fd] animate-bounce [animation-delay:-0.3s]" />
            <span className="h-[4px] w-[4px] rounded-full bg-[#c4b5fd] animate-bounce [animation-delay:-0.15s]" />
            <span className="h-[4px] w-[4px] rounded-full bg-[#c4b5fd] animate-bounce" />
        </span>
    );
}

export interface ThinkingIndicatorProps {
    isRetrying: boolean;
    isStreaming: boolean;
    activeToolCalls: ToolCall[];
    completedToolCalls: CompletedToolCall[];
    hasContent: boolean;
}

export function ThinkingIndicator({
    isRetrying,
    isStreaming,
    activeToolCalls,
    completedToolCalls,
    hasContent,
}: ThinkingIndicatorProps) {
    const [stepIndex, setStepIndex] = useState(0);

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

    if (hasContent) return null;

    // Phase 1 — container warmup
    if (isRetrying) {
        return (
            <div className="flex items-start gap-4 animate-in fade-in duration-300">
                <AgentOrb size={40} state="thinking" isLoading />
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

    // Phase 2b — tool calls (active + completed)
    const loadingTools = activeToolCalls.filter(t => t.isLoading);
    if (isStreaming && (loadingTools.length > 0 || completedToolCalls.length > 0)) {
        return (
            <div className="flex items-start gap-4 animate-in fade-in duration-300">
                <AgentOrb size={40} state="searching" isLoading />
                <div className="flex-1 pt-1">
                    {completedToolCalls.map(tc => (
                        <ToolCallCard
                            key={tc.id}
                            toolName={tc.toolName}
                            query={tc.query}
                            status="done"
                            results={tc.results}
                        />
                    ))}
                    {loadingTools.map(tool => (
                        <ToolCallCard
                            key={tool.id}
                            toolName={tool.toolName}
                            query={String(tool.arguments?.query ?? tool.arguments?.filename ?? tool.arguments?.subject ?? '')}
                            status="loading"
                        />
                    ))}
                </div>
            </div>
        );
    }

    // Phase 2a — plain thinking
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
