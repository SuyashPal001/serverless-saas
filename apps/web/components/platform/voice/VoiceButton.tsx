'use client';

import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceButtonProps {
  onClick: () => void;
  className?: string;
}

export function VoiceButton({ onClick, className }: VoiceButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-3 rounded-full',
        'bg-gradient-to-br from-purple-500 to-blue-500',
        'hover:from-purple-600 hover:to-blue-600',
        'text-white shadow-lg',
        'transition-all hover:scale-105 active:scale-95',
        'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
        className
      )}
    >
      <Mic className="w-5 h-5" />
    </button>
  );
}
