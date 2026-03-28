import { SendHorizontal, Loader2, Image as ImageIcon, Plus, Video, Mic, StopCircle, Play, Pause, Trash2, Square } from "lucide-react";
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
import { X, Paperclip, FileText, Lock, Check } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { AudioVisualizer } from "./AudioVisualizer";
import { MessageAudioPlayer } from "./MessageAudioPlayer";

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
    
    // Recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [audioPreview, setAudioPreview] = useState<{ url: string, blob: Blob } | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackTime, setPlaybackTime] = useState(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioChunksRef = useRef<BlobPart[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Cleanup preview URLs and streams on unmount
    useEffect(() => {
        return () => {
            attachments.forEach(attachment => {
                if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
            });
            if (audioPreview) URL.revokeObjectURL(audioPreview.url);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTypeRef = useRef<'image' | 'video' | 'audio' | 'document' | null>(null);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
                    ? 'audio/webm' 
                    : MediaRecorder.isTypeSupported('audio/mp4') 
                        ? 'audio/mp4' 
                        : 'audio/mpeg';

                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                const url = URL.createObjectURL(audioBlob);
                setAudioPreview({ url, blob: audioBlob });
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                }
            };
            
            mediaRecorder.start();
            setIsRecording(true);
            setRecordingTime(0);
            timerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
        } catch (err) {
            console.error(err);
            toast.error("Microphone access denied");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.onstop = null; // Prevent generating preview
            mediaRecorderRef.current.stop();
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        }
        setIsRecording(false);
        setAudioPreview(null);
        if (timerRef.current) clearInterval(timerRef.current);
    };

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleSend = async () => {
        if (isStreaming) {
            onStop?.();
            return;
        }

        if (audioPreview) {
            setIsUploading(true);
            try {
                const ext = audioPreview.blob.type.includes('webm') ? 'webm' : audioPreview.blob.type.includes('mp4') ? 'mp4' : 'mp3';
                const uploadRes = await api.post<{ data: { fileId: string; uploadUrl: string; key: string } }>("/api/v1/files/upload", {
                    filename: `audio_message_${Date.now()}.${ext}`,
                    contentType: audioPreview.blob.type,
                });
                const { fileId, uploadUrl } = uploadRes.data;
                
                const uploadResponse = await fetch(uploadUrl, {
                    method: 'PUT',
                    body: audioPreview.blob,
                    headers: { 'Content-Type': audioPreview.blob.type }
                });
                
                if (!uploadResponse.ok) throw new Error("Upload failed");
                await api.post(`/api/v1/files/${fileId}/confirm`, { size: audioPreview.blob.size });
                
                const finalAttachments = [...attachments, {
                    fileId,
                    name: "Voice Message",
                    type: audioPreview.blob.type,
                    size: audioPreview.blob.size,
                    previewUrl: audioPreview.url
                }];
                
                onSend(content.trim(), finalAttachments);
                setContent("");
                setAttachments([]);
                setAudioPreview(null);
            } catch (err) {
                console.error("Audio upload error:", err);
                toast.error("Failed to upload audio message");
            } finally {
                setIsUploading(false);
            }
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

    const handleMediaClick = (type: 'image' | 'video' | 'audio' | 'document') => {
        uploadTypeRef.current = type;
        handleFileSelect();
        onMediaClick?.(type as any);
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
        
        const maxSize = fileType.startsWith('video/') 
            ? 200 * 1024 * 1024 
            : 35 * 1024 * 1024
        
        if (fileSize > maxSize) {
            toast.error(`File too large. Maximum size is ${fileType.startsWith('video/') ? '200MB' : '35MB'}.`);
            if (fileInputRef.current) fileInputRef.current.value = "";
            setIsUploading(false);
            return;
        }

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
                accept={
                    uploadTypeRef.current === 'video' ? "video/*" : 
                    uploadTypeRef.current === 'audio' ? "audio/*" : 
                    uploadTypeRef.current === 'document' ? "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" : 
                    "image/*,video/*,audio/*,application/pdf"
                }
                onChange={handleFileChange}
            />
            
            <div className="max-w-3xl mx-auto w-full">
                {/* Single input card — attachments + textarea combined */}
                <div className="flex flex-col rounded-2xl border border-border/60 bg-muted/30 focus-within:border-primary/30 transition-colors shadow-sm overflow-hidden">
                    
                    {/* Attachment Preview — inside the card, above text area */}
                    {(attachments.length > 0 || pendingUpload) && (
                        <div className="flex flex-wrap gap-3 p-3 pb-2 animate-in fade-in slide-in-from-top-2 duration-300 w-full">
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
                    
                    {(isRecording || audioPreview) ? (
                        <div className="flex items-center gap-3 w-full bg-transparent px-3 py-4 animate-in fade-in zoom-in-95">
                            <button 
                                onClick={cancelRecording} 
                                className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            >
                                <Trash2 className="h-5 w-5" />
                            </button>
                            
                            <div className="flex-1 flex items-center justify-center">
                                {audioPreview ? (
                                    <MessageAudioPlayer 
                                        url={audioPreview.url} 
                                        durationSeconds={recordingTime} 
                                        variant="input" 
                                    />
                                ) : (
                                    <div className="flex items-center gap-3 w-full min-w-[240px] max-w-sm h-[48px] bg-background/50 backdrop-blur-sm border border-destructive/30 rounded-full px-2 shadow-sm select-none animate-pulse">
                                        <button 
                                            onClick={stopRecording}
                                            className="h-[30px] w-[30px] shadow-sm shrink-0 rounded-full bg-destructive flex items-center justify-center text-destructive-foreground transition-transform active:scale-95"
                                        >
                                            <Square className="h-3 w-3 fill-destructive-foreground" />
                                        </button>
                                        
                                        <div className="flex-1 h-6 flex items-center overflow-hidden">
                                            {streamRef.current && <AudioVisualizer stream={streamRef.current} />}
                                        </div>
                                        
                                        <span className="text-[10px] font-mono shrink-0 w-[38px] text-right ml-1 text-destructive pr-2 font-medium">
                                            {formatTime(recordingTime)}
                                        </span>
                                    </div>
                                )}
                            </div>
                            
                            <button 
                                onClick={handleSend}
                                disabled={isRecording || isUploading} 
                                className="h-10 w-10 shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-sm transition-transform active:scale-95 disabled:opacity-50"
                            >
                                {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
                            </button>
                        </div>
                    ) : (
                        <>
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
                                            <DropdownMenuItem onClick={() => handleMediaClick('audio')} className="gap-2 cursor-pointer py-2">
                                                <Mic className="h-4 w-4" />
                                                <span>Audio</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleMediaClick('document')} className="gap-2 cursor-pointer py-2">
                                                <FileText className="h-4 w-4" />
                                                <span>Document (PDF, DOCX)</span>
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
                                    {!content.trim() && !isStreaming && !isLoading && (
                                        <button
                                            type="button"
                                            onClick={startRecording}
                                            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
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
                        </>
                    )}
                </div>
                
                <p className="text-[10px] text-center text-muted-foreground mt-2">
                    Shift + Enter for a new line. Press Enter to send.
                </p>
            </div>
        </div>
    );
}

