import OpenAI from 'openai';
import { config } from '../config.ts';

let client: OpenAI | undefined;

/** One OpenAI SDK client pointed at the Meta Model API. */
export function meta(): OpenAI {
  if (!config.meta.apiKey) throw new Error('MODEL_API_KEY is not set');
  client ??= new OpenAI({ baseURL: config.meta.baseUrl, apiKey: config.meta.apiKey, maxRetries: 2, timeout: 90_000 });
  return client;
}
