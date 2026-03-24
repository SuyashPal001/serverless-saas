/**
 * Queued Usage Recorder
 *
 * Sends usage metrics to SQS for async processing by the worker Lambda.
 * Use instead of recorder.ts when the relay is on the critical path and
 * DB write latency is a concern.
 *
 * Message format matches what usageRecordingMiddleware sends — the worker's
 * 'usage.record' handler processes both sources identically.
 *
 * Required env var: SQS_PROCESSING_QUEUE_URL
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { UsageReport } from '../runtime/types';
import type { UsageContext, UsageMetric } from './recorder';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

function queueUrl(): string | undefined {
  return process.env.SQS_PROCESSING_QUEUE_URL;
}

async function sendMessage(body: Record<string, unknown>): Promise<void> {
  const url = queueUrl();
  if (!url) {
    console.warn('[UsageRecorder] SQS_PROCESSING_QUEUE_URL not set — skipping queued usage');
    return;
  }
  await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: JSON.stringify(body) }));
}

/**
 * Queue all non-zero metrics from a usage report.
 * Sends one SQS message per metric (matches the worker's single-record format).
 */
export async function queueAgentUsage(
  context: UsageContext,
  usage: UsageReport,
): Promise<void> {
  const { tenantId, agentId } = context;
  const now = new Date().toISOString();

  const message = (metric: string, quantity: number) => ({
    type: 'usage.record',
    tenantId,
    actorId: agentId,
    actorType: 'agent',
    metric,
    quantity,
    recordedAt: now,
  });

  const sends: Promise<void>[] = [];

  if (usage.inputTokens > 0)  sends.push(sendMessage(message('llm_input_tokens',          usage.inputTokens)));
  if (usage.outputTokens > 0) sends.push(sendMessage(message('llm_output_tokens',         usage.outputTokens)));
  if (usage.totalTokens > 0)  sends.push(sendMessage(message('llm_total_tokens',          usage.totalTokens)));
  if (usage.llmCalls > 0)     sends.push(sendMessage(message('llm_calls',                 usage.llmCalls)));
  if (usage.toolCalls > 0)    sends.push(sendMessage(message('tool_calls',                usage.toolCalls)));
  if (usage.durationMs > 0)   sends.push(sendMessage(message('agent_session_duration_ms', usage.durationMs)));

  await Promise.all(sends);
}

/**
 * Queue a single metric.
 */
export async function queueMetric(
  context: UsageContext,
  metric: UsageMetric,
  quantity: number,
): Promise<void> {
  const { tenantId, agentId } = context;
  await sendMessage({
    type: 'usage.record',
    tenantId,
    actorId: agentId,
    actorType: 'agent',
    metric,
    quantity,
    recordedAt: new Date().toISOString(),
  });
}
