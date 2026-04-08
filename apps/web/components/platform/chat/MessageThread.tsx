"use client";

import { useEffect, useRef } from "react";
import { Bot, User, Terminal, Info, MessageSquare, Image as ImageIcon, FileText, ThumbsUp, ThumbsDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Message } from "./types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolCallCard } from "./ToolCallCard";
import { ApprovalCard } from "./ApprovalCard";
import { StreamingMessage } from "./StreamingMessage";
import { MessageAudioPlayer } from "./MessageAudioPlayer";
import { api } from "@/lib/api";
import { useState } from "react";

interface MessageThreadProps {
    messages: Message[];
    isLoading?: boolean;
    isTyping?: boolean;
    activeToolCalls?: Message["toolCalls"];
    error?: string | null;
    onApprove?: (messageId: string, approvalId: string) => void;
    onDismiss?: (messageId: string, approvalId: string) => void;
}

export function MessageThread({ messages, isLoading, isTyping, activeToolCalls, error, onApprove, onDismiss }: MessageThreadProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [freshUrls, setFreshUrls] = useState<Record<string, string>>({});

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    // Refresh presigned URLs for historical messages
    useEffect(() => {
        const refreshUrls = async () => {
            const toRefresh = messages.flatMap(m => m.attachments || [])
                .filter(att => att.fileId && (!att.previewUrl || att.previewUrl.startsWith('blob:')))
                .filter(att => !freshUrls[att.fileId!]);

            if (toRefresh.length === 0) return;

            const results = await Promise.all(
                toRefresh.map(async (att) => {
                    try {
                        const { presignedUrl } = await api.get<{ presignedUrl: string }>(
                            `/api/v1/files/${encodeURIComponent(att.fileId!)}/presigned-url`
                        );
                        return { fileId: att.fileId!, url: presignedUrl };
                    } catch (err) {
                        console.error('Failed to refresh URL for', att.fileId, err);
                        return null;
                    }
                })
            );

            const newUrls = results.reduce((acc, curr) => {
                if (curr) acc[curr.fileId] = curr.url;
                return acc;
            }, {} as Record<string, string>);

            if (Object.keys(newUrls).length > 0) {
                setFreshUrls(prev => ({ ...prev, ...newUrls }));
            }
        };

        refreshUrls();
    }, [messages]);

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
        <div ref={scrollRef} className="flex-1 px-4 md:px-8 py-4 overflow-y-auto custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-8 pb-4">
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
                    <MessageItem 
                        key={message.id} 
                        message={message} 
                        freshUrls={freshUrls} 
                        onApprove={onApprove}
                        onDismiss={onDismiss}
                    />
                ))}

                {isTyping && (
                    <ThinkingIndicator label={
                        (() => {
                            const toolLabelMap: Record<string, string> = {
                                web_search: 'Searching the web...',
                                retrieve_documents: 'Reading documents...',
                                code_execution: 'Running code...',
                                browser: 'Browsing the web...',
                                send_email: 'Sending email...',
                            };
                            const activeTool = activeToolCalls?.find(t => t.isLoading)?.toolName;
                            return activeTool ? (toolLabelMap[activeTool] ?? `Using ${activeTool}...`) : 'Thinking...';
                        })()
                    } />
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

function MessageItem({ 
    message, 
    freshUrls, 
    onApprove, 
    onDismiss 
}: { 
    message: Message; 
    freshUrls: Record<string, string>;
    onApprove?: (messageId: string, approvalId: string) => void;
    onDismiss?: (messageId: string, approvalId: string) => void;
}) {
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
            "flex items-start gap-4 group/msg",
            isUser ? "flex-row-reverse" : "flex-row"
        )}>
            <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-sm",
                isAssistant ? "bg-primary/10 text-primary border-primary/20" : "bg-background text-foreground border-border"
            )}>
                {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </div>
            
            <div className={cn(
                "flex flex-col gap-1 flex-1",
                isUser ? "items-end max-w-[75%]" : "items-start w-full"
            )}>
                {(message.content.trim() || (isAssistant && message.isStreaming)) && (
                    <div className={cn(
                        "text-sm",
                        isUser
                            ? "rounded-2xl px-4 py-2.5 shadow-sm bg-primary text-primary-foreground rounded-tr-none"
                            : "leading-7 w-full"
                    )}>
                        {isAssistant && message.isStreaming ? (
                            <StreamingMessage 
                                isStreaming={true} 
                                content={message.content} 
                            />
                        ) : (
                            <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                                ul: ({ children }) => <ul className="list-disc list-outside ml-4 mb-3 space-y-1">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal list-outside ml-4 mb-3 space-y-1">{children}</ol>,
                                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                pre: ({ children }) => <pre className="bg-muted p-4 rounded-lg overflow-x-auto mb-3 text-sm font-mono">{children}</pre>,
                                code: ({ className, children, ...props }: any) => !className
                                    ? <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>{children}</code>
                                    : <code className={className} {...props}>{children}</code>,
                                h1: ({ children }) => <h1 className="font-semibold mb-2 mt-4 text-lg">{children}</h1>,
                                h2: ({ children }) => <h2 className="font-semibold mb-2 mt-4 text-base">{children}</h2>,
                                h3: ({ children }) => <h3 className="font-semibold mb-2 mt-4 text-sm">{children}</h3>,
                                a: ({ href, children }) => <a href={href} className="text-primary underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                                blockquote: ({ children }) => <blockquote className="border-l-4 border-muted pl-4 italic mb-3">{children}</blockquote>,
                            }}
                        >
                            {message.content}
                        </ReactMarkdown>
                        )}
                    </div>
                )}
                
                {message.attachments && message.attachments.length > 0 && (
                    <div className={cn(
                        "flex flex-wrap gap-2 mt-2",
                        isUser ? "justify-end" : "justify-start"
                    )}>
                        {message.attachments.map((file, index) => {
                            const url = (file.fileId ? freshUrls[file.fileId] : null) || file.previewUrl;
                            
                            if (file.type.startsWith('image/') && url) {
                                return (
                                    <div key={file.id ?? `att-${index}`} className="rounded-xl overflow-hidden border border-border/30 shadow-sm max-w-[220px]">
                                        <img
                                            src={url}
                                            alt={file.name}
                                            className="w-full h-auto object-cover max-h-56"
                                        />
                                    </div>
                                );
                            }

                            if (file.type.startsWith('video/') && url) {
                                return (
                                    <video
                                        key={file.id ?? `att-${index}`}
                                        controls
                                        className="max-w-[220px] rounded-xl border border-border/30 shadow-sm"
                                        src={url}
                                    />
                                );
                            }

                            if (file.type.startsWith('audio/') && url) {
                                return (
                                    <MessageAudioPlayer
                                        key={file.id ?? `att-${index}`}
                                        url={url}
                                        variant={isUser ? 'user' : 'assistant'}
                                    />
                                );
                            }

                            if (file.type === 'application/pdf' && url) {
                                return (
                                    <div key={file.id ?? `att-${index}`} className="flex items-center gap-3 px-3 py-2 bg-muted/40 border border-border/40 rounded-xl text-[11px] font-medium min-w-[180px]">
                                        <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                                            <FileText className="h-4 w-4 text-red-500" />
                                        </div>
                                        <div className="flex flex-col flex-1 truncate">
                                            <span className="truncate">{file.name}</span>
                                            <a
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:underline text-[10px] mt-0.5"
                                            >
                                                Open PDF
                                            </a>
                                        </div>
                                    </div>
                                );
                            }

                            // DOCX or Generic Fallback
                            const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                            return (
                                <div key={file.id ?? `att-${index}`} className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/40 border border-border/40 rounded-xl text-[11px] font-medium">
                                    <FileText className={cn("h-3 w-3", isDocx ? "text-blue-500" : "text-purple-500")} />
                                    <span className="truncate max-w-[120px]">{file.name}</span>
                                    {url && (
                                        <a href={url} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary hover:underline font-bold">
                                            ↓
                                        </a>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                
                {false && message.approvalRequest && (
                    <ApprovalCard 
                        request={message.approvalRequest}
                        onApprove={() => onApprove?.(message.id, message.approvalRequest!.id)}
                        onDismiss={() => onDismiss?.(message.id, message.approvalRequest!.id)}
                    />
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
                
                {isAssistant && !message.isStreaming && (
                    <MessageFeedback messageId={message.id} conversationId={message.conversationId} />
                )}

                <span className="text-[10px] text-muted-foreground px-1 mt-1">
                    {format(new Date(message.createdAt), 'h:mm a')}
                </span>
            </div>
        </div>
    );
}

const FEEDBACK_ISSUE_OPTIONS = [
    'Incorrect information',
    'Incomplete answer',
    'Off topic',
    'Harmful or unsafe content',
    'Other',
] as const;

function MessageFeedback({ messageId, conversationId }: { messageId: string; conversationId: string }) {
    const [rating, setRating] = useState<'up' | 'down' | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [issueType, setIssueType] = useState('');
    const [detail, setDetail] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submit = async (r: 'up' | 'down', comment?: string) => {
        setSubmitting(true);
        try {
            await api.post(`/api/v1/conversations/${conversationId}/messages/${messageId}/feedback`, {
                rating: r,
                ...(comment ? { comment } : {}),
            });
            setRating(r);
        } catch {
            // silent — optimistic state already shown
        } finally {
            setSubmitting(false);
        }
    };

    const handleUp = () => {
        if (rating !== null || modalOpen) return;
        setRating('up');
        submit('up');
    };

    const handleDown = () => {
        if (rating !== null || modalOpen) return;
        setModalOpen(true);
    };

    const handleSubmit = () => {
        if (submitting) return;
        const parts = [issueType, detail.trim()].filter(Boolean);
        const comment = parts.join(' | ') || undefined;
        setModalOpen(false);
        setRating('down');
        submit('down', comment);
    };

    const handleCancel = () => {
        setModalOpen(false);
        setIssueType('');
        setDetail('');
    };

    const isRated = rating !== null;

    return (
        <div className="mt-1">
            <div className="flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
                <button
                    onClick={handleUp}
                    disabled={isRated || modalOpen || submitting}
                    className={cn(
                        "p-1 rounded hover:bg-muted/50 transition-colors",
                        rating === 'up' ? "text-emerald-500" : "text-muted-foreground/50 hover:text-muted-foreground",
                        (isRated || modalOpen) && "cursor-default"
                    )}
                    aria-label="Thumbs up"
                >
                    <ThumbsUp className={cn("h-3.5 w-3.5", rating === 'up' && "fill-current")} />
                </button>
                <button
                    onClick={handleDown}
                    disabled={isRated || modalOpen || submitting}
                    className={cn(
                        "p-1 rounded hover:bg-muted/50 transition-colors",
                        rating === 'down' ? "text-red-500" : "text-muted-foreground/50 hover:text-muted-foreground",
                        (isRated || modalOpen) && "cursor-default"
                    )}
                    aria-label="Thumbs down"
                >
                    <ThumbsDown className={cn("h-3.5 w-3.5", rating === 'down' && "fill-current")} />
                </button>
            </div>

            <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) handleCancel(); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Give negative feedback</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <label className="text-sm text-muted-foreground">
                                What type of issue do you wish to report? (optional)
                            </label>
                            <select
                                value={issueType}
                                onChange={(e) => setIssueType(e.target.value)}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                <option value="">Select an issue type</option>
                                {FEEDBACK_ISSUE_OPTIONS.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm text-muted-foreground">
                                Please provide details: (optional)
                            </label>
                            <textarea
                                value={detail}
                                onChange={(e) => setDetail(e.target.value.slice(0, 200))}
                                placeholder="What was unsatisfying about this response?"
                                rows={3}
                                className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <button
                            onClick={handleCancel}
                            className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
                        >
                            Submit
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ThinkingIndicator({ label = 'Thinking...' }: { label?: string }) {
    return (
        <div className="flex items-start gap-4 animate-in fade-in duration-300">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20">
                <Bot className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2 pt-1.5">
                <span className="flex gap-1 items-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce" />
                </span>
                <span className="text-sm text-muted-foreground">{label}</span>
            </div>
        </div>
    );
}
