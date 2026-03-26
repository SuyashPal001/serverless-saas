"use client";

import { useEffect, useRef } from "react";
import { Bot, User, Terminal, Info, MessageSquare, Image as ImageIcon, FileText } from "lucide-react";
import { Message } from "./types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

import { ToolCallCard } from "./ToolCallCard";
import { StreamingMessage } from "./StreamingMessage";

interface MessageThreadProps {
    messages: Message[];
    isLoading?: boolean;
    isTyping?: boolean;
    activeToolCalls?: Message["toolCalls"];
    error?: string | null;
}

export function MessageThread({ messages, isLoading, isTyping, activeToolCalls, error }: MessageThreadProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    if (isLoading && messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                    <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading messages...</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-6 pb-4">
                {messages.length === 0 && !isTyping && (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                            <MessageSquare className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-medium">No messages yet</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                            Send a message to start the conversation.
                        </p>
                    </div>
                )}

                {messages.map((message) => (
                    <MessageItem key={message.id} message={message} />
                ))}

                {isTyping && (
                    <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20">
                            <Bot className="h-4 w-4" />
                        </div>
                        <div className="bg-muted rounded-2xl px-4 py-2 mt-1 border border-border/50">
                            <div className="flex gap-1 h-4 items-center">
                                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.3s]" />
                                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.15s]" />
                                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" />
                            </div>
                        </div>
                    </div>
                )}

                {activeToolCalls && activeToolCalls.length > 0 && (
                    <div className="flex items-start gap-3 mt-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20">
                            <Bot className="h-4 w-4" />
                        </div>
                        <div className="flex-1 max-w-[80%] pt-1">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2 px-1">
                                <span className="text-xs uppercase font-semibold tracking-wider">Using Tools</span>
                            </div>
                            <div className="space-y-2">
                                {activeToolCalls.map(tool => (
                                    <ToolCallCard
                                        key={tool.id}
                                        toolName={tool.toolName}
                                        toolCallId={tool.id}
                                        arguments={tool.arguments}
                                        result={tool.result}
                                        error={tool.error}
                                        isLoading={tool.isLoading}
                                        durationMs={tool.durationMs}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                
                {error && (
                    <div className="flex justify-center mt-6">
                        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm max-w-[80%] text-center">
                            {error}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function MessageItem({ message }: { message: Message }) {
    const isAssistant = message.role === 'assistant';
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system' || message.role === 'tool';

    if (isSystem) {
        return (
            <div className="flex justify-center my-4">
                <div className="bg-muted px-3 py-1 rounded-full text-[10px] flex items-center gap-2 text-muted-foreground uppercase tracking-wider font-semibold">
                    {message.role === 'tool' ? <Terminal className="h-3 w-3" /> : <Info className="h-3 w-3" />}
                    {message.role}: {message.content}
                </div>
            </div>
        );
    }

    return (
        <div className={cn(
            "flex items-start gap-3",
            isUser ? "flex-row-reverse" : "flex-row"
        )}>
            <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-sm",
                isAssistant ? "bg-primary/10 text-primary border-primary/20" : "bg-background text-foreground border-border"
            )}>
                {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </div>
            
            <div className={cn(
                "flex flex-col gap-1 w-full flex-1 max-w-[80%]",
                isUser ? "items-end" : "items-start"
            )}>
                <div className={cn(
                    "rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                    isUser 
                        ? "bg-primary text-primary-foreground rounded-tr-none" 
                        : "bg-muted text-foreground rounded-tl-none border border-border/50"
                )}>
                    {isAssistant && message.isStreaming ? (
                        <StreamingMessage 
                            isStreaming={true} 
                            content={message.content} 
                        />
                    ) : (
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>
                    )}
                </div>
                
                {message.attachments && message.attachments.length > 0 && (
                    <div className={cn(
                        "flex flex-wrap gap-2 mt-2",
                        isUser ? "justify-end" : "justify-start"
                    )}>
                        {message.attachments.map((file) => (
                            file.type.startsWith('image/') && file.previewUrl ? (
                                <div key={file.id} className="rounded-xl overflow-hidden border border-border/30 shadow-sm max-w-[220px]">
                                    <img
                                        src={file.previewUrl}
                                        alt={file.name}
                                        className="w-full h-auto object-cover max-h-56"
                                    />
                                </div>
                            ) : (
                                <div key={file.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/40 border border-border/40 rounded-xl text-[11px] font-medium">
                                    <FileText className="h-3 w-3 text-purple-500" />
                                    <span className="truncate max-w-[120px]">{file.name}</span>
                                </div>
                            )
                        ))}
                    </div>
                )}
                
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="w-full mt-2 space-y-2">
                        {message.toolCalls.map(tool => (
                            <ToolCallCard
                                key={tool.id}
                                toolName={tool.toolName}
                                toolCallId={tool.id}
                                arguments={tool.arguments}
                                result={tool.result}
                                error={tool.error}
                                isLoading={tool.isLoading}
                                durationMs={tool.durationMs}
                            />
                        ))}
                    </div>
                )}
                
                <span className="text-[10px] text-muted-foreground px-1 mt-1">
                    {format(new Date(message.createdAt), 'h:mm a')}
                </span>
            </div>
        </div>
    );
}
