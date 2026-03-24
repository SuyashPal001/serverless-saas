/**
 * Voice UI Types
 */

export type VoiceState = 
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface VoiceSession {
  isActive: boolean;
  state: VoiceState;
  transcript: string;        // What user said (STT result)
  response: string;          // What agent is saying (TTS text)
  error: string | null;
  audioLevel: number;        // 0-1, for waveform visualization
}

export interface VoiceConfig {
  /** Auto-stop listening after silence (ms) */
  silenceTimeout: number;
  /** Show text transcript overlay */
  showTranscript: boolean;
  /** Voice/language for TTS */
  voice: string;
  /** Locale for STT */
  locale: string;
}

export const defaultVoiceConfig: VoiceConfig = {
  silenceTimeout: 2000,
  showTranscript: true,
  voice: 'en-US-Neural2-F',
  locale: 'en-US',
};
