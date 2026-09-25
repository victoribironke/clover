import { NextRequest } from "next/server";
import { handlers } from "@/auth";

type Handler = (request: NextRequest) => Promise<Response>;

// Next's standalone server reports its own internal address in request.nextUrl (e.g.
// https://localhost:3000), and Auth.js builds the Google redirect_uri from it, so sign-in would
// send Google a localhost address. Rebuild the request on the public host the browser used,
// which the bot's front door (and Cloud Run) pass in x-forwarded-host / host.
const withPublicOrigin =
  (handler: Handler): Handler =>
  (request) => {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (!host) return handler(request);
    const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    const { pathname, search } = request.nextUrl;
    return handler(new NextRequest(`${proto}://${host}${pathname}${search}`, request));
  };

export const GET = withPublicOrigin(handlers.GET);
export const POST = withPublicOrigin(handlers.POST);
