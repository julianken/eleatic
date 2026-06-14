/**
 * Model pricing → derived USD cost. Prices are USD per 1,000,000 tokens,
 * `{ input, output }`. **Prices drift — review periodically** (seeded 2026-06).
 * An unknown model yields `undefined` (cost omitted), NEVER a fabricated 0.
 * Override per-tracer via `createTracer({ cost })` when you need exact/internal rates.
 */
export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Google Gemini
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  // Anthropic Claude
  'claude-opus-4': { input: 15.0, output: 75.0 },
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-haiku-4': { input: 1.0, output: 5.0 },
};

/**
 * Resolve a price for a model id, tolerating version suffixes via longest-prefix
 * match (e.g. `claude-opus-4-8` → `claude-opus-4`, `gpt-4o-2024-08-06` → `gpt-4o`).
 */
export function priceFor(model: string): ModelPrice | undefined {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  const prefix = Object.keys(MODEL_PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? MODEL_PRICES[prefix] : undefined;
}

/** USD cost for a call, or undefined if the model's price is unknown. */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const p = priceFor(model);
  if (!p) return undefined;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
