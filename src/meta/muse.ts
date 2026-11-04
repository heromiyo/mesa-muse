import type OpenAI from 'openai';
import { config } from '../config.ts';
import { timed } from '../bus.ts';
import { meta } from './client.ts';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Effort = 'minimal' | 'low' | 'medium' | 'high';

/** Muse Spark returning JSON that matches `schema` (schema-guaranteed structured output). */
export async function museJson<T>(opts: {
  task: string; phone?: string; system: string; user: OpenAI.Chat.Completions.ChatCompletionUserMessageParam['content'];
  schemaName: string; schema: Record<string, unknown>; effort?: Effort;
}): Promise<T> {
  return timed({ phone: opts.phone, model: config.meta.muse, task: opts.task }, async () => {
    const res = await meta().chat.completions.create({
      model: config.meta.muse,
      messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
      response_format: { type: 'json_schema', json_schema: { name: opts.schemaName, schema: opts.schema, strict: true } },
      reasoning_effort: opts.effort ?? 'low',
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    return JSON.parse(res.choices[0]?.message?.content ?? '{}') as T;
  }, (out) => ({ output: out }));
}

/** One Muse Spark turn with tools; the caller runs the tool loop. */
export async function museTurn(opts: {
  task: string; phone?: string; messages: Msg[]; tools: OpenAI.Chat.Completions.ChatCompletionTool[]; effort?: Effort;
}) {
  return timed({ phone: opts.phone, model: config.meta.muse, task: opts.task }, async () => {
    const res = await meta().chat.completions.create({
      model: config.meta.muse,
      messages: opts.messages,
      tools: opts.tools,
      reasoning_effort: opts.effort ?? 'low',
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    return res.choices[0]!.message;
  }, (m) => ({
    reply: m.content?.slice(0, 400) ?? null,
    tools: m.tool_calls?.map((c) => ({ name: c.function.name, args: c.function.arguments.slice(0, 300) })) ?? [],
  }));
}

export const imagePart = (dataUrl: string): OpenAI.Chat.Completions.ChatCompletionContentPartImage =>
  ({ type: 'image_url', image_url: { url: dataUrl } });
