import { museJson, museTurn } from './muse.ts';
import { transcribe } from './voice.ts';
import { cutOut } from './sam.ts';

/**
 * Every Meta model call the app makes goes through this object, so the
 * integration test can swap in scripted models without touching app code.
 */
export const models = { museJson, museTurn, transcribe, cutOut };
