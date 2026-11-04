import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { deepseek } from '@ai-sdk/deepseek';
import path from 'node:path';

// Control-room browser tests. The app starts on a throwaway database with a sample shop (serve.ts).
export default {
  agents: {
    default: {
      model: deepseek('deepseek-v4-flash'),
      system: 'You are a thorough QA agent testing Mesa Muse, a live control room that mirrors WhatsApp chats, Meta model calls and shops. Verify every outcome on screen.',
      context: 'Three columns: "WhatsApp" (conversation tabs and bubbles), "Meta models at work" (one card per model call: Muse Spark, Muse Voice Transcribe, SAM 3.1) and "Shops" (catalog with kwacha prices and orders).',
    },
  },
  targets: [{
    engine: web(),
    app: {
      url: 'http://127.0.0.1:8797',
      command: { executable: 'node', args: [path.join(import.meta.dirname, 'serve.ts')], env: { PORT: '8797' }, log: '.e2e/logs/app.log' },
    },
  }],
} satisfies E2EConfig;
