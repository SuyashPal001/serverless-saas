import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

export interface NotificationInboxEntry {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  readAt: string | null;
  archived: boolean;
  createdAt: string;
  messageType: string;
  metadata?: Record<string, unknown>;
}

export function useNotificationsSocket(options: {
  tenantSlug: string;
  onNotification: (notification: NotificationInboxEntry) => void;
}): { connected: boolean } {
  const { onNotification } = options;
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isMounted = true;

    const connect = async () => {
      if (!isMounted || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
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
          console.log('WebSocket connected');
          setConnected(true);
          retryCountRef.current = 0;
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ action: 'ping' }));
            }
          }, 5 * 60 * 1000);
        };

        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'notification') {
              const { type, ...notification } = message;
              onNotification(notification as NotificationInboxEntry);
            } else if (message.type === 'pong') {
              // keepalive confirmed
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        socket.onclose = () => {
          if (!isMounted) return;
          console.log('WebSocket disconnected');
          setConnected(false);
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(connect, 3000);
          }
        };

        socket.onerror = (error) => {
          if (!isMounted) return;
          console.error('WebSocket error:', error);
          // onclose will be called, triggering reconnection logic
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
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [onNotification]);

  return { connected };
}
