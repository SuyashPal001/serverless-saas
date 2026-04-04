"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, MessageSquare, Bot, Search, MoreVertical, Trash2, Archive } from "lucide-react";
import { Conversation, ConversationsResponse } from "./types";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";

interface ConversationListProps {
    selectedId?: string;
    onSelect: (conversation: Conversation) => void;
    onNewChat: () => void;
}

export function ConversationList({ selectedId, onSelect, onNewChat }: ConversationListProps) {
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [actionType, setActionType] = useState<'archive' | 'delete'>('archive');
    const queryClient = useQueryClient();
    const router = useRouter();
    const params = useParams();
    const tenantSlug = params.tenant as string;

    const { data: conversationsData, isLoading, isError, refetch } = useQuery<ConversationsResponse>({
        queryKey: ["conversations"],
        queryFn: () => api.get<ConversationsResponse>("/api/v1/conversations"),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.del(`/api/v1/conversations/${id}`),
        onSuccess: (_, deletedId) => {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            toast.success("Conversation archived");
            if (selectedId === deletedId) {
                router.push(`/${tenantSlug}/dashboard/chat`);
            }
        },
        onError: (error: any) => {
            toast.error(error.data?.message || "Failed to archive conversation");
        }
    });

    const hardDeleteMutation = useMutation({
        mutationFn: (id: string) => api.del(`/api/v1/conversations/${id}/permanent`),
        onSuccess: (_, deletedId) => {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            toast.success("Conversation deleted");
            if (selectedId === deletedId) {
                router.push(`/${tenantSlug}/dashboard/chat`);
            }
        },
        onError: (error: any) => {
            toast.error(error.data?.message || "Failed to delete conversation");
        }
    });

    const conversations = (conversationsData?.data || []).filter(c => c.status !== 'archived');

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
                            <div key={conversation.id} className="relative group">
                                <button
                                    onClick={() => onSelect(conversation)}
                                    className={cn(
                                        "w-full flex items-center h-9 px-2.5 rounded-md transition-colors text-left",
                                        selectedId === conversation.id 
                                            ? "bg-accent/80 text-foreground font-medium" 
                                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground font-normal"
                                    )}
                                >
                                    <span className="truncate text-[13px] w-[calc(100%-1.25rem)]">
                                        {conversation.title || `Chat with ${conversation.agent?.name || 'Agent'}`}
                                    </span>
                                </button>
                                <div className={cn(
                                    "absolute right-1 top-1/2 -translate-y-1/2",
                                    selectedId === conversation.id 
                                        ? "opacity-100" 
                                        : "opacity-0 group-hover:opacity-100"
                                )}>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted shadow-none data-[state=open]:opacity-100"
                                            >
                                                <MoreVertical className="h-[14px] w-[14px]" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-[160px] rounded-lg">
                                        <DropdownMenuItem
                                            className="cursor-pointer rounded-lg mx-1 my-0.5"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActionType('archive');
                                                setDeleteId(conversation.id);
                                            }}
                                        >
                                            <Archive className="h-4 w-4 mr-2" />
                                            Archive
                                        </DropdownMenuItem>
                                        <div className="h-px bg-border my-1 mx-2" />
                                        <DropdownMenuItem
                                            className="text-red-500 focus:text-red-500 focus:bg-red-500/10 cursor-pointer rounded-lg mx-1 my-0.5"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActionType('delete');
                                                setDeleteId(conversation.id);
                                            }}
                                        >
                                            <Trash2 className="h-4 w-4 mr-2 opacity-80" />
                                            Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                        ))
                    ) : (
                        <div className="py-10 text-center text-sm text-muted-foreground px-4">
                            No conversations yet. Start a new one!
                        </div>
                    )}
                </div>

            <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{actionType === 'delete' ? 'Delete Conversation?' : 'Archive Conversation?'}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {actionType === 'delete'
                                ? 'This will permanently delete the conversation and all its messages. This cannot be undone.'
                                : 'This will move the conversation to your archives. You can still access it later if needed.'
                            }
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (deleteId) {
                                    if (actionType === 'delete') {
                                        hardDeleteMutation.mutate(deleteId);
                                    } else {
                                        deleteMutation.mutate(deleteId);
                                    }
                                    setDeleteId(null);
                                }
                            }}
                        >
                            {actionType === 'delete' ? 'Delete' : 'Archive'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
