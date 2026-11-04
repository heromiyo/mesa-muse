import { EventEmitter } from 'node:events';
import { db } from './db.ts';

/** Live feed for the control room: every WhatsApp message and every Meta model call. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export type Trace = { phone?: string; model: string; task: string; ms: number; ok: boolean; detail?: Record<string, unknown> };

export function trace(t: Trace) {
  const row = { ...t, detail: t.detail ?? {}, created_at: Date.now() };
  const info = db.prepare('INSERT INTO traces (phone, model, task, ms, ok, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t.phone ?? null, t.model, t.task, Math.round(t.ms), t.ok ? 1 : 0, JSON.stringify(row.detail), row.created_at);
  bus.emit('event', { type: 'trace', id: Number(info.lastInsertRowid), ...row });
}

/** Time a model call and record it, success or failure. */
export async function timed<T>(meta: Omit<Trace, 'ms' | 'ok'>, run: () => Promise<T>, describe?: (out: T) => Record<string, unknown>): Promise<T> {
  const start = performance.now();
  try {
    const out = await run();
    trace({ ...meta, ms: performance.now() - start, ok: true, detail: { ...meta.detail, ...describe?.(out) } });
    return out;
  } catch (err) {
    trace({ ...meta, ms: performance.now() - start, ok: false, detail: { ...meta.detail, error: String((err as Error).message ?? err).slice(0, 300) } });
    throw err;
  }
}
