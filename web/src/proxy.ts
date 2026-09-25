// Early redirect to /sign-in for anyone without an allowed session (the `authorized` callback
// in src/auth.ts). Next's docs call proxies an optimistic check only: every panel page also
// verifies the session itself before reading any data.
export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/((?!api/auth|sign-in|_next/static|_next/image|favicon.ico).*)"],
};
