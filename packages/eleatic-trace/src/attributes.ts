/**
 * Span attribute keys.
 *
 * `gen_ai.*` follow the OpenTelemetry GenAI semantic conventions (still
 * "incubating" in the spec, so we pin the keys here rather than depend on an
 * unstable export). These make our LLM spans legible to ANY OTLP/OTel backend.
 *
 * `eleatic.*` are our own extension attributes for things the GenAI semconv does
 * not (yet) cover — notably derived cost (no standard `gen_ai.usage.cost` key
 * exists; cost is vendor-derived) — plus a node kind and JSON-carried fields for
 * manual (non-LLM) spans. The EleaticSpanExporter reads both families.
 */
export const GENAI = {
  provider: 'gen_ai.provider.name',
  operation: 'gen_ai.operation.name',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  usageInput: 'gen_ai.usage.input_tokens',
  usageOutput: 'gen_ai.usage.output_tokens',
  inputMessages: 'gen_ai.input.messages',
  outputMessages: 'gen_ai.output.messages',
} as const;

export const ELEATIC = {
  kind: 'eleatic.kind',
  cost: 'eleatic.cost.usd',
  inputJson: 'eleatic.input.json',
  outputJson: 'eleatic.output.json',
  scoresJson: 'eleatic.scores.json',
  status: 'eleatic.status',
} as const;
