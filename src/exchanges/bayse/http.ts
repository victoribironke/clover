import { createHash, createHmac } from "node:crypto";
import { log } from "@/lib/logger.ts";

export type BayseAuth = "public" | "read" | "write";

export type BayseHttpOptions = {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
};

export class BayseApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`Bayse ${status} on ${path}: ${body.slice(0, 500)}`);
  }
}

// Signing payload per https://docs.bayse.markets/authentication:
// `{timestamp}.{METHOD}.{path}.{sha256hex(body) | ""}`, HMAC-SHA256, base64.
export const signRequest = (
  secretKey: string,
  timestamp: number,
  method: string,
  path: string,
  body: string | null,
) => {
  const bodyHash = body ? createHash("sha256").update(body).digest("hex") : "";
  const payload = `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
  return createHmac("sha256", secretKey).update(payload).digest("base64");
};

const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createBayseHttp = (options: BayseHttpOptions) => {
  const request = async <T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    { auth = "public", query, body }: { auth?: BayseAuth; query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const qs = search.size ? `?${search}` : "";
    const bodyText = body === undefined ? null : JSON.stringify(body);

    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (bodyText) headers["Content-Type"] = "application/json";
      if (auth !== "public") headers["X-Public-Key"] = options.publicKey;
      if (auth === "write") {
        // the signature covers the path only, not the query string
        const timestamp = Math.floor(Date.now() / 1000);
        headers["X-Timestamp"] = String(timestamp);
        headers["X-Signature"] = signRequest(options.secretKey, timestamp, method, path, bodyText);
      }

      const response = await fetch(`${options.baseUrl}${path}${qs}`, {
        method,
        headers,
        body: bodyText ?? undefined,
      });

      const retryable = response.status === 429 || response.status >= 500;
      // never blindly retry a write: an order may have gone through before the error
      if (retryable && auth !== "write" && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 2 ** attempt;
        log.warn("bayse retry", { path, status: response.status, retryAfter });
        await sleep(retryAfter * 1000);
        continue;
      }

      const text = await response.text();
      if (!response.ok) throw new BayseApiError(response.status, text, path);
      return (text ? JSON.parse(text) : {}) as T;
    }
  };

  return { request };
};

export type BayseHttp = ReturnType<typeof createBayseHttp>;
