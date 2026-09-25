// The service's own public URL, learned from the first request Telegram sends us.
// Cloud Run (request-based billing) only gives an instance CPU while it's handling a request,
// so long work started from Telegram is sent to our own /jobs/* endpoint: that keeps a request
// open, and the CPU on, until the work finishes.
let origin: string | null = null;

export const rememberOrigin = (request: Request) => {
  if (origin) return;
  const host = request.headers.get("host");
  // TLS ends at Cloud Run's front end, so the request itself arrives as plain http
  if (host) origin = `https://${host}`;
};

export const selfOrigin = () => origin;
