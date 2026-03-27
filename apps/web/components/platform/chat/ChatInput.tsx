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
import { api } from "@/lib/api";
import { Attachment } from "@/types/agent-events";
import { X, Paperclip, FileText, Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface LLMProvider {
    id: string;
    provider: string;
    model: string;
    displayName: string;
    isDefault: boolean;
    status: 'live' | 'coming_soon';
}

interface ChatInputProps {
    onSend: (content: string, attachments?: Attachment[]) => void;
    onStop?: () => void;
    onVoiceClick?: () => void;
    onMediaClick?: (type: 'image' | 'video') => void;
    disabled?: boolean;
    isLoading?: boolean;
    isStreaming?: boolean;
    llmProviderId?: string | null;
    providers?: LLMProvider[];
    onModelChange?: (providerId: string) => void;
}

export function ChatInput({ 
    onSend, 
    onStop, 
    onVoiceClick, 
    onMediaClick, 
    disabled, 
    isLoading, 
    isStreaming,
    llmProviderId,
    providers = [],
    onModelChange
}: ChatInputProps) {
    const [content, setContent] = useState("");
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [pendingUpload, setPendingUpload] = useState<{ previewUrl?: string; name: string; type: string } | null>(null);
    
    // Cleanup preview URLs on unmount
    useEffect(() => {
        return () => {
            attachments.forEach(attachment => {
                if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
            });
        };
    }, []);

    
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTypeRef = useRef<'image' | 'video' | null>(null);

    const handleSend = () => {
        if (isStreaming) {
            onStop?.();
            return;
        }
        if ((!content.trim() && attachments.length === 0) || disabled || isLoading || isUploading) return;
        
        onSend(content.trim(), attachments.length > 0 ? attachments : undefined);
        setContent("");
        setAttachments([]);
        setPendingUpload(null);
    };

    const handleFileSelect = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleMediaClick = (type: 'image' | 'video') => {
        uploadTypeRef.current = type;
        handleFileSelect();
        onMediaClick?.(type);
    };

    const removeAttachment = (fileId: string) => {
        setAttachments(prev => {
            const toRemove = prev.find(a => a.fileId === fileId);
            if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
            return prev.filter(a => a.fileId !== fileId);
        });
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        const fileName = file.name;
        const fileType = file.type;
        const fileSize = file.size;
        
        // Immediate local preview — show in the strip right away as skeleton
        let previewUrl: string | undefined;
        if (fileType.startsWith('image/')) {
            previewUrl = URL.createObjectURL(file);
        }
        setPendingUpload({ previewUrl, name: fileName, type: fileType });

        try {
            // 1. Get upload URL — backend returns { data: { fileId, uploadUrl, key } }
            const uploadRes = await api.post<{ data: { fileId: string; uploadUrl: string; key: string } }>("/api/v1/files/upload", {
                filename: fileName,
                contentType: fileType,
            });
            const { fileId, uploadUrl, key } = uploadRes.data;
            console.log('[upload] uploadUrl:', uploadUrl);
            console.log('[upload] fileId:', fileId);

            // 2. Upload directly to S3
            console.log('[upload] starting S3 PUT');
            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': fileType
                }
            });
            console.log('[upload] S3 PUT status:', uploadResponse.status);

            if (!uploadResponse.ok) throw new Error("Failed to upload to S3");

            // 3. Confirm upload
            await api.post(`/api/v1/files/${fileId}/confirm`, { size: fileSize });

            setAttachments(prev => [...prev, {
                fileId,
                name: fileName,
                type: fileType,
                size: fileSize,
                previewUrl  // carry through for optimistic preview in message thread
            }]);

            toast.success("File uploaded successfully");
        } catch (error) {
            console.error("Upload error:", error);
            toast.error("Failed to upload file");
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        } finally {
            setIsUploading(false);
            setPendingUpload(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            uploadTypeRef.current = null;
        }
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
            <input 
                type="file" 
                ref={fileInputRef}
                className="hidden" 
                accept={uploadTypeRef.current === 'video' ? "video/*" : "image/*,video/*"}
                onChange={handleFileChange}
            />
            
            <div className="max-w-3xl mx-auto w-full">
                {/* Single input card — attachments + textarea combined */}
                <div className="flex flex-col rounded-2xl border border-border/60 bg-muted/30 focus-within:border-primary/30 transition-colors shadow-sm overflow-hidden">
                    
                    {/* Attachment Preview — inside the card, above text area */}
                    {(attachments.length > 0 || pendingUpload) && (
                        <div className="flex flex-wrap gap-3 p-3 pb-2 animate-in fade-in slide-in-from-top-2 duration-300">
                            {/* Confirmed attachments */}
                            {attachments.map((file) => (
                                <div key={file.fileId} className="relative">
                                    {file.previewUrl ? (
                                        <div className="h-20 w-20 rounded-xl overflow-hidden border border-border/40 shadow-sm">
                                            <img 
                                                src={file.previewUrl} 
                                                alt={file.name} 
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                    ) : (
                                        <div className="h-20 w-20 rounded-xl border border-border/40 bg-muted flex flex-col items-center justify-center gap-1 p-2">
                                            {file.type.startsWith('video/') ? (
                                                <Video className="h-7 w-7 text-purple-500 opacity-80" />
                                            ) : (
                                                <FileText className="h-7 w-7 text-muted-foreground opacity-80" />
                                            )}
                                            <span className="text-[9px] font-medium line-clamp-2 text-center break-all leading-tight">{file.name}</span>
                                        </div>
                                    )}
                                    {/* Always-visible X — like Claude */}
                                    <button 
                                        onClick={() => removeAttachment(file.fileId)}
                                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center shadow-md hover:scale-110 transition-transform duration-150"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}

                            {/* Pending upload — skeleton shimmer */}
                            {pendingUpload && (
                                <div className="relative h-20 w-20 rounded-xl overflow-hidden border border-border/40 shadow-sm">
                                    {pendingUpload.previewUrl ? (
                                        <img
                                            src={pendingUpload.previewUrl}
                                            alt="Uploading..."
                                            className="h-full w-full object-cover opacity-50"
                                        />
                                    ) : (
                                        <div className="h-full w-full bg-muted" />
                                    )}
                                    {/* Shimmer overlay */}
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                                    {/* Pulsing dark tint */}
                                    <div className="absolute inset-0 bg-black/30 animate-pulse" />
                                    {/* Spinner in centre */}
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <Loader2 className="h-5 w-5 text-white animate-spin drop-shadow" />
                                    </div>
                                </div>
                            )}

                            {/* Divider below attachment strip */}
                            <div className="w-full h-px bg-border/40 mt-1" />
                        </div>
                    )}
                    
                    {/* Textarea — no border, merges with card */}
                    <Textarea
                        ref={textareaRef}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask anything, @ to mention, / for workflows..."
                        className="w-full min-h-[44px] max-h-[200px] py-4 px-4 resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm shadow-none placeholder:text-muted-foreground/50"
                        disabled={disabled}
                    />
                    
                    {/* Bottom actions row */}
                    <div className="flex items-center justify-between px-2 pb-2">
                        <div className="flex items-center gap-0.5">
                            {/* + Button */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                                        <Plus className="h-4 w-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent side="top" align="start" className="w-48 p-2">
                                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Add context</div>
                                    <DropdownMenuItem onClick={() => handleMediaClick('image')} className="gap-2 cursor-pointer py-2">
                                        <ImageIcon className="h-4 w-4" />
                                        <span>Media</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleMediaClick('video')} className="gap-2 cursor-pointer py-2">
                                        <Video className="h-4 w-4" />
                                        <span>Video</span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <div className="h-4 w-[1px] bg-border/30 mx-1" />

                            {/* Model Selector button */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs font-medium text-muted-foreground hover:text-foreground gap-1.5 rounded-lg">
                                        <span className="opacity-50">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                                        </span>
                                        {providers.find(p => p.id === llmProviderId)?.displayName || 
                                         providers.find(p => p.isDefault)?.displayName || 
                                         "Model"}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent side="top" align="start" className="w-64 p-1">
                                    <div className="px-2 py-1.5 text-[10px] uppercase font-bold text-muted-foreground tracking-wider opacity-50">Model</div>
                                    {providers.map((p) => (
                                        <DropdownMenuItem 
                                            key={p.id}
                                            onClick={() => onModelChange?.(p.id)}
                                            disabled={p.status === 'coming_soon'}
                                            className={cn(
                                                "gap-2 cursor-pointer py-2 flex items-center justify-between rounded-md transition-colors",
                                                llmProviderId === p.id && "bg-muted font-medium",
                                                p.status === 'coming_soon' && "opacity-40"
                                            )}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span>{p.displayName}</span>
                                                {p.status === 'coming_soon' && (
                                                    <Lock className="h-3 w-3" />
                                                )}
                                            </div>
                                            {p.status === 'live' && !llmProviderId && p.isDefault && (
                                                <Badge variant="outline" className="text-[9px] h-4 px-1 opacity-60">Default</Badge>
                                            )}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        {/* Right action buttons */}
                        <div className="flex items-center gap-1.5">
                            {onVoiceClick && !content.trim() && !isStreaming && !isLoading && (
                                <button
                                    type="button"
                                    onClick={onVoiceClick}
                                    className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-purple-500 hover:bg-purple-100/50 dark:hover:bg-purple-950/20 transition-colors"
                                >
                                    <Mic className="h-4 w-4" />
                                </button>
                            )}
                            
                            {isStreaming ? (
                                <button
                                    onClick={onStop}
                                    className="h-8 w-8 flex items-center justify-center rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all shadow-sm"
                                >
                                    <StopCircle className="h-4 w-4" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleSend}
                                    disabled={(!content.trim() && attachments.length === 0) || disabled || isLoading || isUploading}
                                    className={cn(
                                        "h-8 w-8 flex items-center justify-center rounded-lg transition-all active:scale-95 shadow-sm",
                                        (content.trim() || attachments.length > 0) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground opacity-40"
                                    )}
                                >
                                    {isLoading || isUploading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <SendHorizontal className="h-4 w-4" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                
                <p className="text-[10px] text-center text-muted-foreground mt-2">
                    Shift + Enter for a new line. Press Enter to send.
                </p>
            </div>
        </div>
    );
}

