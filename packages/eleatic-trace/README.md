# @eleatic/trace

The producer SDK of the [eleatic](https://github.com/julianken/eleatic) family — **OpenTelemetry-native LLM tracing**. Wrap any LLM client to capture token usage, **cost**, and latency as GenAI-semconv spans, add manual `traced()` spans for the work around the calls, and emit the trace shape [`@eleatic/eval`](../eleatic-eval) renders — or export OTLP to any backend.

## Why it's built this way

- **OpenTelemetry-native.** Spans use the OTel GenAI semantic conventions (`gen_ai.*`), so the same trace flows to `@eleatic/eval` **and** any OTLP backend (Honeycomb, Tempo, Langfuse, …).
- **Type-safe, zero-SDK-dep wrappers.** `wrapAnthropic` / `wrapOpenAI` / `wrapGemini` are generic — `wrap(client)` returns the **same client type** (a transparent proxy, full IntelliSense preserved) — and depend on **no** provider SDK; you bring your own.
- **Cost + streaming, first-class.** Every call records input/output tokens and a derived **USD cost** (override the price table for exact rates). Streamed responses are captured too — usage is read from the stream's final event.
- **Producer-only.** No runtime dependency on `@eleatic/eval`; it emits that package's `{ spans }` shape, and a compile-time conformance test keeps the two identical.

## Quick start

```sh
npm install @eleatic/trace
```

```ts
import { createTracer, wrapAnthropic } from '@eleatic/trace';
import Anthropic from '@anthropic-ai/sdk';
import { openStore } from '@eleatic/eval';

const tracer = createTracer();
const anthropic = wrapAnthropic(new Anthropic(), tracer); // transparent — call it exactly as before

await tracer.traced('workflow', async () => {
  await tracer.traced('draft', () =>
    anthropic.messages.create({ model: 'claude-opus-4-8', max_tokens: 1024, messages: [/* … */] }));
  await tracer.traced('critique', () =>
    anthropic.messages.create({ model: 'claude-opus-4-8', max_tokens: 1024, messages: [/* … */] }));
});

openStore('eval.sqlite').recordRow({ runId, rowKey, output, expected, trace: await tracer.toTrace() });
// explore it:  npx @eleatic/eval serve --db eval.sqlite
```

A key-free, runnable version (fake client) is in [`examples/trace-a-workflow.ts`](examples/trace-a-workflow.ts).

## What's captured

- **LLM spans** (from the wrappers): `gen_ai.*` attributes — provider, operation, request/response model, `gen_ai.usage.input_tokens` / `output_tokens` — plus a derived `eleatic.cost.usd` and latency. Non-streaming and streaming.
- **Manual spans** (from `traced()`): name, kind, input/output, scores, status — nested automatically by call structure.

## Cost

`MODEL_PRICES` seeds common Anthropic / OpenAI / Gemini models (USD per 1M tokens; prices drift — review periodically). An unknown model omits cost (never a fabricated 0). Override per tracer when you need exact/internal rates:

```ts
createTracer({ cost: (model, inputTokens, outputTokens) => myRate(model, inputTokens, outputTokens) });
```

## License

MIT
