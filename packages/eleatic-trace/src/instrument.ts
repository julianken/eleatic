import { SpanKind, SpanStatusCode, type Span as OTelSpan } from '@opentelemetry/api';
import type { Tracer } from './tracer.js';
import { GENAI, ELEATIC } from './attributes.js';
import type { AnthropicLike, OpenAILike, GeminiLike } from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- we duck-type arbitrary provider
   responses; the PUBLIC API (wrap*<T>(client: T): T) stays fully typed. */
type AnyFn = (...args: any[]) => any;

interface Usage {
  input?: number | undefined;
  output?: number | undefined;
  model?: string | undefined;
}

interface ProviderCfg {
  provider: string;
  operation: string;
  model(args: any[]): string;
  inputMessages(args: any[]): unknown;
  usageFromResponse(resp: any): Usage;
  outputFromResponse(resp: any): unknown;
  accumulator(): { onChunk(chunk: any): void; usage(): Usage };
}

const isAsyncIterable = (v: any): boolean => v != null && typeof v[Symbol.asyncIterator] === 'function';

const safeJson = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

/** Proxy the method at `path` (e.g. ['messages','create']); pass everything else through unchanged. */
function proxyPath<O extends object>(target: O, path: readonly string[], wrap: (fn: AnyFn, thisArg: unknown) => AnyFn): O {
  const head = path[0];
  const rest = path.slice(1);
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (prop !== head) return value;
      if (rest.length === 0) {
        return typeof value === 'function' ? wrap(value as AnyFn, obj) : value;
      }
      return value != null && typeof value === 'object' ? proxyPath(value as object, rest, wrap) : value;
    },
  });
}

function instrumentCall(tracer: Tracer, cfg: ProviderCfg, orig: AnyFn, thisArg: unknown): AnyFn {
  return (...args: any[]) => {
    const model = cfg.model(args);
    const span = tracer.otel.startSpan(`${cfg.operation} ${model}`, { kind: SpanKind.CLIENT });
    span.setAttribute(GENAI.provider, cfg.provider);
    span.setAttribute(GENAI.operation, cfg.operation);
    span.setAttribute(GENAI.requestModel, model);
    span.setAttribute(ELEATIC.kind, 'llm');
    const input = cfg.inputMessages(args);
    if (input !== undefined) span.setAttribute(GENAI.inputMessages, safeJson(input));

    const finish = (usage: Usage, output: unknown): void => {
      if (usage.model) span.setAttribute(GENAI.responseModel, usage.model);
      if (usage.input != null) span.setAttribute(GENAI.usageInput, usage.input);
      if (usage.output != null) span.setAttribute(GENAI.usageOutput, usage.output);
      if (usage.input != null || usage.output != null) {
        const cost = tracer.costFn(model, usage.input ?? 0, usage.output ?? 0);
        if (cost != null) span.setAttribute(ELEATIC.cost, cost);
      }
      if (output !== undefined) span.setAttribute(GENAI.outputMessages, safeJson(output));
      span.end();
    };
    const fail = (err: unknown): void => {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
      span.setAttribute(ELEATIC.status, 'error');
      span.end();
    };

    let result: unknown;
    try {
      result = orig.apply(thisArg, args);
    } catch (err) {
      fail(err);
      throw err;
    }
    return Promise.resolve(result).then(
      (resp: any) => {
        if (isAsyncIterable(resp)) return wrapStream(resp, cfg, span, finish, fail);
        finish(cfg.usageFromResponse(resp), cfg.outputFromResponse(resp));
        return resp;
      },
      (err: unknown) => {
        fail(err);
        throw err;
      },
    );
  };
}

/** Tee a streamed response through the accumulator; end the span when iteration finishes. */
function wrapStream(
  stream: any,
  cfg: ProviderCfg,
  _span: OTelSpan,
  finish: (u: Usage, o: unknown) => void,
  fail: (e: unknown) => void,
): any {
  const acc = cfg.accumulator();
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    finish(acc.usage(), undefined);
  };
  const iteratorFactory = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator].bind(stream);
  return new Proxy(stream, {
    get(t, p, r) {
      if (p === Symbol.asyncIterator) {
        return function () {
          const it = iteratorFactory();
          return {
            async next() {
              try {
                const res = await it.next();
                if (res.done) end();
                else acc.onChunk(res.value);
                return res;
              } catch (err) {
                if (!ended) {
                  ended = true;
                  fail(err);
                }
                throw err;
              }
            },
            async return(value?: unknown) {
              end();
              return typeof it.return === 'function' ? it.return(value) : { done: true, value };
            },
          };
        };
      }
      return Reflect.get(t, p, r);
    },
  });
}

// ── provider configs ────────────────────────────────────────────────────────

const anthropicCfg: ProviderCfg = {
  provider: 'anthropic',
  operation: 'chat',
  model: (args) => String(args[0]?.model ?? 'unknown'),
  inputMessages: (args) => args[0]?.messages,
  usageFromResponse: (r) => ({ input: r?.usage?.input_tokens, output: r?.usage?.output_tokens, model: r?.model }),
  outputFromResponse: (r) => r?.content,
  accumulator: () => {
    let input: number | undefined;
    let output: number | undefined;
    let model: string | undefined;
    return {
      onChunk(c) {
        if (c?.type === 'message_start') {
          input = c.message?.usage?.input_tokens ?? input;
          output = c.message?.usage?.output_tokens ?? output;
          model = c.message?.model ?? model;
        } else if (c?.type === 'message_delta') {
          output = c.usage?.output_tokens ?? output;
        }
      },
      usage: () => ({ input, output, model }),
    };
  },
};

const openaiCfg: ProviderCfg = {
  provider: 'openai',
  operation: 'chat',
  model: (args) => String(args[0]?.model ?? 'unknown'),
  inputMessages: (args) => args[0]?.messages,
  usageFromResponse: (r) => ({ input: r?.usage?.prompt_tokens, output: r?.usage?.completion_tokens, model: r?.model }),
  outputFromResponse: (r) => r?.choices,
  accumulator: () => {
    let input: number | undefined;
    let output: number | undefined;
    let model: string | undefined;
    return {
      onChunk(c) {
        if (c?.model) model = c.model;
        if (c?.usage) {
          input = c.usage.prompt_tokens ?? input;
          output = c.usage.completion_tokens ?? output;
        }
      },
      usage: () => ({ input, output, model }),
    };
  },
};

const geminiCfg = (): ProviderCfg => ({
  provider: 'gcp.gemini',
  operation: 'generate_content',
  model: (args) => String(args[0]?.model ?? 'unknown'),
  inputMessages: (args) => args[0]?.contents,
  usageFromResponse: (r) => ({
    input: r?.usageMetadata?.promptTokenCount,
    output: r?.usageMetadata?.candidatesTokenCount,
    model: r?.modelVersion,
  }),
  outputFromResponse: (r) => r?.candidates,
  accumulator: () => {
    let input: number | undefined;
    let output: number | undefined;
    let model: string | undefined;
    return {
      onChunk(c) {
        if (c?.modelVersion) model = c.modelVersion;
        if (c?.usageMetadata) {
          input = c.usageMetadata.promptTokenCount ?? input;
          output = c.usageMetadata.candidatesTokenCount ?? output;
        }
      },
      usage: () => ({ input, output, model }),
    };
  },
});

/** Wrap an Anthropic SDK client so every `messages.create` is traced (usage + cost + latency). */
export function wrapAnthropic<T extends AnthropicLike>(client: T, tracer: Tracer): T {
  return proxyPath(client, ['messages', 'create'], (fn, thisArg) => instrumentCall(tracer, anthropicCfg, fn, thisArg)) as T;
}

/** Wrap an OpenAI SDK client so every `chat.completions.create` is traced. For streamed calls pass `stream_options: { include_usage: true }` to capture token usage. */
export function wrapOpenAI<T extends OpenAILike>(client: T, tracer: Tracer): T {
  return proxyPath(client, ['chat', 'completions', 'create'], (fn, thisArg) => instrumentCall(tracer, openaiCfg, fn, thisArg)) as T;
}

/** Wrap a Google GenAI client so `models.generateContent` and `models.generateContentStream` are traced. */
export function wrapGemini<T extends GeminiLike>(client: T, tracer: Tracer): T {
  const withContent = proxyPath(client, ['models', 'generateContent'], (fn, thisArg) =>
    instrumentCall(tracer, geminiCfg(), fn, thisArg),
  );
  return proxyPath(withContent, ['models', 'generateContentStream'], (fn, thisArg) =>
    instrumentCall(tracer, geminiCfg(), fn, thisArg),
  ) as T;
}
