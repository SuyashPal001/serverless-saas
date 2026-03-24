'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import type { AgentEvent } from '@/types/agent-events';

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

  useEffect(() => {
    let isMounted = true;

    const connect = async () => {
      // Avoid connecting if there's no conversationId
      if (!conversationId || !isMounted || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
        return;
      }

      try {
        const response = await api.get<{ token: string }>('/api/v1/auth/ws-token');
        const token = response.token;
        const wsUrl = process.env.NEXT_PUBLIC_WS_URL;

        if (!wsUrl) {
          console.error('NEXT_PUBLIC_WS_URL is not defined');
          return;
        }

        const socket = new WebSocket(`${wsUrl}?token=${token}`);
        wsRef.current = socket;

        socket.onopen = () => {
          if (!isMounted) return;
          console.log('WebSocket connected for agent events');
          setIsConnected(true);
          retryCountRef.current = 0;
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ action: 'ping' }));
            }
          }, 5 * 60 * 1000);
        };

        socket.onmessage = (eventMsg) => {
          try {
            const data = JSON.parse(eventMsg.data);
            if (data.type === 'pong') return;
            if (data.type !== 'agent.event') return;

            const event = data.payload as AgentEvent;

            // Track session
            if (event.type === 'session.started') {
              sessionIdRef.current = event.sessionId;
            }

            // Route to appropriate handler
            switch (event.type) {
              case 'agent.thinking':
                onThinking?.();
                break;
              case 'agent.message.delta':
                onMessageDelta?.(event.delta, event.messageId);
                break;
              case 'agent.message':
                onMessageComplete?.(event.content, event.messageId);
                break;
              case 'tool.calling':
                onToolCalling?.(event.toolName, event.toolCallId, event.arguments);
                break;
              case 'tool.result':
                onToolResult?.(event.toolName, event.toolCallId, event.result, event.error);
                break;
              case 'canvas.update':
                onCanvasUpdate?.(event.action, event.data as Record<string, unknown>);
                break;
              case 'approval.required':
                onApprovalRequired?.(event.approvalId, event.action, event.description);
                break;
              case 'error':
                onError?.(event.code, event.message, event.recoverable);
                break;
              case 'session.ended':
                onSessionEnded?.(event.reason, event.usage as unknown as Record<string, unknown>);
                sessionIdRef.current = null;
                break;
            }
          } catch (err) {
            console.error('[useAgentEvents] Failed to parse message:', err);
          }
        };

        socket.onclose = () => {
          if (!isMounted) return;
          console.log('WebSocket disconnected for agent events');
          setIsConnected(false);
          if (retryCountRef.current < maxRetries && conversationId) {
            retryCountRef.current++;
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(connect, 3000);
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

    if (conversationId) {
      connect();
    }

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
  ]);

  return {
    isConnected,
    sessionId: sessionIdRef.current,
  };
}
