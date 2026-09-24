import type { Usage } from "./types.ts";

// Gemini 3.8 Flash, checked 2026-09-24 at ai.google.dev/gemini-api/docs/pricing.
// Promotional token prices double on 2027-01-01 (to $1.50 in / $7.50 out): update then.
// Google Search: 5,000 free searches/month, then $14 per 1,000.
export const PRICE = {
  inputPerMillion: 0.75,
  outputPerMillion: 3.75,
  perSearch: 0.014,
  freeSearchesPerMonth: 5000,
};

// `searchesThisMonth` is the count before this call, so the free allowance is applied correctly
export const estimateCost = (usage: Usage, searchesThisMonth: number) => {
  const freeLeft = Math.max(0, PRICE.freeSearchesPerMonth - searchesThisMonth);
  const paidSearches = Math.max(0, usage.searches - freeLeft);
  return (
    (usage.inputTokens * PRICE.inputPerMillion + usage.outputTokens * PRICE.outputPerMillion) / 1_000_000 +
    paidSearches * PRICE.perSearch
  );
};
