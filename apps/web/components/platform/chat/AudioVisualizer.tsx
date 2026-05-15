"use client";

import { useEffect, useRef } from "react";

interface AudioVisualizerProps {
    stream: MediaStream;
}

export function AudioVisualizer({ stream }: AudioVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        analyser.fftSize = 64;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        let animationId: number;

        const draw = () => {
            animationId = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Adjust visual style for modern sleek look
            const barWidth = 4;
            const gap = 2;
            const startX = 0;
            const barCount = Math.floor(canvas.width / (barWidth + gap));
            
            for (let i = 0; i < barCount; i++) {
                // Map index to frequency data (scale down index to fit bufferLength)
                const dataIndex = Math.floor((i / barCount) * (bufferLength / 2));
                const amplitude = dataArray[dataIndex] || 0;
                
                const percent = amplitude / 255;
                const height = Math.max(4, percent * canvas.height);
                
                const x = startX + i * (barWidth + gap);
                const y = (canvas.height - height) / 2;
                
                // Render with red color for recording
                ctx.fillStyle = "rgba(239, 68, 68, 0.8)";
                ctx.beginPath();
                ctx.roundRect(x, y, barWidth, height, 2);
                ctx.fill();
            }
        };

        draw();

        return () => {
            cancelAnimationFrame(animationId);
            source.disconnect();
            analyser.disconnect();
            audioContext.close();
        };
    }, [stream]);

    return (
        <canvas 
            ref={canvasRef} 
            width={300} 
            height={32} 
            className="w-full max-w-[200px] h-8"
        />
    );
}
