import type { McpToolCallResponse, McpContent } from './types';

export const textResponse = (text: string): McpToolCallResponse => ({
  content: [{ type: 'text', text }],
});

export const errorResponse = (message: string): McpToolCallResponse => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

export const jsonResponse = (data: unknown): McpToolCallResponse => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

export const multiContentResponse = (contents: McpContent[]): McpToolCallResponse => ({
  content: contents,
});
