import { describe, it, expect } from 'vitest';
import { SpanKind, SpanStatusCode, type Attributes, type HrTime } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { toSpan } from './exporter.js';
import { GENAI, ELEATIC } from './attributes.js';

interface FakeSpan {
  name?: string;
  kind?: SpanKind;
  attributes?: Attributes;
  spanId?: string;
  parentSpanId?: string | undefined;
  startTime?: HrTime;
  endTime?: HrTime;
  statusCode?: SpanStatusCode;
}

/** A minimal ReadableSpan covering exactly what `toSpan` reads. */
function fakeSpan(o: FakeSpan = {}): ReadableSpan {
  const rs = {
    name: o.name ?? 'chat gpt-4o',
    kind: o.kind ?? SpanKind.CLIENT,
    spanContext: () => ({ spanId: o.spanId ?? 's1', traceId: 't1', traceFlags: 1 }),
    parentSpanContext: o.parentSpanId ? { spanId: o.parentSpanId, traceId: 't1', traceFlags: 1 } : undefined,
    startTime: o.startTime ?? ([1000, 0] as HrTime),
    endTime: o.endTime ?? ([1001, 500_000_000] as HrTime), // +1.5s
    attributes: o.attributes ?? {},
    status: { code: o.statusCode ?? SpanStatusCode.UNSET },
  };
  return rs as unknown as ReadableSpan;
}

describe('toSpan', () => {
  it('maps usage + cost + timing + io from gen_ai/eleatic attributes', () => {
    const s = toSpan(
      fakeSpan({
        attributes: {
          [GENAI.usageInput]: 880,
          [GENAI.usageOutput]: 190,
          [ELEATIC.cost]: 0.0002,
          [GENAI.inputMessages]: JSON.stringify([{ role: 'user' }]),
          [GENAI.outputMessages]: JSON.stringify([{ role: 'assistant' }]),
        },
      }),
    );
    expect(s.id).toBe('s1');
    expect(s.parentId).toBeNull();
    expect(s.kind).toBe('llm'); // CLIENT span → llm
    expect(s.metrics).toMatchObject({
      durationMs: 1500,
      promptTokens: 880,
      completionTokens: 190,
      totalTokens: 1070,
      costUsd: 0.0002,
    });
    expect(s.input).toEqual([{ role: 'user' }]);
    expect(s.output).toEqual([{ role: 'assistant' }]);
  });

  it('derives parentId from parentSpanContext', () => {
    expect(toSpan(fakeSpan({ parentSpanId: 'p1' })).parentId).toBe('p1');
  });

  it('maps manual eleatic.* spans (kind/io/scores/status)', () => {
    const s = toSpan(
      fakeSpan({
        kind: SpanKind.INTERNAL,
        statusCode: SpanStatusCode.ERROR,
        attributes: {
          [ELEATIC.kind]: 'scorer',
          [ELEATIC.inputJson]: JSON.stringify({ x: 1 }),
          [ELEATIC.scoresJson]: JSON.stringify({ accuracy: 1 }),
          [ELEATIC.status]: 'error',
        },
      }),
    );
    expect(s.kind).toBe('scorer');
    expect(s.input).toEqual({ x: 1 });
    expect(s.scores).toEqual({ accuracy: 1 });
    expect(s.status).toBe('error');
  });

  it('always emits timing but omits absent token/cost fields', () => {
    const s = toSpan(fakeSpan({ attributes: {} }));
    expect(s.metrics?.startMs).toBeTypeOf('number');
    expect(s.metrics?.durationMs).toBe(1500);
    expect(s.metrics?.promptTokens).toBeUndefined();
    expect(s.metrics?.costUsd).toBeUndefined();
  });
});
