import { useState, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ConversationList } from "@/components/platform/chat/ConversationList";
import { MessageThread } from "@/components/platform/chat/MessageThread";
import { ChatInput } from "@/components/platform/chat/ChatInput";
import { AgentSelector } from "@/components/platform/chat/AgentSelector";
import { Conversation, ConversationsResponse, MessagesResponse, Message } from "@/components/platform/chat/types";
import { Agent } from "@/components/platform/agents/types";
import { Bot, MessageSquare, Plus, Info, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

    // Fetch messages
    const { data: messagesData, isLoading: isLoadingMessages, refetch: refetchMessages } = useQuery<MessagesResponse>({
        queryKey: ["messages", conversationId],
        queryFn: () => api.get<MessagesResponse>(`/api/v1/conversations/${conversationId}/messages`),
        enabled: !!conversationId,
        refetchInterval: (query) => {
            // In TanStack Query v5, refetchInterval receives the query object
            const data = query.state.data as MessagesResponse | undefined;
            const lastMessage = data?.data?.[data.data.length - 1];
            // If the last message is from user, poll for assistant response
            return lastMessage?.role === 'user' ? 2000 : false;
        }
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
        mutationFn: (content: string) => 
            api.post<Message>(`/api/v1/conversations/${conversationId}/messages`, { content }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
            // Optimistic refresh would be better, but standard refetch for now
            refetchMessages();
        },
        onError: (error: any) => {
            toast.error(error.data?.error || "Failed to send message");
        }
    });

    // Determine if AI is typing based on last message role
    const isTyping = useMemo(() => {
        if (!messages.length) return false;
        const lastMessage = messages[messages.length - 1];
        return lastMessage.role === 'user';
    }, [messages]);

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

                {/* Chat Area */}
                <div className="flex-1 flex flex-col overflow-hidden bg-muted/5">
                    {selectedConversation ? (
                        <>
                            {/* Chat Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background shadow-sm z-10">
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
                                isTyping={isTyping || sendMessage.isPending}
                            />

                            {/* Input */}
                            <ChatInput 
                                onSend={handleSendMessage} 
                                isLoading={sendMessage.isPending || isTyping}
                                disabled={selectedConversation.status !== 'active'}
                            />
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
            </div>

            <AgentSelector 
                open={isSelectorOpen} 
                onOpenChange={setIsSelectorOpen}
                onSelect={handleSelectAgent}
            />
        </div>
    );
}
