'use client';

/**
 * useTaskStream
 *
 * Previously opened its own AWS API Gateway WebSocket
 * connection alongside GlobalTaskStreamProvider. Both
 * connections were registered simultaneously in Redis
 * (API Gateway uses sadd into a Set, not overwrite), so
 * both received every event — causing duplicate cache
 * writes and double toast notifications.
 *
 * Fix: GlobalTaskStreamProvider now handles all event
 * types. This hook is an intentional no-op stub.
 * The call signature is preserved so TaskDetailView.tsx
 * requires no changes.
 */
export function useTaskStream(_taskId: string | undefined): void {
  // All WebSocket handling in GlobalTaskStreamProvider.
}
