'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { VoiceState, VoiceSession, VoiceConfig, defaultVoiceConfig } from '@/components/platform/voice/types';

interface UseVoiceOptions {
  conversationId?: string;
  config?: Partial<VoiceConfig>;
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
}

export function useVoice(options: UseVoiceOptions = {}) {
  const { conversationId, config, onTranscript, onResponse } = options;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [session, setSession] = useState<VoiceSession>({
    isActive: false,
    state: 'idle',
    transcript: '',
    response: '',
    error: null,
    audioLevel: 0,
  });

  // Refs for audio handling (will be implemented later)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Mock audio level animation
  useEffect(() => {
    if (!session.isActive || session.state === 'idle') return;

    const interval = setInterval(() => {
      setSession(prev => ({
        ...prev,
        audioLevel: Math.random() * 0.5 + 0.3, // Random 0.3-0.8
      }));
    }, 100);

    return () => clearInterval(interval);
  }, [session.isActive, session.state]);

  // Open voice modal
  const openVoice = useCallback(() => {
    setIsModalOpen(true);
    setSession(prev => ({ ...prev, isActive: true, state: 'idle' }));
  }, []);

  // Close voice modal
  const closeVoice = useCallback(() => {
    setIsModalOpen(false);
    setSession({
      isActive: false,
      state: 'idle',
      transcript: '',
      response: '',
      error: null,
      audioLevel: 0,
    });
  }, []);

  // Handle orb tap
  const handleTap = useCallback(() => {
    setSession(prev => {
      switch (prev.state) {
        case 'idle':
          // Start listening
          // TODO: Start actual audio recording
          simulateListening();
          return { ...prev, state: 'listening', transcript: '', response: '' };

        case 'listening':
          // Cancel listening
          return { ...prev, state: 'idle' };

        case 'speaking':
          // Interrupt speaking
          // TODO: Stop TTS playback
          return { ...prev, state: 'idle' };

        case 'error':
          // Retry
          return { ...prev, state: 'idle', error: null };

        default:
          return prev;
      }
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally leaving simulateListening out of deps to avoid circular loop

  // Simulate listening → thinking → speaking (MOCK)
  const simulateListening = useCallback(() => {
    // Simulate transcript appearing
    setTimeout(() => {
      setSession(prev => ({
        ...prev,
        transcript: 'What is the weather like today?',
      }));
    }, 1500);

    // Simulate end of speech → thinking
    setTimeout(() => {
      setSession(prev => ({
        ...prev,
        state: 'thinking',
      }));
    }, 3000);

    // Simulate response
    setTimeout(() => {
      setSession(prev => ({
        ...prev,
        state: 'speaking',
        response: 'The weather today is sunny with a high of 24°C.',
      }));
      onResponse?.('The weather today is sunny with a high of 24°C.');
    }, 4500);

    // Simulate end of speaking
    setTimeout(() => {
      setSession(prev => ({
        ...prev,
        state: 'idle',
      }));
    }, 7000);
  }, [onResponse]);

  // Future: Start actual recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Create audio context for visualization
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      // Create media recorder
      mediaRecorderRef.current = new MediaRecorder(stream);
      
      // TODO: Send audio chunks to VM for STT
      mediaRecorderRef.current.ondataavailable = (e) => {
        // Send e.data to VM
      };
      
      mediaRecorderRef.current.start(100); // 100ms chunks
      
      setSession(prev => ({ ...prev, state: 'listening' }));
    } catch (err) {
      setSession(prev => ({
        ...prev,
        state: 'error',
        error: 'Microphone access denied',
      }));
    }
  }, []);

  // Future: Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  return {
    isModalOpen,
    session,
    openVoice,
    closeVoice,
    handleTap,
    // Future methods
    startRecording,
    stopRecording,
  };
}
