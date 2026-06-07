"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useChat } from "@/hooks/useChat";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare, Send, Loader2 } from "lucide-react";
import { TenderChatMessage, StreamingBubble } from "./TenderChatMessage";
import type { Msg, ToolCallItem } from "./TenderChatMessage";

export default function TenderAdvisorChatPage() {
    const params = useParams();
    const router = useRouter();
    const tenderId = params.id as string;
    const tenant = params.tenant as string;

    const convId = useRef(
        typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    );

    const [messages, setMessages] = useState<Msg[]>([]);
    const [input, setInput] = useState("");
    const [streamingText, setStreamingText] = useState("");
    const [activeToolCalls, setActiveToolCalls] = useState<Map<string, string>>(new Map());
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, streamingText, activeToolCalls.size]);

    const { sendMessage, isStreaming } = useChat({
        conversationId: convId.current,
        agentId: "tender-advisor",
        tenderId,
        onDelta: (delta) => setStreamingText((prev) => prev + delta),
        onDone: (fullText) => {
            setMessages((prev) => [
                ...prev,
                { id: crypto.randomUUID(), role: "assistant", text: fullText },
            ]);
            setStreamingText("");
            setActiveToolCalls(new Map());
        },
        onToolCall: (toolName, toolCallId) => {
            setActiveToolCalls((prev) => new Map(prev).set(toolCallId, toolName));
        },
        onToolDone: (toolCallId) => {
            setActiveToolCalls((prev) => {
                const next = new Map(prev);
                next.delete(toolCallId);
                return next;
            });
        },
        onError: (_code, msg) => {
            setMessages((prev) => [
                ...prev,
                { id: crypto.randomUUID(), role: "assistant", text: `Error: ${msg}` },
            ]);
            setStreamingText("");
            setActiveToolCalls(new Map());
        },
    });

    const handleSend = useCallback(async () => {
        const text = input.trim();
        if (!text || isStreaming) return;
        setInput("");
        setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "user", text },
        ]);
        await sendMessage(text);
    }, [input, isStreaming, sendMessage]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend],
    );

    const isIdle = !isStreaming && activeToolCalls.size === 0 && streamingText === "";

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[900px]">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur shrink-0">
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground hover:text-foreground px-2"
                    onClick={() => router.push(`/${tenant}/dashboard/tender-evaluation/${tenderId}`)}
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </Button>
                <div className="flex items-center gap-2 ml-1">
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                        <MessageSquare className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-foreground leading-tight">
                            Tender Evaluation — Chat with Advisor
                        </p>
                        <p className="text-xs text-muted-foreground leading-tight">
                            AI-powered tender analysis assistant
                        </p>
                    </div>
                </div>
            </div>

            {/* Message list */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
                {messages.length === 0 && isIdle && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <MessageSquare className="w-6 h-6 text-primary/60" />
                        </div>
                        <p className="text-muted-foreground text-sm max-w-xs">
                            Ask anything about this tender — findings, bidder comparisons, shortfalls, or the final recommendation.
                        </p>
                    </div>
                )}
                {messages.map((msg) => (
                    <TenderChatMessage key={msg.id} msg={msg} />
                ))}
                <StreamingBubble text={streamingText} activeToolCalls={activeToolCalls} />
                <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div className="shrink-0 border-t border-border bg-background/80 backdrop-blur px-4 py-3">
                <div className="flex items-end gap-2 max-w-3xl mx-auto">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about this tender…"
                        rows={1}
                        disabled={isStreaming}
                        className="flex-1 resize-none bg-muted/30 border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 min-h-[42px] max-h-[120px] overflow-y-auto"
                        style={{ height: "42px", overflowY: input.split("\n").length > 2 ? "auto" : "hidden" }}
                        onInput={(e) => {
                            const el = e.currentTarget;
                            el.style.height = "42px";
                            el.style.height = Math.min(el.scrollHeight, 120) + "px";
                        }}
                    />
                    <Button
                        size="sm"
                        onClick={handleSend}
                        disabled={!input.trim() || isStreaming}
                        className="h-[42px] w-[42px] p-0 rounded-xl shrink-0"
                    >
                        {isStreaming
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Send className="w-4 h-4" />}
                    </Button>
                </div>
                <p className="text-center text-xs text-muted-foreground/50 mt-2">
                    Shift+Enter for new line · Enter to send
                </p>
            </div>
        </div>
    );
}
