"use client"

import { useState, useMemo, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ConversationList } from "@/components/platform/chat/ConversationList";
import { MessageThread } from "@/components/platform/chat/MessageThread";
import { ChatInput } from "@/components/platform/chat/ChatInput";
import { AgentSelector } from "@/components/platform/chat/AgentSelector";
import { Conversation, ConversationsResponse, MessagesResponse, Message, ToolCall } from "@/components/platform/chat/types";
import { Agent } from "@/components/platform/agents/types";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { Canvas } from "@/components/platform/canvas/Canvas";
import { useCanvas } from "@/hooks/useCanvas";
import type { CanvasAction, CanvasEventData } from "@/components/platform/canvas/types";
import { VoiceButton, VoiceModal } from "@/components/platform/voice";
import { useVoice } from "@/hooks/useVoice";
import { Bot, MessageSquare, Plus, Info, MoreVertical, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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

    // Fetch conversations
    const { data: conversationsData, isLoading: isLoadingConversations } = useQuery<ConversationsResponse>({
        queryKey: ["conversations"],
        queryFn: () => api.get<ConversationsResponse>("/api/v1/conversations"),
    });

    const conversations = conversationsData?.data || [];
    const selectedConversation = useMemo(() => 
        conversations.find(c => c.id === conversationId),
    [conversations, conversationId]);

    const {
        isCanvasOpen,
        hasActivity,
        toggleCanvas,
        handleCanvasUpdate,
        resetCanvas,
    } = useCanvas();

    const {
        isModalOpen,
        session,
        openVoice,
        closeVoice,
        handleTap,
    } = useVoice({ conversationId: conversationId || undefined });

    const [isThinking, setIsThinking] = useState(false);
    const [eventError, setEventError] = useState<string | null>(null);
    const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCall>>(new Map());

    useAgentEvents({
        conversationId: conversationId || '',
        onThinking: useCallback(() => {
            setIsThinking(true);
            setEventError(null);
        }, []),
        onMessageDelta: useCallback((delta: string, messageId: string) => {
            setIsThinking(false);
            queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
                if (!old) return { data: [] };
                const existingIndex = old.data.findIndex(m => m.id === messageId);
                if (existingIndex >= 0) {
                    const newData = [...old.data];
                    newData[existingIndex] = {
                        ...newData[existingIndex],
                        content: newData[existingIndex].content + delta,
                        isStreaming: true,
                    };
                    return { data: newData };
                } else {
                    return {
                        data: [...old.data, {
                            id: messageId,
                            conversationId: conversationId!,
                            role: 'assistant',
                            content: delta,
                            createdAt: new Date().toISOString(),
                            isStreaming: true,
                        }]
                    };
                }
            });
        }, [conversationId, queryClient]),
        onMessageComplete: useCallback((content: string, messageId: string) => {
            setIsThinking(false);
            queryClient.setQueryData<MessagesResponse>(["messages", conversationId], (old) => {
                if (!old) return { data: [] };
                const existingIndex = old.data.findIndex(m => m.id === messageId);
                if (existingIndex >= 0) {
                    const newData = [...old.data];
                    newData[existingIndex] = {
                        ...newData[existingIndex],
                        content,
                        isStreaming: false,
                    };
                    return { data: newData };
                } else {
                    return {
                        data: [...old.data, {
                            id: messageId,
                            conversationId: conversationId!,
                            role: 'assistant',
                            content,
                            createdAt: new Date().toISOString(),
                            isStreaming: false,
                        }]
                    };
                }
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
        onError: useCallback((code: string, message: string, recoverable: boolean) => {
            setIsThinking(false);
            setEventError(`[${code}] ${message}`);
            toast.error(message);
        }, []),
        onCanvasUpdate: (action, data) => handleCanvasUpdate(action as CanvasAction, data as CanvasEventData),
        onSessionEnded: useCallback((reason: string) => {
            setIsThinking(false);
            setActiveToolCalls(new Map());
            // Make sure we have the final DB state
            queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
            // resetCanvas(); // Optional
        }, [conversationId, queryClient]),
    });

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
            api.post<Conversation>("/api/v1/conversations", { agentId }),
        onSuccess: (newConv) => {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            setIsSelectorOpen(false);
            router.push(`/${tenantSlug}/dashboard/chat?id=${newConv.id}`);
            toast.success("Conversation started");
        },
        onError: (error: any) => {
            toast.error(error.data?.error || "Failed to start conversation");
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
            setEventError(null);
            return api.post<Message>(`/api/v1/conversations/${conversationId}/messages`, { content });
        },
        onSuccess: () => {
            // Realtime updates handled by websocket
        },
        onError: (error: any) => {
            setIsThinking(false);
            toast.error(error.data?.error || "Failed to send message");
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

    const handleSendMessage = (content: string) => {
        sendMessage.mutate(content);
    };

    return (
        <div className="flex flex-col h-[calc(100vh-172px)] -m-8 overflow-hidden bg-background">
            <div className="flex flex-1 overflow-hidden">
                {/* Conversations Sidebar */}
                <div className="w-1/4 min-w-[280px] flex flex-col border-r border-border">
                    <ConversationList 
                        selectedId={conversationId || undefined}
                        onSelect={handleSelectConversation}
                        onNewChat={handleNewChat}
                    />
                </div>

                {/* Chat Area & Canvas Container */}
                <div className="flex-1 flex overflow-hidden">
                    
                    {/* Chat Panel */}
                    <div className={cn(
                        "flex flex-col overflow-hidden bg-muted/5 transition-all",
                        isCanvasOpen ? "w-1/2 border-r border-border" : "w-full"
                    )}>
                        {selectedConversation ? (
                            <>
                                {/* Chat Header */}
                                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background shadow-sm z-10 shrink-0">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20">
                                            <Bot className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h2 className="font-semibold text-foreground truncate max-w-[200px] sm:max-w-[400px]">
                                                    {selectedConversation.title || `Chat with ${selectedConversation.agent?.name}`}
                                                </h2>
                                                <Badge variant={selectedConversation.status === 'active' ? "default" : "secondary"} className="text-[10px] h-4.5">
                                                    {selectedConversation.status}
                                                </Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                <span>Agent: {selectedConversation.agent?.name} ({selectedConversation.agent?.type})</span>
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
                            <div className="flex items-end gap-2 px-6 pb-4">
                                <VoiceButton onClick={openVoice} className="mb-1" />
                                <div className="flex-1 min-w-0">
                                    <ChatInput 
                                        onSend={handleSendMessage} 
                                        isLoading={sendMessage.isPending || isThinking}
                                        disabled={selectedConversation.status !== 'active'}
                                    />
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6 shadow-sm border border-border">
                                <MessageSquare className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h2 className="text-2xl font-bold tracking-tight mb-2">Select a conversation</h2>
                            <p className="text-muted-foreground max-w-sm mb-8">
                                Select an existing conversation from the list or start a new one to interact with your agents.
                            </p>
                            <Button onClick={handleNewChat} size="lg" className="rounded-full shadow-lg h-12 px-6 gap-2">
                                <Plus className="h-4 w-4" />
                                Start New Conversation
                            </Button>
                        </div>
                    )}
                    </div>
                    
                    {/* Canvas Panel */}
                    <div className={cn(
                        "transition-all overflow-hidden h-full z-10",
                        isCanvasOpen ? "w-1/2" : "w-0"
                    )}>
                        <Canvas isOpen={isCanvasOpen} onActivity={() => {}} />
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
