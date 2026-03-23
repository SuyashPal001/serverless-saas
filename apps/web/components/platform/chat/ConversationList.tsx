"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, MessageSquare, Bot } from "lucide-react";
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
    const { data: conversationsData, isLoading } = useQuery<ConversationsResponse>({
        queryKey: ["conversations"],
        queryFn: () => api.get<ConversationsResponse>("/api/v1/conversations"),
    });

    const conversations = conversationsData?.data || [];

    return (
        <div className="flex flex-col h-full border-r border-border bg-muted/10">
            <div className="p-4">
                <Button onClick={onNewChat} className="w-full justify-start gap-2" variant="default">
                    <Plus className="h-4 w-4" />
                    New Conversation
                </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
                    {isLoading ? (
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
                                    "w-full flex flex-col items-start gap-1 p-3 rounded-lg text-left transition-colors hover:bg-muted text-sm",
                                    selectedId === conversation.id ? "bg-muted shadow-sm ring-1 ring-border" : "transparent"
                                )}
                            >
                                <div className="flex items-center justify-between w-full gap-2">
                                    <span className="font-semibold truncate">
                                        {conversation.title || `Chat with ${conversation.agent?.name || 'Agent'}`}
                                    </span>
                                    {conversation.status === 'active' && (
                                        <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Bot className="h-3 w-3" />
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
