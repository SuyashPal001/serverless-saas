import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';

/**
 * Foundation Worker Lambda — SQS consumer
 *
 * Uses partial batch failure reporting — failed messages return to queue
 * for retry without blocking successfully processed messages.
 *
 * TODO: implement job router once foundation packages are ready.
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);

      console.log('Worker received job', {
        messageId: record.messageId,
        type: body?.type ?? 'unknown',
        tenantId: body?.tenantId ?? 'unknown',
      });

      // TODO: route to job handler by body.type
    } catch (err) {
      console.error('Worker failed to process message', {
        messageId: record.messageId,
        error: err instanceof Error ? err.message : String(err),
      });

      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
