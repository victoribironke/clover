import { z } from "zod";

// Secrets only. Tunable values live in src/settings.ts.
const envSchema = z.object({
  BAYSE_PUBLIC_KEY: z.string().min(1),
  BAYSE_SECRET_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.coerce.number().int(),
  // shared secret for the Telegram webhook and the Cloud Scheduler job calls.
  // Telegram only allows A-Z, a-z, 0-9, _ and -, so generate it with `openssl rand -hex 32`.
  APP_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/, "use 16+ characters of A-Z, a-z, 0-9, _ or -"),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Missing or invalid environment variables:\n${issues}`);
  }
  return result.data;
};

export const config = {
  ...parseEnv(),
  // Cloud Run sets K_SERVICE: use the webhook + Cloud Scheduler there, polling + timers locally
  onCloudRun: Boolean(process.env.K_SERVICE),
  port: Number(process.env.PORT) || 8080,
};
