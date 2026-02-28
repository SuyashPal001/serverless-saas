import type { IdempotencyStore } from './store';

export interface SQSMessage {
  messageId: string;
  body: string;
  [key: string]: unknown;
}

type WorkerHandler = (message: SQSMessage) => Promise<void>;

export const withIdempotency = (
  store: IdempotencyStore,
  keyExtractor: (message: SQSMessage) => string,
  handler: WorkerHandler,
): WorkerHandler => {
  return async (message) => {
    const key = keyExtractor(message);

    const acquired = await store.acquire(key);
    if (!acquired) {
      console.log(JSON.stringify({ level: 'info', message: 'idempotency_skip', key }));
      return;
    }

    try {
      await handler(message);
      await store.complete(key);
    } catch (error) {
      await store.release(key);
      throw error;
    }
  };
};
