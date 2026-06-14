import { describe, it, expect } from 'vitest';
import type { Span, Trace } from './types.js';
import type { EvalSpan, EvalTrace } from '@eleatic/eval';

/**
 * Compile-time contract guard. This package keeps its OWN `Span`/`Trace` types
 * (so it has no runtime dep on @eleatic/eval), but they MUST stay structurally
 * identical to @eleatic/eval's `EvalSpan`/`EvalTrace`. These mutual-assignability
 * checks are validated by `tsc --noEmit -p tsconfig.test.json` (wired into the
 * `test` script) — if the two shapes drift, the build fails here. Without that
 * tsc pass this would be a no-op, since vitest does not type-check.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const spanConformant: MutuallyAssignable<Span, EvalSpan> = true;
const traceConformant: MutuallyAssignable<Trace, EvalTrace> = true;

// Value-level belt-and-suspenders: each shape satisfies the other.
const asEval = { id: 'x', parentId: null, name: 'n' } satisfies Span satisfies EvalSpan;
const asOwn: Span = { id: 'x', parentId: null, name: 'n' } satisfies EvalSpan;

describe('@eleatic/eval contract conformance', () => {
  it('Span/Trace are structurally identical to EvalSpan/EvalTrace (enforced by tsc)', () => {
    expect(spanConformant).toBe(true);
    expect(traceConformant).toBe(true);
    expect(asEval.id).toBe('x');
    expect(asOwn.id).toBe('x');
  });
});
