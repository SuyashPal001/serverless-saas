"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, MessageSquare, Bot, Search, MoreVertical } from "lucide-react";
import { Conversation, ConversationsResponse } from "./types";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";

interface ConversationListProps {
    selectedId?: string;
    onSelect: (conversation: Conversation) => void;
    onNewChat: () => void;
}

export function ConversationList({ selectedId, onSelect, onNewChat }: ConversationListProps) {
    const { data: conversationsData, isLoading, isError, refetch } = useQuery<ConversationsResponse>({
        queryKey: ["conversations"],
        queryFn: () => api.get<ConversationsResponse>("/api/v1/conversations"),
    });

    const conversations = conversationsData?.data || [];

    return (
        <div className="flex flex-col h-full bg-background border-r border-border">
            <div className="p-4 flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight">Messages</h2>
                <Button 
                    onClick={onNewChat} 
                    size="icon" 
                    variant="ghost" 
                    className="h-8 w-8 rounded-full hover:bg-accent/50 transition-colors"
                >
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
            
            <div className="px-4 pb-4">
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <input 
                        type="text" 
                        placeholder="Search chats..."
                        className="w-full bg-muted/40 border-none rounded-xl py-2 pl-9 pr-4 text-sm focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                    />
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto px-2 space-y-0.5 custom-scrollbar">
                    {isError ? (
                        <div className="py-10 text-center px-4">
                            <p className="text-sm text-destructive mb-2">Failed to load chats</p>
                            <Button variant="outline" size="sm" onClick={() => refetch()} className="mx-auto">
                                Retry
                            </Button>
                        </div>
                    ) : isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="p-3">
                                <Skeleton className="h-10 w-full" />
                            </div>
                        ))
                    ) : conversations.length > 0 ? (
                        conversations.map((conversation) => (
                            <button
                                key={conversation.id}
                                onClick={() => onSelect(conversation)}
                                className={cn(
                                    "w-full flex flex-col items-start gap-1 p-3 rounded-xl text-left transition-all hover:bg-muted group relative",
                                    selectedId === conversation.id ? "bg-muted shadow-sm ring-1 ring-border" : "transparent"
                                )}
                            >
                                <div className="flex items-center justify-between w-full gap-2">
                                    <span className={cn(
                                        "font-semibold truncate text-sm",
                                        selectedId === conversation.id ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                                    )}>
                                        {conversation.title || `Chat with ${conversation.agent?.name || 'Agent'}`}
                                    </span>
                                    {conversation.status === 'active' && (
                                        <div className="h-2 w-2 rounded-full bg-green-500 shrink-0 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <Bot className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{conversation.agent?.name || "Agent"}</span>
                                    <span>•</span>
                                    <span>{formatDistanceToNow(new Date(conversation.createdAt), { addSuffix: true })}</span>
                                </div>
                            </button>
                        ))
                    ) : (
                        <div className="py-10 text-center text-sm text-muted-foreground px-4">
                            No conversations yet. Start a new one!
                        </div>
                    )}
                </div>
        </div>
    );
}
