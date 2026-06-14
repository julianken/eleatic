# eleatic

A domain-agnostic, local-first **eval-results explorer**: compare runs, diff rows, drill into individual judgments, filter and sort by any facet, watch metric trends, adjudicate by hand, and walk a full **trace tree + span inspector** — all over a single SQLite file with a framework-free web UI.

![The eleatic trace explorer: a span tree on the left, a per-span inspector on the right.](docs/hero.png)

## Why it's built this way

- **Local-first, single file.** Everything lives in one SQLite database. `eleatic serve --db eval.sqlite`, open a browser — no service to deploy, no account, no cloud.
- **Domain-agnostic.** `output`, `expected`, `scores`, `metadata`, and `trace` are opaque JSON; eleatic never knows *what* you're evaluating. Your domain vocabulary stays in your data and is surfaced by a generic facet engine.
- **Framework-free UI, zero build.** The explorer is vanilla ES modules served as static files — no bundler, no framework, no build step for the front end.
- **Tiny dependency surface.** `better-sqlite3` + `express` + `commander`. That's the whole runtime.
- **Trace as an opaque blob.** Hand it a `{ spans: [...] }` tree from any producer and get a clickable span tree with per-span tokens/cost/latency, a per-trace rollup, and a keyboard-navigable inspector.

## Quick start

```sh
npm install eleatic
```

```ts
import { openStore } from 'eleatic';

const store = openStore('eval.sqlite');

store.recordRun({ id: 'run-1', label: 'gpt-4o vs claude', startedAt: new Date().toISOString() });

store.recordRow({
  runId: 'run-1',
  rowKey: 'item-1',
  output: { keep: true, qualityScore: 90 },
  expected: { keep: true, qualityScore: 88 },
  scores: { agreement: 1, scoreMae: 0.02 },
  metadata: { verdict: 'agree' },
  trace: {
    spans: [
      { id: 'judge', parentId: null, name: 'judge', kind: 'llm',
        input: { prompt: 'Rate this answer…' },
        output: { parsed: { keep: true, qualityScore: 90 } },
        metrics: { promptTokens: 880, completionTokens: 190, costUsd: 0.0002, durationMs: 1502 } },
    ],
  },
});

store.finalizeRun('run-1', { rowCount: 1, metrics: { agreement: 1 } });
store.close();
```

Then explore it:

```sh
npx eleatic serve --db eval.sqlite
# → http://localhost:8788
```

A runnable version is in [`examples/record-and-serve.ts`](examples/record-and-serve.ts).

## What you get

- **Hub** — every run in a union-of-metrics table with inline trend sparklines; select two to compare.
- **Diff** — per-`rowKey` divergence between two runs.
- **Facets** — filter and sort rows by any `scores.*` / `metadata.*` path (`?f=metadata.verdict:eq:disagree`), as a gallery or a table.
- **Drill-down** — a per-row drawer: output vs expected (pretty-printed), score bars, and the trace.
- **Trace explorer** — `/trace` renders the `{ spans }` blob as a parent/child span tree with per-span metrics and a per-trace rollup; click any span for its input/output/metrics. Fully keyboard-navigable (WAI-ARIA tree).
- **Adjudication** — record a human verdict per item; it's staleness-flagged when the underlying output changes.

## Three ways in

All documented by the shipped TypeScript declarations (`dist/*.d.ts`), so an editor — or a coding agent reading `node_modules/eleatic` — gets the contract, not bare signatures:

- **Library** — `openStore` / `makeReader` (typed read + write), plus a pure analysis module (`auc`, `calibratedThreshold`, `ambiguityBand`, `hybridRouting`, …) over a generic `AnalysisRow`, importable without booting the server.
- **CLI** — `eleatic serve --db <file> [--port N] [--config <json>]`.
- **HTTP read API** — `GET /api/runs`, `/api/diff`, `/api/rows?f=<path:op:value>`, `/api/row`, `/api/trends`, `/api/adjudications` (the UI is just a client of these).

## The store

Three tables in one SQLite file — the stable contract any producer writes to:

| Table | Holds |
|---|---|
| `eval_run` | one row per run: id, label, baseline, config, started-at, row-count, aggregate metrics |
| `eval_row` | one row per evaluated item: `output` / `expected` / `scores` / `metadata` / `trace` (all opaque JSON), keyed by `(run_id, row_key)` |
| `eval_adjudication` | one human verdict per item, keyed on `row_key`, staleness-anchored to a content hash |

## Tech stack

| Layer | Choice |
|---|---|
| Store | SQLite via `better-sqlite3` |
| Server | `express` |
| CLI | `commander` |
| UI | framework-free ES modules (no build step) |
| Tests | `vitest` + `supertest` |

## History

eleatic was extracted from a photo-judge evaluation harness, where it replaced a hosted eval backend with a 100%-local store + explorer. Its capabilities — run comparison, row diff, drill-down, faceting, trends, adjudication, trace inspection — are the table stakes the eval / LLM-observability category converged on (W&B Weave, Langfuse, MLflow, Arize Phoenix, Comet, Braintrust); eleatic is the focused, local-first, embeddable take.

## License

MIT
