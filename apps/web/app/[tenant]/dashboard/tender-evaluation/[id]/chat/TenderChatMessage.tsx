"use client";

import { Bot, User, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToolCallItem {
    toolCallId: string;
    toolName: string;
    done: boolean;
}

export interface Msg {
    id: string;
    role: "user" | "assistant";
    text: string;
    toolCalls?: ToolCallItem[];
}

const TOOL_LABELS: Record<string, string> = {
    run_pq: "Document Reader",
    run_financial: "Document Reader",
    run_technical: "Evaluator",
    run_shortfall: "System",
    run_report: "System",
    get_pq_findings: "Advisor",
    get_technical_findings: "Advisor",
    get_shortfalls: "Advisor",
    get_financial: "Advisor",
    get_report: "Advisor",
    get_bid_text: "Advisor",
};

function toolLabel(name: string): string {
    return TOOL_LABELS[name] ?? name;
}

function ToolChip({ item }: { item: ToolCallItem }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium mr-1 mb-1",
                item.done
                    ? "bg-green-500/10 border-green-500/20 text-green-400"
                    : "bg-amber-500/10 border-amber-500/20 text-amber-400",
            )}
        >
            {item.done
                ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                : <Loader2 className="w-3 h-3 shrink-0 animate-spin" />}
            {toolLabel(item.toolName)}
        </span>
    );
}

export function TenderChatMessage({ msg }: { msg: Msg }) {
    const isUser = msg.role === "user";
    return (
        <div className={cn("flex gap-3 w-full", isUser ? "justify-end" : "justify-start")}>
            {!isUser && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                </div>
            )}
            <div className={cn("max-w-[78%] flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="flex flex-wrap">
                        {msg.toolCalls.map(tc => <ToolChip key={tc.toolCallId} item={tc} />)}
                    </div>
                )}
                <div
                    className={cn(
                        "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                        isUser
                            ? "bg-primary/10 text-foreground rounded-tr-sm"
                            : "bg-muted/30 text-foreground rounded-tl-sm border border-border/40",
                    )}
                >
                    {msg.text}
                </div>
            </div>
            {isUser && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted/40 flex items-center justify-center mt-0.5">
                    <User className="w-4 h-4 text-muted-foreground" />
                </div>
            )}
        </div>
    );
}

export function StreamingBubble({
    text,
    activeToolCalls,
}: {
    text: string;
    activeToolCalls: Map<string, string>;
}) {
    const hasTools = activeToolCalls.size > 0;
    const hasText = text.length > 0;
    if (!hasTools && !hasText) return null;

    return (
        <div className="flex gap-3 w-full justify-start">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center mt-0.5">
                <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="max-w-[78%] flex flex-col gap-1 items-start">
                {hasTools && (
                    <div className="flex flex-wrap">
                        {Array.from(activeToolCalls.entries()).map(([id, name]) => (
                            <ToolChip key={id} item={{ toolCallId: id, toolName: name, done: false }} />
                        ))}
                    </div>
                )}
                {hasText && (
                    <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-muted/30 text-foreground border border-border/40">
                        {text}
                        <span className="inline-block w-0.5 h-3.5 bg-primary ml-0.5 animate-pulse align-text-bottom" />
                    </div>
                )}
                {!hasText && hasTools && (
                    <div className="rounded-2xl rounded-tl-sm px-3 py-2 bg-muted/30 border border-border/40">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                )}
            </div>
        </div>
    );
}
