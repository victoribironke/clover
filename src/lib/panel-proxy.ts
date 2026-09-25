// The web panel (web/) runs in the same container as the bot, on an internal port. The bot's
// server is the only public entry point: it answers /telegram, /jobs/* and /health itself and
// passes every other request through to the panel. The bot stays in front because scans hold a
// request open for many minutes, which a proxy inside Next.js would time out.
export const PANEL_PORT = 3000;

const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"];

export const proxyToPanel = async (request: Request, publicProto: "http" | "https") => {
  const incoming = new URL(request.url);
  const publicHost = request.headers.get("host") ?? incoming.host;

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  // Auth.js and Next build redirect and callback URLs from these, so they must be the public ones
  headers.set("host", publicHost);
  headers.set("x-forwarded-host", publicHost);
  headers.set("x-forwarded-proto", publicProto);
  // fetch() would transparently decompress a gzipped reply but keep its content-encoding header,
  // so ask the panel for an uncompressed body instead (Cloud Run's front end compresses anyway)
  headers.set("accept-encoding", "identity");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const response = await fetch(`http://127.0.0.1:${PANEL_PORT}${incoming.pathname}${incoming.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      // redirects (e.g. to Google sign-in) go back to the browser as-is
      redirect: "manual",
    });
    const outgoing = new Headers(response.headers);
    for (const name of HOP_BY_HOP) outgoing.delete(name);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing });
  } catch {
    return new Response("The panel isn't running (it starts a few seconds after the bot).", { status: 502 });
  }
};
