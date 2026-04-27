'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface TaskStepUpdatedEvent {
  type: 'task.step.updated';
  taskId: string;
  stepId: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  agentOutput?: string;
}

interface TaskStatusChangedEvent {
  type: 'task.status.changed';
  taskId: string;
  status: string;
}

interface TaskStepDeltaEvent {
  type: 'task.step.delta';
  taskId: string;
  stepId: string;
  delta: string;
  text: string;
}

interface TaskStepToolCallEvent {
  type: 'task.step.tool_call';
  taskId: string;
  stepId: string;
  toolName: string;
  toolInput?: string;
}

interface TaskStepToolResultEvent {
  type: 'task.step.tool_result';
  taskId: string;
  stepId: string;
  toolName: string;
  durationMs?: number;
  resultSummary?: string;
}

interface TaskStepThinkingEvent {
  type: 'task.step.thinking';
  taskId: string;
  stepId: string;
}

interface TaskCommentAddedEvent {
  type: 'task.comment.added';
  taskId: string;
  comment: {
    id: string;
    taskId: string;
    authorId: string;
    authorType: 'member' | 'agent';
    authorName: string;
    content: string;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

type TaskWsEvent = TaskStepUpdatedEvent | TaskStatusChangedEvent | TaskCommentAddedEvent | TaskStepDeltaEvent | TaskStepToolCallEvent | TaskStepToolResultEvent | TaskStepThinkingEvent;

export function useTaskStream(taskId: string | undefined) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!taskId) return;
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
          console.error('[useTaskStream] NEXT_PUBLIC_WS_URL is not defined');
          return;
        }

        const socket = new WebSocket(`${wsUrl}?token=${token}`);
        wsRef.current = socket;

        socket.onopen = () => {
          if (!isMounted) return;
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
            const message = JSON.parse(event.data) as (TaskWsEvent | { type: 'pong'; taskId?: string });
            if (message.type === 'pong') return;

            if ('taskId' in message && message.taskId !== taskId) return;

            if (message.type === 'task.step.delta') {
              const ev = message as TaskStepDeltaEvent;
              queryClient.setQueryData(
                ['task', taskId],
                (old: any) => {
                  if (!old?.data?.steps) return old;
                  return {
                    ...old,
                    data: {
                      ...old.data,
                      steps: old.data.steps.map((s: any) =>
                        s.id === ev.stepId
                          ? { ...s, liveText: ev.text }
                          : s
                      ),
                    },
                  };
                }
              );
            } else if (message.type === 'task.step.tool_call') {
              const ev = message as TaskStepToolCallEvent;
              queryClient.setQueryData(
                ['task', taskId],
                (old: any) => {
                  if (!old?.data?.steps) return old;
                  return {
                    ...old,
                    data: {
                      ...old.data,
                      steps: old.data.steps.map((s: any) =>
                        s.id === ev.stepId
                          ? { ...s, liveActivity: [...(s.liveActivity ?? []), { type: 'tool_call', toolName: ev.toolName, toolInput: ev.toolInput, startedAt: Date.now() }] }
                          : s
                      ),
                    },
                  };
                }
              );
            } else if (message.type === 'task.step.tool_result') {
              const ev = message as TaskStepToolResultEvent;
              queryClient.setQueryData(
                ['task', taskId],
                (old: any) => {
                  if (!old?.data?.steps) return old;
                  return {
                    ...old,
                    data: {
                      ...old.data,
                      steps: old.data.steps.map((s: any) => {
                        if (s.id !== ev.stepId) return s;
                        const existing: any[] = s.liveActivity ?? [];
                        // Update the last unresolved tool_call matching this tool name
                        let matched = false;
                        const updated = [...existing].reverse().map((item: any) => {
                          if (!matched && item.type === 'tool_call' && item.toolName === ev.toolName && !item.completed) {
                            matched = true;
                            return { ...item, completed: true, durationMs: ev.durationMs, resultSummary: ev.resultSummary };
                          }
                          return item;
                        }).reverse();
                        return { ...s, liveActivity: updated };
                      }),
                    },
                  };
                }
              );
            } else if (message.type === 'task.step.thinking') {
              const ev = message as TaskStepThinkingEvent;
              queryClient.setQueryData(
                ['task', taskId],
                (old: any) => {
                  if (!old?.data?.steps) return old;
                  return {
                    ...old,
                    data: {
                      ...old.data,
                      steps: old.data.steps.map((s: any) =>
                        s.id === ev.stepId ? { ...s, agentThinking: true } : s
                      ),
                    },
                  };
                }
              );
            } else if (message.type === 'task.step.updated') {
              const ev = message as TaskStepUpdatedEvent;
              queryClient.setQueryData(
                ['task', taskId],
                (old: any) => {
                  if (!old?.data?.steps) return old;
                  return {
                    ...old,
                    data: {
                      ...old.data,
                      steps: old.data.steps.map((s: any) =>
                        s.id === ev.stepId
                          ? {
                              ...s,
                              status: ev.status,
                              ...(ev.agentOutput !== undefined && { agentOutput: ev.agentOutput }),
                              ...(ev.status === 'running' && { startedAt: new Date().toISOString() }),
                              ...(ev.status === 'done' && { completedAt: new Date().toISOString() }),
                            }
                          : s
                      ),
                    },
                  };
                }
              );
            } else if (message.type === 'task.comment.added') {
              const ev = message as TaskCommentAddedEvent;
              queryClient.setQueryData(
                ['task-comments', taskId],
                (old: any) => {
                  const existing: any[] = old?.data ?? [];
                  if (existing.some((c: any) => c.id === ev.comment.id)) return old;
                  return { ...old, data: [...existing, ev.comment] };
                }
              );
            } else if (message.type === 'task.status.changed') {
              const ev = message as TaskStatusChangedEvent;
              queryClient.setQueryData(
                ['task', taskId],
                (old: any) => {
                  if (!old?.data?.task) return old;
                  return {
                    ...old,
                    data: {
                      ...old.data,
                      task: { ...old.data.task, status: ev.status },
                    },
                  };
                }
              );
              // Reflect the new status in the board list cache as well
              queryClient.setQueryData(
                ['tasks'],
                (old: any) => {
                  if (!old?.data) return old;
                  return {
                    ...old,
                    data: old.data.map((t: any) =>
                      t.id === taskId ? { ...t, status: ev.status } : t
                    ),
                  };
                }
              );
            }
          } catch {
            // ignore malformed messages
          }
        };

        socket.onclose = () => {
          if (!isMounted) return;
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(connect, 3000);
          }
        };

        socket.onerror = () => {
          if (!isMounted) return;
          socket.close();
        };
      } catch (error) {
        console.error('[useTaskStream] Connection failed:', error);
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
  }, [taskId, queryClient]);
}
