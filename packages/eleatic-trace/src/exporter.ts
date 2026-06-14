import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { SpanKind, SpanStatusCode, type HrTime } from '@opentelemetry/api';
import type { Span, Trace } from './types.js';
import { GENAI, ELEATIC } from './attributes.js';

const hrToMs = (t: HrTime): number => t[0] * 1e3 + t[1] / 1e6;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Parse a JSON-string attribute back to a value; non-strings → undefined; bad JSON → the raw string. */
const parseJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/** Map one finished OTel span to the eleatic Span shape. Pure; never throws. */
export function toSpan(rs: ReadableSpan): Span {
  const a = rs.attributes;
  const startMs = hrToMs(rs.startTime);
  const durationMs = hrToMs(rs.endTime) - startMs;

  const promptTokens = num(a[GENAI.usageInput]);
  const completionTokens = num(a[GENAI.usageOutput]);
  const costUsd = num(a[ELEATIC.cost]);

  const metrics: NonNullable<Span['metrics']> = { startMs, durationMs };
  if (promptTokens !== undefined) metrics.promptTokens = promptTokens;
  if (completionTokens !== undefined) metrics.completionTokens = completionTokens;
  if (promptTokens !== undefined || completionTokens !== undefined) {
    metrics.totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
  }
  if (costUsd !== undefined) metrics.costUsd = costUsd;

  const input = parseJson(a[GENAI.inputMessages]) ?? parseJson(a[ELEATIC.inputJson]);
  const output = parseJson(a[GENAI.outputMessages]) ?? parseJson(a[ELEATIC.outputJson]);
  const scores = parseJson(a[ELEATIC.scoresJson]);
  const kind = str(a[ELEATIC.kind]) ?? (rs.kind === SpanKind.CLIENT ? 'llm' : undefined);
  const status = str(a[ELEATIC.status]) ?? (rs.status.code === SpanStatusCode.ERROR ? 'error' : undefined);

  const span: Span = {
    id: rs.spanContext().spanId,
    parentId: rs.parentSpanContext?.spanId ?? null,
    name: rs.name,
    metrics,
  };
  if (kind !== undefined) span.kind = kind;
  if (input !== undefined) span.input = input;
  if (output !== undefined) span.output = output;
  if (scores !== undefined && typeof scores === 'object') span.scores = scores as Record<string, number>;
  if (status !== undefined) span.status = status;
  return span;
}

/**
 * A `SpanExporter` that buffers finished spans in memory and maps them to the
 * eleatic `{ spans }` trace shape via `toTrace()`. One tracer = one exporter =
 * one trace's spans (see `createTracer`). The same spans can also be sent to any
 * OTLP backend by registering an OTLP exporter alongside this one.
 */
export class EleaticSpanExporter implements SpanExporter {
  private readonly buffer: ReadableSpan[] = [];

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.buffer.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  /** The collected spans as an eleatic trace (insertion order). */
  toTrace(): Trace {
    return { spans: this.buffer.map(toSpan) };
  }

  reset(): void {
    this.buffer.length = 0;
  }

  async shutdown(): Promise<void> {
    this.buffer.length = 0;
  }

  async forceFlush(): Promise<void> {
    /* spans are buffered synchronously on export; nothing to flush. */
  }
}
