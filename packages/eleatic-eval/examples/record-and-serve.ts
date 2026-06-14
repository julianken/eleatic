/**
 * Runnable example: write a couple of eval runs into a fresh SQLite store,
 * then print the command to explore them.
 *
 *   npm run example
 *   # → writes ./example.sqlite, then:  npx eleatic serve --db example.sqlite
 *
 * Smoke-tested in CI so it can't rot.
 */
import { openStore } from '@eleatic/eval';

const DB = 'example.sqlite';
const store = openStore(DB);

// Two runs of the same task — so the hub's compare + trends have something to show.
for (const [runId, label, keepScore] of [
  ['run-a', 'model-a', 0.82],
  ['run-b', 'model-b', 0.90],
] as const) {
  store.recordRun({ id: runId, label, startedAt: new Date().toISOString() });

  for (let i = 1; i <= 6; i++) {
    const kept = (i + (runId === 'run-b' ? 1 : 0)) % 3 !== 0;
    store.recordRow({
      runId,
      rowKey: `item-${i}`,
      label: `Item ${i}`,
      output: { keep: kept, qualityScore: Math.round(keepScore * 100) - i },
      expected: { keep: i % 4 !== 0, qualityScore: 80 },
      scores: { agreement: kept === (i % 4 !== 0) ? 1 : 0, quality: keepScore },
      metadata: { verdict: kept === (i % 4 !== 0) ? 'agree' : 'disagree' },
      // An opaque trace tree — a root "task" with one "judge" LLM call carrying usage.
      trace: {
        spans: [
          { id: 'task', parentId: null, name: 'task', kind: 'task' },
          {
            id: 'judge',
            parentId: 'task',
            name: 'judge',
            kind: 'llm',
            input: { prompt: `Judge item ${i} for ${label}.`, model: label },
            output: { parsed: { keep: kept, qualityScore: Math.round(keepScore * 100) - i } },
            metrics: { promptTokens: 600 + i, completionTokens: 90 + i, costUsd: 0.0001, durationMs: 800 + i * 10 },
          },
        ],
      },
    });
  }

  store.finalizeRun(runId, { rowCount: 6, metrics: { quality: keepScore } });
}

store.close();
console.log(`Wrote ${DB}. Explore it with:\n\n  npx eleatic serve --db ${DB}\n`);
