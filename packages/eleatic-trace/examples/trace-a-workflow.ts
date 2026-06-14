/**
 * Runnable with NO API key. A fake LLM client (same shape as `new Anthropic()`)
 * shows wrapping + nested traced() spans + cost capture, then prints the eleatic
 * trace you'd hand to `@eleatic/eval`'s store.recordRow({ trace }).
 *
 *   npm run example
 */
import { createTracer, wrapAnthropic, type AnthropicLike } from '@eleatic/trace';

// Stand-in for `new Anthropic()` — identical surface, canned responses.
const fakeAnthropic: AnthropicLike = {
  messages: {
    create: async (body) => ({
      model: body.model,
      usage: { input_tokens: 820, output_tokens: 90 },
      content: [{ type: 'text', text: 'a drafted answer' }],
    }),
  },
};

const tracer = createTracer();
const anthropic = wrapAnthropic(fakeAnthropic, tracer);

await tracer.traced('workflow', async () => {
  await tracer.traced('draft', () =>
    anthropic.messages.create({ model: 'claude-opus-4', messages: [{ role: 'user', content: 'Answer X' }] }),
  );
  await tracer.traced('critique', () =>
    anthropic.messages.create({ model: 'claude-opus-4', messages: [{ role: 'user', content: 'Critique the draft' }] }),
  );
});

const trace = await tracer.toTrace();
console.log(JSON.stringify(trace, null, 2));
console.log(`\n${trace.spans.length} spans captured. Hand to @eleatic/eval: store.recordRow({ ..., trace })`);
await tracer.shutdown();
