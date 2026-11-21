import type { AiIdeaReport } from '../src/features/collection/contracts.ts';

// Standard Responses API rates in USD per million tokens, checked 2026-11-20.
// https://developers.openai.com/api/docs/models/gpt-5.4
export function estimateAnalysisCost(model: string, usage: AiIdeaReport['usage']) {
  if (model !== 'gpt-5.4') return undefined;
  const cached = Math.min(usage.input, Math.max(0, usage.cachedInput ?? 0));
  const longContext = usage.input > 272_000;
  return (((usage.input - cached) * 2.5 + cached * 0.25) * (longContext ? 2 : 1)
    + usage.output * 15 * (longContext ? 1.5 : 1)) / 1_000_000;
}
