import { SendHorizontal, Loader2, Image as ImageIcon, Plus, Video, Mic, StopCircle } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
    onSend: (content: string) => void;
    onStop?: () => void;
    onVoiceClick?: () => void;
    onMediaClick?: (type: 'image' | 'video') => void;
    disabled?: boolean;
    isLoading?: boolean;
    isStreaming?: boolean;
}

export function ChatInput({ onSend, onStop, onVoiceClick, onMediaClick, disabled, isLoading, isStreaming }: ChatInputProps) {
    const [content, setContent] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleSend = () => {
        if (isStreaming) {
            onStop?.();
            return;
        }
        if (!content.trim() || disabled || isLoading) return;
        onSend(content.trim());
        setContent("");
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "inherit";
            const scrollHeight = textareaRef.current.scrollHeight;
            textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`;
        }
    }, [content]);

    return (
        <div className="pb-6 pt-2 px-4 bg-transparent w-full">
            <div className="flex items-end gap-3 max-w-3xl mx-auto w-full relative">
                <div className="flex items-center self-end mb-1">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground border border-border/50">
                                <Plus className="h-5 w-5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48 p-2">
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Add context</div>
                            <DropdownMenuItem onClick={() => onMediaClick?.('image')} className="gap-2 cursor-pointer py-2">
                                <ImageIcon className="h-4 w-4" />
                                <span>Media</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onMediaClick?.('video')} className="gap-2 cursor-pointer py-2">
                                <Video className="h-4 w-4" />
                                <span>Video</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="relative flex-1 flex items-end">
                    <Textarea
                        ref={textareaRef}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message..."
                        className="flex-1 min-h-[44px] max-h-[200px] py-3 pr-24 pl-4 resize-none bg-muted/30 border border-border/50 rounded-2xl focus-visible:ring-1 focus-visible:ring-primary/20 transition-all text-sm"
                        disabled={disabled}
                    />
                    
                    <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1.5">
                        {onVoiceClick && !content.trim() && !isStreaming && !isLoading && (
                            <Button
                                type="button"
                                size="icon"
                                onClick={onVoiceClick}
                                variant="ghost"
                                className="h-8 w-8 rounded-xl text-purple-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
                            >
                                <Mic className="h-4 w-4" />
                            </Button>
                        )}
                        
                        {isStreaming ? (
                            <Button
                                size="icon"
                                onClick={onStop}
                                variant="destructive"
                                className="h-8 w-8 rounded-xl animate-in fade-in zoom-in duration-200 shadow-sm"
                            >
                                <StopCircle className="h-4 w-4" />
                                <span className="sr-only">Stop</span>
                            </Button>
                        ) : (
                            <Button
                                size="icon"
                                onClick={handleSend}
                                disabled={!content.trim() || disabled || isLoading}
                                className="h-8 w-8 rounded-xl shadow-sm transition-all active:scale-95"
                            >
                                {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <SendHorizontal className="h-4 w-4" />
                                )}
                                <span className="sr-only">Send</span>
                            </Button>
                        )}
                    </div>
                </div>
            </div>
            <p className="text-[10px] text-center text-muted-foreground mt-3">
                Shift + Enter for a new line. Press Enter to send.
            </p>
        </div>
    );
}
