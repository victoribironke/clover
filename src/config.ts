import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const envSchema = z.object({
  BAYSE_PUBLIC_KEY: z.string().min(1),
  BAYSE_SECRET_KEY: z.string().min(1),
  BAYSE_BASE_URL: z.string().url().default("https://relay.bayse.markets"),

  RESEARCH_MODEL: z.string().default("claude-opus-5"),
  TRIAGE_MODEL: z.string().default("claude-opus-5"),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.coerce.number().int(),
  TELEGRAM_MODE: z.enum(["polling", "webhook"]).default("polling"),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8).default("change-me-please"),
  PUBLIC_URL: optionalString,

  RUN_MODE: z.enum(["local", "cloud"]).default("local"),
  PORT: z.coerce.number().int().default(8080),
  CRON_SECRET: z.string().min(8).default("change-me-please"),
  DATABASE_URL: z.string().default("file:clover.db"),
  DATABASE_AUTH_TOKEN: optionalString,

  DRY_RUN: bool.default(true),
  CAPITAL_NGN: z.coerce.number().positive().default(10_000),
  KELLY_FRACTION: z.coerce.number().positive().max(1).default(0.25),
  MAX_BET_FRACTION: z.coerce.number().positive().max(1).default(0.1),
  MIN_EDGE: z.coerce.number().min(0).default(0.05),
  CANCEL_WINDOW_MINUTES: z.coerce.number().min(0).default(30),
  MAX_SLIPPAGE: z.coerce.number().min(0).max(1).default(0.02),

  SCAN_INTERVAL_MINUTES: z.coerce.number().positive().default(120),
  TICK_INTERVAL_MINUTES: z.coerce.number().positive().default(1),
  MAX_DEEP_DIVES_PER_SCAN: z.coerce.number().int().min(0).default(8),
  RESEARCH_COOLDOWN_HOURS: z.coerce.number().min(0).default(24),
  MIN_HOURS_TO_CLOSE: z.coerce.number().min(0).default(2),
  MAX_DAYS_TO_CLOSE: z.coerce.number().positive().default(60),
});

export type Config = z.infer<typeof envSchema>;

const parseConfig = (): Config => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
};

export const config = parseConfig();
