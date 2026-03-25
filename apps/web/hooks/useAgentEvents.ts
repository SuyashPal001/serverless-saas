'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import type { AgentEvent, Attachment } from '@/types/agent-events';

export interface UseAgentEventsOptions {
  conversationId: string;
  onThinking?: () => void;
  onMessageDelta?: (delta: string, messageId: string) => void;
  onMessageComplete?: (content: string, messageId: string) => void;
  onToolCalling?: (toolName: string, toolCallId: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, toolCallId: string, result: unknown, error?: string) => void;
  onCanvasUpdate?: (action: string, data: Record<string, unknown>) => void;
  onApprovalRequired?: (approvalId: string, action: string, description: string) => void;
  onError?: (code: string, message: string, recoverable: boolean) => void;
  onSessionEnded?: (reason: string, usage?: Record<string, unknown>) => void;
}

export function useAgentEvents(options: UseAgentEventsOptions) {
  const {
    conversationId,
    onThinking,
    onMessageDelta,
    onMessageComplete,
    onToolCalling,
    onToolResult,
    onCanvasUpdate,
    onApprovalRequired,
    onError,
    onSessionEnded,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const connect = async () => {
      if (!isMounted || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
        return;
      }

      try {
        // Get Cognito access token from non-httpOnly cookie
        const token = document.cookie
          .split('; ')
          .find(row => row.startsWith('platform_access_token='))
          ?.split('=')[1];

        if (!token) {
          console.error('No platform_access_token found in cookies');
          return;
        }

        const wsUrl = process.env.NEXT_PUBLIC_AGENT_WS_URL || "wss://agent-saas.fitnearn.com";

        if (!wsUrl) {
          console.error('NEXT_PUBLIC_AGENT_WS_URL is not defined');
          return;
        }

        // Connect to GCP relay with Cognito access token
        const socket = new WebSocket(`${wsUrl}/ws?token=${token}`);
        wsRef.current = socket;

        socket.onopen = () => {
          if (!isMounted) return;
          console.log('WebSocket connected to GCP relay');
          setIsConnected(true);
          retryCountRef.current = 0;
          
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              // Standard ping for GCP relay
              socket.send(JSON.stringify({ type: 'ping' }));
            }
          }, 5 * 60 * 1000);
        };

        socket.onmessage = (eventMsg) => {
          try {
            const event = JSON.parse(eventMsg.data);

            // Handle OpenClaw relay protocol
            switch (event.type) {
              case 'session.started':
                // Defensive handling as per instructions
                console.log('Relay session started:', event.sessionId);
                sessionIdRef.current = event.sessionId || null;
                break;

              case 'delta':
                // Streaming chunk - relay diffs for us
                // Generate a stable messageId for this stream if we don't have one
                if (!currentMessageIdRef.current) {
                  currentMessageIdRef.current = crypto.randomUUID();
                }
                onMessageDelta?.(event.text, currentMessageIdRef.current);
                break;

              case 'done':
                // Stream complete - clear thinking/loading state
                // Use the captured messageId and clear it for the next message
                if (currentMessageIdRef.current) {
                  // Pass final text if relay sends it, otherwise pass empty string to trigger preservation
                  onMessageComplete?.(event.text || '', currentMessageIdRef.current);
                  currentMessageIdRef.current = null;
                }
                break;

              case 'error':
                // Error from relay
                onError?.('RELAY_ERROR', event.message, false);
                break;

              case 'pong':
                // Keep-alive response
                break;

              default:
                console.warn('Unknown event type from relay:', event.type);
            }
          } catch (err) {
            console.error('[useAgentEvents] Failed to parse message:', err);
          }
        };

        socket.onclose = () => {
          if (!isMounted) return;
          console.log('WebSocket disconnected for agent events');
          setIsConnected(false);
          
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            
            reconnectTimeoutRef.current = setTimeout(async () => {
                // If token is missing, attempt one refresh before trying to reconnect
                const currentToken = document.cookie
                  .split('; ')
                  .find(row => row.startsWith('platform_access_token='))
                  ?.split('=')[1];

                if (!currentToken) {
                    console.log('[useAgentEvents] Token missing on reconnect, triggering refresh...');
                    try {
                        await fetch('/api/auth/refresh', { method: 'POST' });
                    } catch (e) {
                        console.error('[useAgentEvents] Refresh failed on reconnect:', e);
                    }
                }
                
                connect();
            }, 3000);
          }
        };

        socket.onerror = (error) => {
          if (!isMounted) return;
          console.error('WebSocket error:', error);
          socket.close();
        };

      } catch (error) {
        console.error('Failed to fetch WebSocket token:', error);
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [
    onThinking,
    onMessageDelta,
    onMessageComplete,
    onToolCalling,
    onToolResult,
    onCanvasUpdate,
    onApprovalRequired,
    onError,
    onSessionEnded,
  ]);

  const sendMessage = useCallback((text: string, attachments?: Attachment[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Relay expects { message: '...', attachments: [...] }
      wsRef.current.send(JSON.stringify({ 
        message: text,
        attachments 
      }));
      return true;
    }
    console.error('WebSocket is not open. Cannot send message.');
    return false;
  }, []);

  return {
    isConnected,
    sessionId: sessionIdRef.current,
    sendMessage,
  };
}
