import { describe, it, expect } from 'vitest';
import { createTracer } from './tracer.js';
import { wrapAnthropic } from './instrument.js';
import type { AnthropicLike } from './types.js';

describe('Tracer', () => {
  it('nests traced() spans (parent/child via async context)', async () => {
    const tracer = createTracer();
    await tracer.traced('workflow', async () => {
      await tracer.traced('step', async () => 'ok', { kind: 'task' });
    });
    const { spans } = await tracer.toTrace();
    const wf = spans.find((s) => s.name === 'workflow');
    const step = spans.find((s) => s.name === 'step');
    expect(wf).toBeDefined();
    expect(step).toBeDefined();
    expect(wf?.parentId).toBeNull();
    expect(step?.parentId).toBe(wf?.id);
  });

  it('parents a wrapped LLM call under the enclosing traced() span', async () => {
    const tracer = createTracer();
    const client: AnthropicLike = {
      messages: { create: async () => ({ model: 'claude-opus-4', usage: { input_tokens: 1, output_tokens: 1 }, content: [] }) },
    };
    const anthropic = wrapAnthropic(client, tracer);
    await tracer.traced('task', async () => {
      await anthropic.messages.create({ model: 'claude-opus-4', messages: [] });
    });
    const { spans } = await tracer.toTrace();
    const task = spans.find((s) => s.name === 'task');
    const llm = spans.find((s) => s.kind === 'llm');
    expect(llm?.parentId).toBe(task?.id);
  });

  it('records input/output/scores on a manual span', async () => {
    const tracer = createTracer();
    await tracer.traced('scorer', async () => 0.9, { kind: 'scorer', input: { a: 1 }, output: { score: 0.9 }, scores: { acc: 0.9 } });
    const s = (await tracer.toTrace()).spans.find((x) => x.kind === 'scorer');
    expect(s?.input).toEqual({ a: 1 });
    expect(s?.output).toEqual({ score: 0.9 });
    expect(s?.scores).toEqual({ acc: 0.9 });
  });

  it('marks status=error and rethrows when fn throws', async () => {
    const tracer = createTracer();
    await expect(
      tracer.traced('boom', async () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    const s = (await tracer.toTrace()).spans.find((x) => x.name === 'boom');
    expect(s?.status).toBe('error');
  });

  it('a per-tracer cost override beats the table', async () => {
    const tracer = createTracer({ cost: () => 0.42 });
    const client: AnthropicLike = {
      messages: { create: async () => ({ model: 'claude-opus-4', usage: { input_tokens: 1, output_tokens: 1 }, content: [] }) },
    };
    const anthropic = wrapAnthropic(client, tracer);
    await anthropic.messages.create({ model: 'claude-opus-4', messages: [] });
    const llm = (await tracer.toTrace()).spans.find((s) => s.kind === 'llm');
    expect(llm?.metrics?.costUsd).toBe(0.42);
  });
});
