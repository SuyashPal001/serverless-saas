/**
 * Provider router — selects the right adapter based on the requested model.
 *
 * Routing rules (first match wins):
 *   claude-*    → AnthropicAdapter  (stub)
 *   gemini-*    → VertexAdapter
 *   (default)   → VertexAdapter
 *
 * To add Ollama: add an OllamaAdapter and match on e.g. "ollama/*".
 */

import type { ProviderAdapter } from './adapters/base';
import { VertexAdapter } from './adapters/vertex';
import { AnthropicAdapter } from './adapters/anthropic';

const vertexAdapter = new VertexAdapter();
const anthropicAdapter = new AnthropicAdapter();

export function getAdapter(model: string | undefined): ProviderAdapter {
  const m = model ?? '';

  if (m.startsWith('claude')) {
    return anthropicAdapter;
  }

  // Default: Vertex / Gemini
  return vertexAdapter;
}
