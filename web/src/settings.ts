// Tunable settings for the panel. Code, not environment: edit and push. Secrets (AUTH_SECRET,
// AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET) come from the environment.

export const settings = {
  // the only Google accounts allowed in; everyone else is turned away even if Google signs them in
  allowedEmails: ["ibikidsfc56@gmail.com"],
  // used until the bot has published its own settings to Firestore (kv/settings)
  fallbackBotSettings: { dryRun: true, capitalNgn: 10_000, dailyResearchBudgetUsd: 0.25 },
} as const;

export const isAllowedEmail = (email: string | null | undefined) =>
  Boolean(email) && (settings.allowedEmails as readonly string[]).includes(email!.toLowerCase());
