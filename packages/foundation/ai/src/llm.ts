import { GoogleAuth } from 'google-auth-library';
import { getGcpCredentials } from './gcp-credentials';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_LOCATION = 'us-central1';

export interface GenerateTextParams {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export async function generateTextVertex(params: GenerateTextParams): Promise<string> {
  const credentials = await getGcpCredentials();

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const project = credentials.project_id;
  const location = process.env.GCP_LOCATION ?? DEFAULT_LOCATION;
  const model = params.model ?? DEFAULT_MODEL;
  
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: params.prompt }]
      }
    ],
    system_instruction: params.systemPrompt ? {
      parts: [{ text: params.systemPrompt }]
    } : undefined,
    generation_config: {
      temperature: params.temperature ?? 0,
      maxOutputTokens: params.maxTokens ?? 2048,
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vertex AI generation failed: ${err}`);
  }

  const data = await response.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Vertex AI returned empty response');
  }

  return text;
}
