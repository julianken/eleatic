import { describe, it, expect } from 'vitest';
import { createTracer } from './tracer.js';
import { wrapAnthropic, wrapOpenAI, wrapGemini } from './instrument.js';
import type { AnthropicLike, OpenAILike, GeminiLike } from './types.js';

async function collect(stream: unknown): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const c of stream as AsyncIterable<unknown>) out.push(c);
  return out;
}

describe('wrapAnthropic', () => {
  it('captures usage + cost (non-streaming) and passes the response through', async () => {
    const tracer = createTracer();
    const client: AnthropicLike = {
      messages: {
        create: async () => ({ model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'text', text: 'hi' }] }),
      },
    };
    const wrapped = wrapAnthropic(client, tracer);
    const resp = (await wrapped.messages.create({ model: 'claude-opus-4', messages: [{ role: 'user', content: 'hi' }] })) as { content: unknown };
    expect(resp.content).toEqual([{ type: 'text', text: 'hi' }]); // transparent passthrough
    const llm = (await tracer.toTrace()).spans.find((s) => s.kind === 'llm');
    expect(llm?.name).toBe('chat claude-opus-4');
    expect(llm?.metrics?.promptTokens).toBe(100);
    expect(llm?.metrics?.completionTokens).toBe(20);
    expect(llm?.metrics?.costUsd).toBeCloseTo((100 * 15 + 20 * 75) / 1e6, 12);
  });

  it('captures usage from a streamed response (message_start + message_delta)', async () => {
    const tracer = createTracer();
    async function* gen() {
      yield { type: 'message_start', message: { model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 0 } } };
      yield { type: 'content_block_delta', delta: { text: 'hel' } };
      yield { type: 'message_delta', usage: { output_tokens: 20 } };
    }
    const client: AnthropicLike = { messages: { create: async () => gen() } };
    const wrapped = wrapAnthropic(client, tracer);
    const stream = await wrapped.messages.create({ model: 'claude-opus-4', messages: [], stream: true });
    expect(await collect(stream)).toHaveLength(3);
    const llm = (await tracer.toTrace()).spans.find((s) => s.kind === 'llm');
    expect(llm?.metrics?.promptTokens).toBe(100);
    expect(llm?.metrics?.completionTokens).toBe(20);
    expect(llm?.metrics?.costUsd).toBeGreaterThan(0);
  });

  it('leaves other client methods untouched (transparent proxy)', () => {
    const tracer = createTracer();
    const client = { messages: { create: async () => ({ usage: {} }) }, ping: () => 42 } as AnthropicLike & { ping: () => number };
    const wrapped = wrapAnthropic(client, tracer);
    expect(wrapped.ping()).toBe(42);
  });
});

describe('wrapOpenAI', () => {
  it('captures usage + cost (non-streaming)', async () => {
    const tracer = createTracer();
    const client: OpenAILike = {
      chat: { completions: { create: async () => ({ model: 'gpt-4o', usage: { prompt_tokens: 50, completion_tokens: 10 }, choices: [{ message: { content: 'x' } }] }) } },
    };
    const wrapped = wrapOpenAI(client, tracer);
    await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [] });
    const llm = (await tracer.toTrace()).spans.find((s) => s.kind === 'llm');
    expect(llm?.metrics?.promptTokens).toBe(50);
    expect(llm?.metrics?.completionTokens).toBe(10);
    expect(llm?.metrics?.costUsd).toBeGreaterThan(0);
  });

  it('captures usage from a streamed response (final include_usage chunk)', async () => {
    const tracer = createTracer();
    async function* gen() {
      yield { model: 'gpt-4o', choices: [{ delta: { content: 'x' } }], usage: null };
      yield { model: 'gpt-4o', choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } };
    }
    const client: OpenAILike = { chat: { completions: { create: async () => gen() } } };
    const wrapped = wrapOpenAI(client, tracer);
    await collect(await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [], stream: true }));
    const llm = (await tracer.toTrace()).spans.find((s) => s.kind === 'llm');
    expect(llm?.metrics?.promptTokens).toBe(50);
    expect(llm?.metrics?.completionTokens).toBe(10);
  });
});

describe('wrapGemini', () => {
  it('captures usage + cost from generateContent', async () => {
    const tracer = createTracer();
    const client: GeminiLike = {
      models: {
        generateContent: async () => ({ modelVersion: 'gemini-2.5-flash-lite', usageMetadata: { promptTokenCount: 880, candidatesTokenCount: 190 }, candidates: [{ content: {} }] }),
        generateContentStream: () => Promise.reject(new Error('unused')),
      },
    };
    const wrapped = wrapGemini(client, tracer);
    await wrapped.models.generateContent({ model: 'gemini-2.5-flash-lite', contents: [] });
    const llm = (await tracer.toTrace()).spans.find((s) => s.kind === 'llm');
    expect(llm?.name).toBe('generate_content gemini-2.5-flash-lite');
    expect(llm?.metrics?.promptTokens).toBe(880);
    expect(llm?.metrics?.completionTokens).toBe(190);
    expect(llm?.metrics?.costUsd).toBeGreaterThan(0);
  });

  it('captures usage from generateContentStream (final chunk usageMetadata)', async () => {
    const tracer = createTracer();
    async function* gen() {
      yield { modelVersion: 'gemini-2.5-flash-lite', candidates: [{ content: {} }] };
      yield { modelVersion: 'gemini-2.5-flash-lite', usageMetadata: { promptTokenCount: 880, candidatesTokenCount: 190 } };
    }
    const client: GeminiLike = {
      models: { generateContent: async () => ({}), generateContentStream: async () => gen() },
    };
    const wrapped = wrapGemini(client, tracer);
    await collect(await wrapped.models.generateContentStream({ model: 'gemini-2.5-flash-lite', contents: [] }));
    const llm = (await tracer.toTrace()).spans.find((s) => s.kind === 'llm');
    expect(llm?.metrics?.promptTokens).toBe(880);
    expect(llm?.metrics?.completionTokens).toBe(190);
  });
});
