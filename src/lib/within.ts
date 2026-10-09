// The promise's result, or `fallback` if it fails or takes longer than `ms`. For best-effort reads
// in a Telegram reply (e.g. a live wallet balance): a slow exchange shouldn't hold the answer up.
export const within = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise.catch(() => fallback), Bun.sleep(ms).then(() => fallback)]);
