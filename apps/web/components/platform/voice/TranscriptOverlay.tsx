'use client';

import { cn } from '@/lib/utils';
import type { VoiceState } from './types';

interface TranscriptOverlayProps {
  state: VoiceState;
  transcript: string;
  response: string;
  isVisible: boolean;
}

export function TranscriptOverlay({
  state,
  transcript,
  response,
  isVisible,
}: TranscriptOverlayProps) {
  if (!isVisible) return null;

  const showTranscript = state === 'listening' && transcript;
  const showResponse = (state === 'speaking' || state === 'thinking') && response;

  if (!showTranscript && !showResponse) return null;

  return (
    <div className="absolute bottom-32 left-0 right-0 px-8">
      <div className={cn(
        'max-w-lg mx-auto p-4 rounded-2xl backdrop-blur-xl',
        'bg-white/10 border border-white/20',
        'transition-all duration-300',
      )}>
        {showTranscript && (
          <div className="text-center">
            <p className="text-sm text-white/60 mb-1">You said:</p>
            <p className="text-lg text-white">{transcript}</p>
          </div>
        )}
        
        {showResponse && (
          <div className="text-center">
            <p className="text-sm text-white/60 mb-1">
              {state === 'thinking' ? 'Thinking...' : 'Agent:'}
            </p>
            <p className="text-lg text-white">
              {response}
              {state === 'speaking' && (
                <span className="inline-block w-2 h-4 bg-white ml-1 animate-pulse" />
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
