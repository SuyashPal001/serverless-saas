import { GoogleAuth } from 'google-auth-library';
import * as crypto from 'crypto';

const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;
const BATCH_SIZE = 100;

export type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface EmbeddingResult {
  contentHash: string;   // sha256 of the input text
  embedding: number[];
}

export async function embedTexts(
  texts: string[],
  taskType: TaskType
): Promise<EmbeddingResult[]> {
  const saKeyRaw = process.env.GCP_SA_KEY;
  if (!saKeyRaw) throw new Error('GCP_SA_KEY not set');
  const credentials = JSON.parse(saKeyRaw);

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const project = credentials.project_id;
  const location = process.env.GCP_LOCATION ?? 'us-central1';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${EMBEDDING_MODEL}:predict`;

  const results: EmbeddingResult[] = [];

  // Process in batches of 100
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: batch.map(text => ({
          content: text,
          task_type: taskType,
        })),
        parameters: { outputDimensionality: EMBEDDING_DIMENSIONS },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Vertex AI embedding failed: ${err}`);
    }

    const data = await response.json() as {
      predictions: Array<{ embeddings: { values: number[] } }>;
    };

    for (let j = 0; j < batch.length; j++) {
      results.push({
        contentHash: crypto.createHash('sha256').update(batch[j]).digest('hex'),
        embedding: data.predictions[j].embeddings.values,
      });
    }
  }

  return results;
}

export async function embedQuery(query: string): Promise<number[]> {
  const results = await embedTexts([query], 'RETRIEVAL_QUERY');
  return results[0].embedding;
}
