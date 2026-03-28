"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageAudioPlayerProps {
    url: string;
    durationSeconds?: number;
    variant?: 'user' | 'assistant' | 'input';
}

export function MessageAudioPlayer({ url, durationSeconds = 0, variant = 'input' }: MessageAudioPlayerProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(durationSeconds);
    const [peaks, setPeaks] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const audioRef = useRef<HTMLAudioElement>(null);

    // Fetch and decode audio to generate static waveform
    useEffect(() => {
        let isMounted = true;
        const processAudio = async () => {
            setIsLoading(true);
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                
                if (!isMounted) return;
                
                setDuration(audioBuffer.duration);
                // Extract peaks from single channel
                const rawData = audioBuffer.getChannelData(0); 
                const samples = 40; // Number of waveform bars
                const blockSize = Math.floor(rawData.length / samples);
                const filteredData = [];
                for (let i = 0; i < samples; i++) {
                    let blockStart = blockSize * i;
                    let sum = 0;
                    for (let j = 0; j < blockSize; j++) {
                        sum = sum + Math.abs(rawData[blockStart + j]);
                    }
                    filteredData.push(sum / blockSize);
                }
                
                // Normalize to peak amplitude
                const multiplier = Math.pow(Math.max(...filteredData), -1);
                const normalized = filteredData.map(n => Math.max(0.05, n * multiplier));
                setPeaks(normalized);
            } catch (error) {
                console.error("Failed to decode audio for waveform:", error);
                // Fallback to random smooth curve
                setPeaks(Array.from({ length: 40 }).map(() => Math.max(0.2, Math.random())));
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };
        processAudio();
        
        return () => { isMounted = false; };
    }, [url]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const togglePlay = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!audioRef.current || peaks.length === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const newTime = Math.max(0, Math.min(percent * duration, duration));
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
    };

    const containerClasses = {
        user: "bg-primary text-primary-foreground shadow-sm rounded-2xl rounded-tr-none px-3 py-2",
        assistant: "bg-muted text-foreground border border-border/50 shadow-sm rounded-2xl rounded-tl-none px-3 py-2",
        input: "bg-background/50 backdrop-blur-sm border border-border/40 rounded-full px-2",
    }[variant];

    const buttonClasses = {
        user: "bg-primary-foreground text-primary",
        assistant: "bg-background text-foreground shadow-sm border border-border/50",
        input: "bg-primary text-primary-foreground shadow-sm",
    }[variant];

    const waveformPlayedClass = {
        user: "bg-primary-foreground",
        assistant: "bg-primary",
        input: "bg-primary",
    }[variant];

    const waveformUnplayedClass = {
        user: "bg-primary-foreground/30",
        assistant: "bg-primary/20",
        input: "bg-primary/20",
    }[variant];

    const textClass = {
        user: "text-primary-foreground/80",
        assistant: "text-muted-foreground",
        input: "text-muted-foreground",
    }[variant];

    return (
        <div className={cn("flex items-center gap-3 w-full min-w-[240px] max-w-sm h-[48px] select-none", containerClasses)}>
            <button 
                onClick={togglePlay} 
                disabled={isLoading}
                className={cn("h-[30px] w-[30px] shrink-0 rounded-full flex items-center justify-center transition-transform active:scale-95 disabled:opacity-50", buttonClasses)}
            >
                {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isPlaying ? (
                    <Pause className="h-3.5 w-3.5" />
                ) : (
                    <Play className="h-3.5 w-3.5 ml-0.5" />
                )}
            </button>
            
            <div 
                className="flex-1 h-6 flex items-center gap-px cursor-pointer touch-none opacity-80 hover:opacity-100 transition-opacity"
                onClick={handleScrub}
            >
                {peaks.length > 0 ? peaks.map((p, i) => {
                    const percentComplete = duration > 0 ? currentTime / duration : 0;
                    const barPercent = i / peaks.length;
                    const isPlayed = barPercent <= percentComplete;
                    return (
                        <div 
                            key={i} 
                            className={cn(
                                "flex-1 rounded-full transition-colors duration-200",
                                isPlayed ? waveformPlayedClass : waveformUnplayedClass
                            )} 
                            style={{ height: `${Math.max(15, p * 100)}%`, minWidth: '2px' }} 
                        />
                    );
                }) : (
                    <div className="w-full h-full flex items-center gap-px">
                        {Array.from({ length: 40 }).map((_, i) => (
                            <div key={i} className={cn("flex-1 rounded-full", waveformUnplayedClass)} style={{ height: '2px', minWidth: '2px' }} />
                        ))}
                    </div>
                )}
            </div>
            
            <span className={cn("text-[10px] font-mono shrink-0 w-[38px] text-right ml-1", textClass)}>
                {formatTime(currentTime || duration)}
            </span>
            
            <audio 
                ref={audioRef}
                src={url} 
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
                className="hidden" 
            />
        </div>
    );
}
