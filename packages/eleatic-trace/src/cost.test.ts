import { describe, it, expect } from 'vitest';
import { computeCostUsd, priceFor, MODEL_PRICES } from './cost.js';

describe('cost', () => {
  it('computes USD from the price table', () => {
    const p = MODEL_PRICES['gemini-2.5-flash-lite']!;
    expect(computeCostUsd('gemini-2.5-flash-lite', 1_000_000, 1_000_000)).toBeCloseTo(p.input + p.output, 10);
    expect(computeCostUsd('gemini-2.5-flash-lite', 880, 190)).toBeCloseTo((880 * p.input + 190 * p.output) / 1e6, 12);
  });

  it('longest-prefix matches versioned model ids', () => {
    expect(priceFor('claude-opus-4-8')).toEqual(priceFor('claude-opus-4'));
    expect(priceFor('gpt-4o-2024-08-06')).toEqual(priceFor('gpt-4o'));
  });

  it('returns undefined for unknown models (never a fabricated 0)', () => {
    expect(computeCostUsd('totally-unknown-model', 100, 100)).toBeUndefined();
    expect(priceFor('nope')).toBeUndefined();
  });
});
