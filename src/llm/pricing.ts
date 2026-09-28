import type { Usage } from "./types.ts";

// USD per million tokens. Update when settings.searchModel or settings.reasoningModel changes.
// gemini-3.8-flash: checked 2026-09-24 at ai.google.dev/gemini-api/docs/pricing. Promotional
// prices double on 2027-01-01 (to $1.50 in / $7.50 out): update then.
// gpt-6-luna: checked 2026-09-28 at developers.openai.com/api/docs/pricing (input over 272k
// tokens costs more; our prompts are far below that).
export const MODEL_PRICES: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  "gemini-3.8-flash": { inputPerMillion: 0.75, outputPerMillion: 3.75 },
  "gpt-6-luna": { inputPerMillion: 0.1, outputPerMillion: 0.5 },
};

// Google Search via Gemini: 5,000 free searches/month, then $14 per 1,000
export const SEARCH_PRICE = { perSearch: 0.014, freeSearchesPerMonth: 5000 };

// `searchesThisMonth` is the count before this call, so the free allowance is applied correctly
export const estimateCost = (model: string, usage: Usage, searchesThisMonth: number) => {
  const price = MODEL_PRICES[model];
  // a model without a price would make the daily budget useless, so fail loudly
  if (!price) throw new Error(`No price for model ${model}: add it to src/llm/pricing.ts`);
  const freeLeft = Math.max(0, SEARCH_PRICE.freeSearchesPerMonth - searchesThisMonth);
  const paidSearches = Math.max(0, usage.searches - freeLeft);
  return (
    (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) / 1_000_000 +
    paidSearches * SEARCH_PRICE.perSearch
  );
};
