import { context, SpanStatusCode, type Tracer as OTelTracer } from '@opentelemetry/api';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { EleaticSpanExporter } from './exporter.js';
import { computeCostUsd } from './cost.js';
import { ELEATIC } from './attributes.js';
import type { CostFn, TracedOptions, TracerOptions, Trace } from './types.js';

let contextManagerReady = false;
function ensureContextManager(): void {
  if (contextManagerReady) return;
  // Register an AsyncLocalStorage context manager so startActiveSpan nests
  // correctly. This is a no-op if the host app already registered one (e.g. an
  // existing OTel setup) — theirs propagates context just as well.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  contextManagerReady = true;
}

/**
 * A tracer for a single trace. Create one per trace you want to capture (e.g. one
 * per eval row): each instance owns an isolated OTel provider + in-memory
 * exporter, so `toTrace()` returns exactly the spans this tracer recorded.
 */
export class Tracer {
  /** @internal The underlying OTel tracer — used by the client wrappers. */
  readonly otel: OTelTracer;
  /** @internal Resolves cost: per-tracer override first, then the built-in table. */
  readonly costFn: CostFn;
  private readonly provider: BasicTracerProvider;
  private readonly exporter: EleaticSpanExporter;

  constructor(opts: TracerOptions = {}) {
    ensureContextManager();
    this.exporter = new EleaticSpanExporter();
    this.provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(this.exporter)] });
    this.otel = this.provider.getTracer('@eleatic/trace');
    this.costFn = (model, i, o) => opts.cost?.(model, i, o) ?? computeCostUsd(model, i, o);
  }

  /**
   * Run `fn` inside a span. Any `traced()` or wrapped-client call made inside
   * `fn` automatically becomes a child span (nesting via OTel context).
   */
  traced<T>(name: string, fn: () => T | Promise<T>, opts: TracedOptions = {}): Promise<T> {
    return this.otel.startActiveSpan(name, async (span) => {
      span.setAttribute(ELEATIC.kind, opts.kind ?? 'task');
      if (opts.input !== undefined) span.setAttribute(ELEATIC.inputJson, JSON.stringify(opts.input));
      if (opts.scores) span.setAttribute(ELEATIC.scoresJson, JSON.stringify(opts.scores));
      try {
        const out = await fn();
        if (opts.output !== undefined) span.setAttribute(ELEATIC.outputJson, JSON.stringify(opts.output));
        span.end();
        return out;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
        span.setAttribute(ELEATIC.status, 'error');
        span.end();
        throw err;
      }
    });
  }

  /** The spans recorded by this tracer so far, as an eleatic `{ spans }` trace. */
  async toTrace(): Promise<Trace> {
    await this.provider.forceFlush();
    return this.exporter.toTrace();
  }

  async shutdown(): Promise<void> {
    await this.provider.shutdown();
  }
}

export function createTracer(opts?: TracerOptions): Tracer {
  return new Tracer(opts);
}
