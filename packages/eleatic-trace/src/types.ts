/**
 * The trace shape this package emits — structurally identical to @eleatic/eval's
 * `EvalSpan` / `EvalTrace`. We keep our OWN copy (rather than importing from
 * @eleatic/eval) so a pure trace PRODUCER carries no runtime dependency on the
 * explorer's SQLite/HTTP stack. `conformance.test.ts` is a compile-time guard
 * that asserts these stay bidirectionally assignable to @eleatic/eval's types,
 * so they can never silently drift.
 */
export interface Span {
  /** Stable within the trace; the tree key. */
  id: string;
  /** null = a root; else the id of a sibling span. */
  parentId: string | null;
  /** Node label. */
  name: string;
  /** Free-form, producer-owned: "llm" | "task" | "tool" | "scorer" | … */
  kind?: string;
  /** Opaque; pretty-printed in the explorer. */
  input?: unknown;
  /** Opaque; pretty-printed in the explorer. */
  output?: unknown;
  /** Canonical camelCase metrics. */
  metrics?: {
    startMs?: number;
    durationMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  /** A scorer leaf carries its score(s) here. */
  scores?: Record<string, number>;
  /** Free-form, producer-owned (e.g. "ok" | "error"). */
  status?: string;
}

export interface Trace {
  spans: Span[];
}

/** Override/extend cost computation; return undefined to fall back to the table. */
export type CostFn = (model: string, inputTokens: number, outputTokens: number) => number | undefined;

export interface TracerOptions {
  /** Override the built-in price table for cost (USD). undefined → use the table. */
  cost?: CostFn;
}

export interface TracedOptions {
  /** Span kind tag (default "task"). */
  kind?: string;
  input?: unknown;
  output?: unknown;
  scores?: Record<string, number>;
}

/*
 * Structural ("*-Like") client interfaces — we duck-type only the slice we read,
 * so this package depends on NO provider SDK. The wrappers are generic over the
 * caller's concrete client type `T` and return that same `T` (transparent proxy),
 * preserving full type information / IntelliSense for every other method.
 */

/** The slice of an Anthropic SDK client we instrument. */
export interface AnthropicLike {
  messages: {
    create(body: { model: string; messages?: unknown; stream?: boolean; [k: string]: unknown }, options?: unknown): unknown;
  };
}

/** The slice of an OpenAI SDK client we instrument. */
export interface OpenAILike {
  chat: {
    completions: {
      create(body: { model: string; messages?: unknown; stream?: boolean; [k: string]: unknown }, options?: unknown): unknown;
    };
  };
}

/** The slice of a Google GenAI SDK client we instrument (`ai.models.*`). */
export interface GeminiLike {
  models: {
    generateContent(body: { model: string; [k: string]: unknown }, options?: unknown): unknown;
    generateContentStream(body: { model: string; [k: string]: unknown }, options?: unknown): unknown;
  };
}
