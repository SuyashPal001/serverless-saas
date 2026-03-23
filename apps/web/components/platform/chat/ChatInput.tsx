"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizontal, Loader2 } from "lucide-react";

interface ChatInputProps {
    onSend: (content: string) => void;
    disabled?: boolean;
    isLoading?: boolean;
}

export function ChatInput({ onSend, disabled, isLoading }: ChatInputProps) {
    const [content, setContent] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleSend = () => {
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
        <div className="p-4 border-t border-border bg-background">
            <div className="relative flex items-end gap-2 max-w-4xl mx-auto">
                <Textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    className="flex-1 min-h-[44px] max-h-[200px] py-3 pr-12 resize-none bg-muted/30 focus-visible:ring-1"
                    disabled={disabled}
                />
                <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={!content.trim() || disabled || isLoading}
                    className="absolute right-2 bottom-1.5 h-8 w-8 rounded-full"
                >
                    {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <SendHorizontal className="h-4 w-4" />
                    )}
                    <span className="sr-only">Send</span>
                </Button>
            </div>
            <p className="text-[10px] text-center text-muted-foreground mt-2">
                Shift + Enter for a new line. Press Enter to send.
            </p>
        </div>
    );
}
