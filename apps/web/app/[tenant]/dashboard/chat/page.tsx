"use client"

import { useState, useMemo, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ConversationList } from "@/components/platform/chat/ConversationList";
import { MessageThread } from "@/components/platform/chat/MessageThread";
import { ChatInput } from "@/components/platform/chat/ChatInput";
import { AgentSelector } from "@/components/platform/chat/AgentSelector";
import { Conversation, ConversationsResponse, MessagesResponse, Message, ToolCall, MessageAttachment } from "@/components/platform/chat/types";
import { Agent } from "@/components/platform/agents/types";
import { Attachment } from "@/types/agent-events";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { Canvas } from "@/components/platform/canvas/Canvas";
import { useCanvas } from "@/hooks/useCanvas";
import type { CanvasAction, CanvasEventData } from "@/components/platform/canvas/types";
import { VoiceButton, VoiceModal } from "@/components/platform/voice";
import { useVoice } from "@/hooks/useVoice";
import { Bot, MessageSquare, Plus, Info, MoreVertical, PanelRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebar } from "@/components/platform/SidebarContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ChatPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const queryClient = useQueryClient();
    
    const tenantSlug = params.tenant as string;
    const conversationId = searchParams.get("id");
    
    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    const { isChatSidebarCollapsed, toggleChatSidebar } = useSidebar();

    // Fetch conversations
    const { data: conversationsData, isLoading: isLoadingConversations, isError: isErrorConversations } = useQuery<ConversationsResponse>({
        queryKey: ["conversations"],
        queryFn: () => api.get<ConversationsResponse>("/api/v1/conversations"),
    });

    const conversations = conversationsData?.data || [];

    // Fetch the active conversation directly when conversationId is in the URL.
    // This prevents messages being hidden while the list is still loading or if
    // the list query fails — selectedConversation should not depend on the list.
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
        resetCanvas,
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

    const [isThinking, setIsThinking] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const stopFlagRef = useRef(false);
    const [eventError, setEventError] = useState<string | null>(null);
    const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCall>>(new Map());

    const handleStopStreaming = useCallback(() => {
        stopFlagRef.current = true;
        setIsStreaming(false);
        setIsThinking(false);
        toast.info("Message generation stopped");
    }, []);

    const agentEvents = useAgentEvents({
        conversationId: conversationId || '',
        onThinking: useCallback(() => {
            setIsThinking(true);
            setEventError(null);
        }, []),
        onMessageDelta: useCallback((delta: string, messageId: string) => {
            if (stopFlagRef.current) return;
            setIsThinking(false);
            setIsStreaming(true);
            queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
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
                        conversationId: conversationId!,
                        role: 'assistant',
                        content: delta,
                        createdAt: new Date().toISOString(),
                        isStreaming: true,
                    });
                }

                // Bug 3: Sort messages by createdAt
                return { 
                    data: [...newData].sort((a, b) => 
                        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    ) 
                };
            });
        }, [conversationId, queryClient]),
        onMessageComplete: useCallback((content: string, messageId: string) => {
            setIsThinking(false);
            setIsStreaming(false);
            stopFlagRef.current = false;
            queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
                const newData = old ? [...old.data] : [];
                const existingIndex = newData.findIndex(m => m.id === messageId);

                if (existingIndex >= 0) {
                    newData[existingIndex] = {
                        ...newData[existingIndex],
                        content: content || newData[existingIndex].content,
                        isStreaming: false,
                    };
                } else {
                    newData.push({
                        id: messageId,
                        conversationId: conversationId!,
                        role: 'assistant',
                        content,
                        createdAt: new Date().toISOString(),
                        isStreaming: false,
                    });
                }

                // Bug 3: Sort messages by createdAt
                return { 
                    data: [...newData].sort((a, b) => 
                        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    ) 
                };
            });
        }, [conversationId, queryClient]),
        onToolCalling: useCallback((toolName: string, toolCallId: string, args: Record<string, unknown>) => {
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
        onToolResult: useCallback((toolName: string, toolCallId: string, result: unknown, error?: string) => {
            setActiveToolCalls(prev => {
                const next = new Map(prev);
                const existing = next.get(toolCallId);
                if (existing) {
                    next.set(toolCallId, {
                        ...existing,
                        result,
                        error,
                        isLoading: false,
                    });
                }
                return next;
            });
        }, []),
        onError: useCallback((code: string, message: string | object, recoverable: boolean) => {
            setIsThinking(false);
            setIsStreaming(false);
            stopFlagRef.current = false;
            const errorMsg = typeof message === 'string' ? message : (message as any)?.message || JSON.stringify(message);
            setEventError(`[${code}] ${errorMsg}`);
            toast.error(errorMsg);
        }, []),
        onCanvasUpdate: handleAgentCanvasUpdate,
        onSessionEnded: useCallback((reason: string) => {
            setIsThinking(false);
            setActiveToolCalls(new Map());
            // Make sure we have the final DB state
            queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
            // resetCanvas(); // Optional
        }, [conversationId, queryClient]),
    });

    const { isConnected, sendMessage: sendWsMessage } = agentEvents;

    // Fetch messages
    const { data: messagesData, isLoading: isLoadingMessages, refetch: refetchMessages } = useQuery<MessagesResponse>({
        queryKey: ["messages", conversationId],
        queryFn: () => api.get<MessagesResponse>(`/api/v1/conversations/${conversationId}/messages`),
        enabled: !!conversationId,
    });

    const messages = messagesData?.data || [];

    // Create conversation mutation
    const createConversation = useMutation({
        mutationFn: (agentId: string) => 
            api.post<{ data: Conversation }>("/api/v1/conversations", { agentId }),
        onSuccess: (response) => {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            setIsSelectorOpen(false);
            router.push(`/${tenantSlug}/dashboard/chat?id=${response.data.id}`);
            toast.success("Conversation started");
        },
        onError: (error: any) => {
            const message = error.data?.error;
            const errorMsg = typeof message === 'string' ? message : message?.message || "Failed to start conversation";
            toast.error(errorMsg);
        }
    });

    // Send message mutation
    const sendMessage = useMutation({
        mutationFn: (content: string) => {
            // Optimistically update local cache with the user message
            queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
                const newMessage: Message = {
                    id: crypto.randomUUID(),
                    conversationId: conversationId!,
                    role: 'user',
                    content,
                    createdAt: new Date().toISOString()
                };
                return old ? { data: [...old.data, newMessage] } : { data: [newMessage] };
            });
            setIsThinking(true);
            stopFlagRef.current = false;
            setEventError(null);
            return api.post<Message>(`/api/v1/conversations/${conversationId}/messages`, { content });
        },
        onSuccess: () => {
            // Realtime updates handled by websocket
        },
        onError: (error: any) => {
            setIsThinking(false);
            const message = error.data?.error;
            const errorMsg = typeof message === 'string' ? message : message?.message || "Failed to send message";
            toast.error(errorMsg);
            // Remove the optimistic message on error
            refetchMessages();
        }
    });

    const handleSelectConversation = (conv: Conversation) => {
        router.push(`/${tenantSlug}/dashboard/chat?id=${conv.id}`);
    };

    const handleNewChat = () => {
        setIsSelectorOpen(true);
    };

    const handleSelectAgent = (agent: Agent) => {
        createConversation.mutate(agent.id);
    };

    const handleSendMessage = (content: string, attachments?: Attachment[]) => {
        if (!content.trim() && (!attachments || attachments.length === 0)) return;

        // 1. Optimistic update
        queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
            const newMessage: Message = {
                id: crypto.randomUUID(),
                conversationId: conversationId!,
                role: 'user',
                content,
                attachments: attachments?.map(a => ({
                    id: a.fileId,
                    name: a.name,
                    type: a.type,
                    size: a.size,
                    previewUrl: a.previewUrl  // carry local blob URL for immediate preview
                })),
                createdAt: new Date().toISOString()
            };
            const newData = old ? [...old.data, newMessage] : [newMessage];
            // Bug 3: Sort messages by createdAt
            return { 
                data: newData.sort((a, b) => 
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                )
            };
        });

        setIsThinking(true);
        setEventError(null);

        // 2. Send via WebSocket for real-time interaction
        const sent = sendWsMessage(content, attachments);
        if (!sent) {
            toast.error("Failed to send message. Please check your connection.");
            setIsThinking(false);
            setIsStreaming(false);
            // Optionally refetch to restore state
            queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
        }
    };

    return (
        <div className="flex bg-background h-[calc(100vh-64px)] overflow-hidden relative w-full">
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
                                                    {selectedConversation.title || (selectedConversation.agent?.name ? `Chat with ${selectedConversation.agent.name}` : "Chat with Agent")}
                                                </h2>
                                                <Badge variant={selectedConversation.status === 'active' ? "default" : "secondary"} className="text-[10px] font-bold uppercase py-0 px-1.5 h-4.5 bg-primary/5 text-primary border-primary/20">
                                                    {selectedConversation.status}
                                                </Badge>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                                                <span>Agent: {selectedConversation.agent?.name || (isConnected ? "Connected" : "Connecting...")} {selectedConversation.agent?.type ? `(${selectedConversation.agent.type})` : ""}</span>
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button 
                                            variant={isCanvasOpen ? 'default' : 'outline'} 
                                            size="sm" 
                                            onClick={toggleCanvas} 
                                            className="relative hidden sm:flex"
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
                                                <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                                                    Archive Conversation
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>

                                {/* Messages */}
                                <MessageThread 
                                    messages={messages} 
                                    isLoading={isLoadingMessages} 
                                    isTyping={isThinking || sendMessage.isPending}
                                    activeToolCalls={Array.from(activeToolCalls.values())}
                                    error={eventError}
                                />

                                {/* Input */}
                                <div className="shrink-0 pt-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                                    <ChatInput 
                                        onSend={handleSendMessage} 
                                        onStop={handleStopStreaming}
                                        onVoiceClick={openVoice}
                                        onMediaClick={(type) => toast.info(`Adding ${type}...`)}
                                        isLoading={sendMessage.isPending} 
                                        isStreaming={isStreaming || isThinking}
                                        disabled={selectedConversation.status !== 'active'}
                                    />
                                </div>
                            </>
                        ) : isLoadingConversations ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background h-full">
                                <div className="space-y-4 w-full max-w-sm">
                                    <Skeleton className="h-12 w-full mx-auto" />
                                    <Skeleton className="h-40 w-full mx-auto" />
                                    <Skeleton className="h-10 w-32 mx-auto rounded-full" />
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background h-full">
                                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6 shadow-sm border border-border">
                                    <MessageSquare className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h2 className="text-2xl font-bold tracking-tight mb-2">
                                    {isErrorConversations ? "Failed to load chats" : "Select a conversation"}
                                </h2>
                                <p className="text-muted-foreground max-w-sm mb-8">
                                    {isErrorConversations 
                                        ? "There was an error loading your conversations. Please try again."
                                        : "Select an existing conversation from the list or start a new one to interact with your agents."}
                                </p>
                                <Button 
                                    onClick={isErrorConversations ? () => queryClient.invalidateQueries({ queryKey: ["conversations"] }) : handleNewChat} 
                                    size="lg" 
                                    className="rounded-full shadow-lg h-12 px-6 gap-2"
                                >
                                    {isErrorConversations ? (
                                        <>Retry Loading</>
                                    ) : (
                                        <>
                                            <Plus className="h-4 w-4" />
                                            Start New Conversation
                                        </>
                                    )}
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

            <AgentSelector 
                open={isSelectorOpen} 
                onOpenChange={setIsSelectorOpen}
                onSelect={handleSelectAgent}
            />

            <VoiceModal
                isOpen={isModalOpen}
                onClose={closeVoice}
                session={session}
                onTap={handleTap}
            />
        </div>
    );
}
