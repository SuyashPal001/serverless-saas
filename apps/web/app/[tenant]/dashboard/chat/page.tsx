"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ConversationList } from "@/components/platform/chat/ConversationList";
import { MessageThread } from "@/components/platform/chat/MessageThread";
import { ChatInput } from "@/components/platform/chat/ChatInput";
import { WelcomeView } from "@/components/platform/chat/WelcomeView";
import { Conversation, ConversationsResponse, MessagesResponse, Message, ToolCall } from "@/components/platform/chat/types";
import { Agent } from "@/components/platform/agents/types";
import { Attachment } from "@/types/agent-events";
import { useChat } from "@/hooks/useChat";
import { Canvas } from "@/components/platform/canvas/Canvas";
import { useCanvas } from "@/hooks/useCanvas";
import type { CanvasAction, CanvasEventData } from "@/components/platform/canvas/types";
import { VoiceModal } from "@/components/platform/voice";
import { useVoice } from "@/hooks/useVoice";
import { Bot, MessageSquare, Plus, Info, MoreVertical, PanelRight, PanelLeftClose, PanelLeftOpen, Archive, RefreshCw } from "lucide-react";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { useSidebar } from "@/components/platform/SidebarContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function ChatPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const queryClient = useQueryClient();

    const tenantSlug = params.tenant as string;
    const conversationId = searchParams.get("id");
    // Stable ref so callbacks always target the correct query cache key,
    // even if the component re-renders while a stream is in flight.
    const conversationIdRef = useRef(conversationId);
    conversationIdRef.current = conversationId;

    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [hasSentFirstMessage, setHasSentFirstMessage] = useState(false);
    const [warmupMessage, setWarmupMessage] = useState<string | null>(null);
    const autoCreatingRef = useRef(false);
    const { isChatSidebarCollapsed, toggleChatSidebar } = useSidebar();
    const tenantClaims = useTenant();
    const firstName: string = tenantClaims.given_name ?? tenantClaims.name?.split(' ')[0] ?? 'there';

    interface LLMProvider {
        id: string;
        provider: string;
        model: string;
        displayName: string;
        isDefault: boolean;
        status: 'live' | 'coming_soon';
    }

    interface LLMProvidersResponse {
        providers: LLMProvider[];
    }

    const { data: providersData } = useQuery<LLMProvidersResponse>({
        queryKey: ["llm-providers"],
        queryFn: () => api.get<LLMProvidersResponse>("/api/v1/llm-providers"),
    });

    const providers = providersData?.providers || [];

    interface AgentsResponse {
        data: Agent[];
    }
    const { data: agentsData } = useQuery<AgentsResponse>({
        queryKey: ["agents"],
        queryFn: () => api.get<AgentsResponse>("/api/v1/agents"),
    });

    const activeAgents = agentsData?.data?.filter(a => a.status === 'active') || [];

    const { data: conversationsData, isLoading: isLoadingConversations, isError: isErrorConversations } = useQuery<ConversationsResponse>({
        queryKey: ["conversations"],
        queryFn: () => api.get<ConversationsResponse>("/api/v1/conversations"),
    });

    const conversations = conversationsData?.data || [];

    const { data: activeConversationData } = useQuery<{ data: Conversation }>({
        queryKey: ["conversation", conversationId],
        queryFn: () => api.get<{ data: Conversation }>(`/api/v1/conversations/${conversationId}`),
        enabled: !!conversationId,
    });

    const selectedConversation = useMemo(() =>
        activeConversationData?.data ?? conversations.find(c => c.id === conversationId),
    [activeConversationData, conversations, conversationId]);

    const {
        isCanvasOpen,
        isCanvasExpanded,
        hasActivity,
        toggleCanvas,
        toggleExpand,
        handleCanvasUpdate,
    } = useCanvas();

    const handleAgentCanvasUpdate = useCallback((action: string, data: Record<string, unknown>) => {
        handleCanvasUpdate(action as CanvasAction, data as CanvasEventData);
    }, [handleCanvasUpdate]);

    const {
        isModalOpen,
        session,
        openVoice,
        closeVoice,
        handleTap,
    } = useVoice({ conversationId: conversationId || undefined });

    const [eventError, setEventError] = useState<string | null>(null);
    const [agentTimedOut, setAgentTimedOut] = useState(false);
    const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCall>>(new Map());

    // -------------------------------------------------------------------------
    // SSE chat hook — replaces WebSocket-based useAgentEvents
    // -------------------------------------------------------------------------
    const { sendMessage: sendChatMessage, sendApproval, cancel, isStreaming, isRetrying } = useChat({
        conversationId: conversationId || undefined,
        agentId: selectedConversation?.agentId ?? selectedConversation?.agent?.id ?? activeAgents[0]?.id,

        onDelta: useCallback((delta: string, messageId: string) => {
            queryClient.setQueryData<MessagesResponse>(["messages", conversationIdRef.current], (old) => {
                const newData = old ? [...old.data] : [];
                const existingIndex = newData.findIndex(m => m.id === messageId);

                if (existingIndex >= 0) {
                    newData[existingIndex] = {
                        ...newData[existingIndex],
                        content: newData[existingIndex].content + delta,
                        isStreaming: true,
                    };
                } else {
                    newData.push({
                        id: messageId,
                        conversationId: conversationIdRef.current!,
                        role: 'assistant',
                        content: delta,
                        createdAt: new Date().toISOString(),
                        isStreaming: true,
                    });
                }

                return {
                    data: [...newData].sort((a, b) =>
                        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    ),
                };
            });
        }, [queryClient]),

        onDone: useCallback((fullText: string, messageId: string) => {
            queryClient.setQueryData<MessagesResponse>(["messages", conversationIdRef.current], (old) => {
                const newData = old ? [...old.data] : [];
                const existingIndex = newData.findIndex(m => m.id === messageId);

                if (existingIndex >= 0) {
                    newData[existingIndex] = {
                        ...newData[existingIndex],
                        content: fullText || newData[existingIndex].content,
                        isStreaming: false,
                    };
                } else {
                    newData.push({
                        id: messageId,
                        conversationId: conversationIdRef.current!,
                        role: 'assistant',
                        content: fullText,
                        createdAt: new Date().toISOString(),
                        isStreaming: false,
                    });
                }

                return {
                    data: [...newData].sort((a, b) =>
                        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    ),
                };
            });
            setActiveToolCalls(new Map());
            // Delay sync so the relay's DB writes have time to land before we refetch.
            // The cache already has the correct optimistic state, so this is just a
            // background reconciliation — not needed for correctness.
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ["messages", conversationIdRef.current] });
            }, 2000);
        }, [queryClient]),

        onError: useCallback((code: string, message: string) => {
            if (code === 'AGENT_TIMEOUT') {
                setAgentTimedOut(true);
                return;
            }
            if (code === 'WARMUP_TIMEOUT') {
                setWarmupMessage(message);
                return;
            }
            setEventError(`[${code}] ${message}`);
            toast.error(message);
        }, []),

        onToolCall: useCallback((toolName: string, toolCallId: string, args: Record<string, unknown>) => {
            setActiveToolCalls(prev => {
                const next = new Map(prev);
                next.set(toolCallId, {
                    id: toolCallId,
                    toolName,
                    arguments: args,
                    isLoading: true,
                });
                return next;
            });
        }, []),

        onApprovalRequired: useCallback((approvalId: string, toolName: string, description: string, args: Record<string, unknown>) => {
            queryClient.setQueryData<MessagesResponse>(["messages", conversationIdRef.current], (old) => {
                const newMessage: Message = {
                    id: crypto.randomUUID(),
                    conversationId: conversationIdRef.current!,
                    role: 'assistant',
                    content: '',
                    createdAt: new Date().toISOString(),
                    approvalRequest: {
                        id: approvalId,
                        toolName,
                        description,
                        arguments: args,
                        status: 'pending',
                    },
                };
                return old ? { data: [...old.data, newMessage] } : { data: [newMessage] };
            });
        }, [queryClient]),
    });

    // Abort any in-flight SSE stream when the user navigates to a different conversation.
    useEffect(() => {
        return () => { cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId]);

    // Auto-create a conversation for first-time users (no conversations, no active conversation).
    useEffect(() => {
        if (
            !isLoadingConversations &&
            !isErrorConversations &&
            conversations.length === 0 &&
            !conversationId &&
            activeAgents.length > 0 &&
            !autoCreatingRef.current
        ) {
            autoCreatingRef.current = true;
            silentCreateConversation.mutate(activeAgents[0].id);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoadingConversations, isErrorConversations, conversations.length, conversationId, activeAgents.length]);

    // -------------------------------------------------------------------------
    // Fetch messages
    // -------------------------------------------------------------------------
    const { data: messagesData, isLoading: isLoadingMessages, refetch: refetchMessages } = useQuery<MessagesResponse>({
        queryKey: ["messages", conversationId],
        queryFn: async () => {
            const response = await api.get<MessagesResponse>(`/api/v1/conversations/${conversationId}/messages`);
            return {
                ...response,
                data: [...response.data].sort((a, b) =>
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                ),
            };
        },
        enabled: !!conversationId,
    });

    const messages = messagesData?.data || [];

    // -------------------------------------------------------------------------
    // Approval handlers
    // -------------------------------------------------------------------------
    const handleApprove = useCallback(async (messageId: string, approvalId: string) => {
        const success = await sendApproval(approvalId, 'approved');
        if (success) {
            queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
                if (!old) return old;
                return {
                    data: old.data.map(m => m.id === messageId ? {
                        ...m,
                        approvalRequest: m.approvalRequest ? {
                            ...m.approvalRequest,
                            status: 'approved' as const,
                            decisionAt: new Date().toISOString(),
                        } : undefined,
                    } : m),
                };
            });
        }
    }, [conversationId, queryClient, sendApproval]);

    const handleDismiss = useCallback(async (messageId: string, approvalId: string) => {
        const success = await sendApproval(approvalId, 'dismissed');
        if (success) {
            queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
                if (!old) return old;
                return {
                    data: old.data.map(m => m.id === messageId ? {
                        ...m,
                        approvalRequest: m.approvalRequest ? {
                            ...m.approvalRequest,
                            status: 'dismissed' as const,
                            decisionAt: new Date().toISOString(),
                        } : undefined,
                    } : m),
                };
            });
        }
    }, [conversationId, queryClient, sendApproval]);

    // -------------------------------------------------------------------------
    // Conversation mutations
    // -------------------------------------------------------------------------
    const createConversation = useMutation({
        mutationFn: (agentId: string) =>
            api.post<{ data: Conversation }>("/api/v1/conversations", { agentId }),
        onSuccess: (response) => {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            router.push(`/${tenantSlug}/dashboard/chat?id=${response.data.id}`);
            toast.success("Conversation started");
        },
        onError: (error: any) => {
            const message = error.data?.error;
            const errorMsg = typeof message === 'string' ? message : message?.message || "Failed to start conversation";
            toast.error(errorMsg);
        },
    });

    // Silent variant — no toast, used for auto-create on first visit
    const silentCreateConversation = useMutation({
        mutationFn: (agentId: string) =>
            api.post<{ data: Conversation }>("/api/v1/conversations", { agentId }),
        onSuccess: (response) => {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            router.push(`/${tenantSlug}/dashboard/chat?id=${response.data.id}`);
        },
        onError: () => {
            autoCreatingRef.current = false;
        },
    });

    const updateAgentMutation = useMutation({
        mutationFn: (values: { llmProviderId: string }) => {
            const agentId = selectedConversation?.agentId || selectedConversation?.agent?.id;
            return api.patch(`/api/v1/agents/${agentId}`, values);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            toast.success("AI Model updated");
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to update model");
        },
    });

    const deleteConversation = useMutation({
        mutationFn: (id: string) => api.del(`/api/v1/conversations/${id}`),
        onSuccess: (_, deletedId) => {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            toast.success("Conversation archived");
            if (conversationId === deletedId) {
                router.push(`/${tenantSlug}/dashboard/chat`);
            }
        },
        onError: (error: any) => {
            toast.error(error.data?.message || "Failed to archive conversation");
        },
    });

    // -------------------------------------------------------------------------
    // Handlers
    // -------------------------------------------------------------------------
    const handleSelectConversation = (conv: Conversation) => {
        router.push(`/${tenantSlug}/dashboard/chat?id=${conv.id}`);
    };

    const handleNewChat = () => {
        const firstAgent = activeAgents[0];
        if (firstAgent) {
            handleSelectAgent(firstAgent);
        } else {
            toast.error("No active agents available. Please create one first.");
        }
    };

    const handleSelectAgent = (agent: Agent) => {
        createConversation.mutate(agent.id);
    };

    const handleSendMessage = async (content: string, attachments?: Attachment[]) => {
        if (!content.trim() && (!attachments || attachments.length === 0)) return;

        // Auto-generate chat title for new conversations
        if (!selectedConversation?.title && messages.length === 0 && content.trim()) {
            const words = content.trim().split(/\s+/);
            const newTitle = words.slice(0, 5).join(' ') + (words.length > 5 ? '...' : '');
            api.patch(`/api/v1/conversations/${conversationId}`, { title: newTitle })
                .then(() => {
                    queryClient.invalidateQueries({ queryKey: ["conversations"] });
                    queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
                })
                .catch(console.error);
        }

        // Enrich attachments with presigned S3 URLs so the relay can fetch them
        let enrichedAttachments = attachments;
        if (attachments && attachments.length > 0) {
            enrichedAttachments = await Promise.all(
                attachments.map(async (att) => {
                    if (att.type?.startsWith('image/') ||
                        att.type?.startsWith('video/') ||
                        att.type?.startsWith('audio/') ||
                        att.type === 'application/pdf' ||
                        att.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                        try {
                            const { presignedUrl } = await api.get<{ presignedUrl: string }>(
                                `/api/v1/files/${encodeURIComponent(att.fileId)}/presigned-url`
                            );
                            return { ...att, presignedUrl };
                        } catch (err: any) {
                            console.error('[presigned-url] failed for', att.type, att.fileId, err?.status, err?.message);
                            return att;
                        }
                    }
                    return att;
                })
            );
        }

        // Pre-save user message with fileIds so they survive page refresh.
        // The GCP relay also saves the user message but may not include fileId.
        // The /save endpoint deduplicates by content within 60s and merges fileId if missing.
        if (attachments && attachments.some(a => a.fileId)) {
            api.post(`/api/v1/conversations/${conversationId}/messages/save`, {
                role: 'user',
                content,
                attachments: attachments.map(a => ({
                    fileId: a.fileId,
                    name: a.name,
                    type: a.type,
                    size: a.size,
                })),
            }).catch((err) => {
                console.warn('[pre-save] Failed to save user message with fileIds:', err);
            });
        }

        // Optimistic user message
        queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
            const newMessage: Message = {
                id: crypto.randomUUID(),
                conversationId: conversationId!,
                role: 'user',
                content,
                attachments: attachments?.map(a => ({
                    id: crypto.randomUUID(),
                    fileId: a.fileId,
                    name: a.name,
                    type: a.type,
                    size: a.size,
                    previewUrl: a.previewUrl,
                })),
                createdAt: new Date().toISOString(),
            };
            const newData = old ? [...old.data, newMessage] : [newMessage];
            return {
                data: newData.sort((a, b) =>
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                ),
            };
        });

        setEventError(null);
        setWarmupMessage(null);
        setHasSentFirstMessage(true);

        await sendChatMessage(content, enrichedAttachments);
    };

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------
    return (
        <div className="flex bg-background h-[calc(100vh-64px)] overflow-hidden relative w-full">
            {agentTimedOut && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background gap-4">
                    <div className="flex flex-col items-center gap-3 max-w-sm text-center">
                        <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center border border-border">
                            <RefreshCw className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <h2 className="text-lg font-semibold tracking-tight">Your workspace is warming up</h2>
                        <p className="text-sm text-muted-foreground">
                            This can take up to 2 minutes on first launch. Please refresh to try again.
                        </p>
                        <Button
                            onClick={() => window.location.reload()}
                            className="mt-2"
                        >
                            Refresh
                        </Button>
                    </div>
                </div>
            )}
            <div className="flex flex-1 overflow-hidden relative">
                {/* Conversations Sidebar */}
                <div className={cn(
                    "flex flex-col border-r border-border transition-all duration-300 ease-in-out bg-background/50 backdrop-blur-sm z-20 overflow-hidden relative",
                    isChatSidebarCollapsed ? "w-0 opacity-0 pointer-events-none -translate-x-full" : "w-1/4 min-w-[280px] opacity-100 translate-x-0"
                )}>
                    <ConversationList
                        selectedId={conversationId || undefined}
                        onSelect={handleSelectConversation}
                        onNewChat={handleNewChat}
                    />
                </div>

                {/* Main Chat Area */}
                <div className="flex-1 flex flex-row min-w-0 bg-background relative overflow-hidden">
                    {/* Chat Panel */}
                    <div className={cn(
                        "flex flex-col overflow-hidden transition-all h-full",
                        isCanvasExpanded ? "w-0 opacity-0 pointer-events-none" : "flex-1",
                        isCanvasOpen ? "border-r border-border" : ""
                    )}>
                        {selectedConversation ? (
                            <>
                                {/* Chat Header */}
                                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background shadow-sm z-10 shrink-0">
                                    <div className="flex items-center gap-3">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={toggleChatSidebar}
                                            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground transition-all hover:bg-muted"
                                        >
                                            {isChatSidebarCollapsed ? (
                                                <PanelLeftOpen className="h-4 w-4" />
                                            ) : (
                                                <PanelLeftClose className="h-4 w-4" />
                                            )}
                                        </Button>
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted border border-border/50">
                                            <Bot className="h-5 w-5 text-muted-foreground" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h2 className="font-bold text-base tracking-tight truncate max-w-[200px] sm:max-w-[400px]">
                                                    {selectedConversation?.title || (selectedConversation?.agent?.name ? `Chat with ${selectedConversation.agent.name}` : "Chat with Agent")}
                                                </h2>
                                                <Badge variant={selectedConversation?.status === 'active' ? "default" : "secondary"} className="text-[10px] font-bold uppercase py-0 px-1.5 h-4.5 bg-primary/5 text-primary border-primary/20">
                                                    {selectedConversation?.status ?? "unknown"}
                                                </Badge>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground font-medium flex items-center gap-3">
                                                <span className="flex items-center gap-1">
                                                    Agent: {selectedConversation?.agent?.name || "Ready"} {selectedConversation?.agent?.type ? `(${selectedConversation.agent.type})` : ""}
                                                </span>
                                                {false && selectedConversation?.agent && (
                                                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 flex items-center gap-1 bg-muted/30 border-muted">
                                                        {(() => {
                                                            const agent = selectedConversation!.agent!;
                                                            if (providers.length === 0) return agent.model || "Loading Model...";
                                                            const provider = providers.find(p => p.id === agent.llmProviderId)
                                                                || providers.find(p => p.isDefault);
                                                            if (!provider) return agent.model || "Platform Default";
                                                            return (
                                                                <>
                                                                    {provider?.status === 'coming_soon' && <Lock className="h-2 w-2" />}
                                                                    {provider?.displayName}
                                                                </>
                                                            );
                                                        })()}
                                                    </Badge>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant={isCanvasOpen ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={toggleCanvas}
                                            className="relative flex"
                                        >
                                            <PanelRight className="h-4 w-4 mr-2" />
                                            Canvas
                                            {hasActivity && !isCanvasOpen && (
                                                <span className="absolute -top-1 -right-1 h-3 w-3 bg-green-500 rounded-full animate-pulse" />
                                            )}
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                                            <Info className="h-4 w-4" />
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem
                                                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                                    onClick={() => setIsDeleteDialogOpen(true)}
                                                >
                                                    <Archive className="h-4 w-4 mr-2" />
                                                    Archive Conversation
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>

                                {/* Welcome view — first-time user, no messages sent yet */}
                                {!hasSentFirstMessage && messages.length === 0 && !isLoadingMessages ? (
                                    <WelcomeView
                                        agentName={activeAgents[0]?.name ?? 'your assistant'}
                                        firstName={firstName}
                                        onSelectPrompt={(text) => handleSendMessage(text)}
                                    >
                                        <ChatInput
                                            onSend={handleSendMessage}
                                            onStop={cancel}
                                            onVoiceClick={openVoice}
                                            onMediaClick={(type) => toast.info(`Adding ${type}...`)}
                                            isLoading={false}
                                            isStreaming={isStreaming}
                                            disabled={selectedConversation.status !== 'active'}
                                            providers={providers}
                                            llmProviderId={selectedConversation.agent?.llmProviderId ?? activeAgents[0]?.llmProviderId}
                                            onModelChange={(providerId) => {
                                                const agentId = selectedConversation.agent?.id ?? activeAgents[0]?.id;
                                                if (agentId) updateAgentMutation.mutate({ llmProviderId: providerId });
                                            }}
                                        />
                                    </WelcomeView>
                                ) : (
                                    <>
                                        {/* Messages */}
                                        <MessageThread
                                            messages={messages}
                                            isLoading={isLoadingMessages}
                                            isTyping={isStreaming || isRetrying}
                                            activeToolCalls={Array.from(activeToolCalls.values())}
                                            error={eventError}
                                            warmupMessage={warmupMessage}
                                            onApprove={handleApprove}
                                            onDismiss={handleDismiss}
                                        />

                                        {/* Input */}
                                        <div className="shrink-0 pt-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                                            <ChatInput
                                                onSend={handleSendMessage}
                                                onStop={cancel}
                                                onVoiceClick={openVoice}
                                                onMediaClick={(type) => toast.info(`Adding ${type}...`)}
                                                isLoading={false}
                                                isStreaming={isStreaming}
                                                disabled={selectedConversation.status !== 'active'}
                                                providers={providers}
                                                llmProviderId={selectedConversation.agent?.llmProviderId}
                                                onModelChange={(providerId) => {
                                                    if (selectedConversation.agent?.id) {
                                                        updateAgentMutation.mutate({ llmProviderId: providerId });
                                                    }
                                                }}
                                            />
                                        </div>
                                    </>
                                )}
                            </>
                        ) : isLoadingConversations ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background h-full">
                                <div className="space-y-4 w-full max-w-sm">
                                    <Skeleton className="h-12 w-full mx-auto" />
                                    <Skeleton className="h-40 w-full mx-auto" />
                                    <Skeleton className="h-10 w-32 mx-auto rounded-full" />
                                </div>
                            </div>
                        ) : isErrorConversations ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background h-full">
                                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6 shadow-sm border border-border">
                                    <MessageSquare className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h2 className="text-2xl font-bold tracking-tight mb-2">Failed to load chats</h2>
                                <p className="text-muted-foreground max-w-sm mb-8">
                                    There was an error loading your conversations. Please try again.
                                </p>
                                <Button
                                    onClick={() => queryClient.invalidateQueries({ queryKey: ["conversations"] })}
                                    size="lg"
                                    className="rounded-full shadow-lg h-12 px-6 gap-2"
                                >
                                    Retry Loading
                                </Button>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background h-full">
                                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6 shadow-sm border border-border">
                                    <MessageSquare className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h2 className="text-2xl font-bold tracking-tight mb-2">Select a conversation</h2>
                                <p className="text-muted-foreground max-w-sm mb-8">
                                    Select an existing conversation from the list or start a new one to interact with your agents.
                                </p>
                                <Button
                                    onClick={handleNewChat}
                                    size="lg"
                                    className="rounded-full shadow-lg h-12 px-6 gap-2"
                                >
                                    <Plus className="h-4 w-4" />
                                    Start New Conversation
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Canvas Panel */}
                    <div className={cn(
                        "transition-all overflow-hidden h-full z-10 bg-background",
                        isCanvasExpanded ? "w-full flex-1" : (isCanvasOpen ? "w-1/2 border-l border-border" : "w-0")
                    )}>
                        <Canvas isOpen={isCanvasOpen} isExpanded={isCanvasExpanded} onExpand={toggleExpand} onActivity={() => {}} />
                    </div>
                </div>
            </div>

            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Archive Conversation?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will move the conversation to your archives. You can still access it later if needed.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (conversationId) {
                                    deleteConversation.mutate(conversationId);
                                    setIsDeleteDialogOpen(false);
                                }
                            }}
                        >
                            Archive
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <VoiceModal
                isOpen={isModalOpen}
                onClose={closeVoice}
                session={session}
                onTap={handleTap}
            />
        </div>
    );
}
