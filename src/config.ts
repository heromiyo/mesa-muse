import { mkdirSync } from 'node:fs';
import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
  dataDir: path.resolve(env.DATA_DIR ?? 'data'),
  meta: {
    apiKey: env.MODEL_API_KEY ?? '',
    baseUrl: env.MODEL_API_BASE ?? 'https://api.meta.ai/v1',
    muse: env.MUSE_MODEL ?? 'muse-spark-1.3',
    sam: env.SAM_MODEL ?? 'sam-3.1',
    voice: env.VOICE_MODEL ?? 'muse-voice-transcribe-1.0',
  },
  wa: {
    token: env.WA_TOKEN ?? '',
    phoneNumberId: env.WA_PHONE_NUMBER_ID ?? '',
    verifyToken: env.WA_VERIFY_TOKEN ?? '',
    appSecret: env.WA_APP_SECRET ?? '',
    displayNumber: (env.WA_DISPLAY_NUMBER ?? '').replace(/\D/g, ''),
    graph: env.WA_GRAPH ?? 'https://graph.facebook.com/v23.0',
  },
};

export const mediaDir = path.join(config.dataDir, 'media');
mkdirSync(mediaDir, { recursive: true });
