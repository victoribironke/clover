import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "@/settings";

// Google sign-in for a single allowed account. Reads AUTH_SECRET, AUTH_GOOGLE_ID and
// AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: "/sign-in", error: "/sign-in" },
  // Cloud Run sits behind Google's front end; trust its forwarded host for callback URLs
  trustHost: true,
  callbacks: {
    // Google has to vouch for the address, and it has to be on the list
    signIn: ({ profile }) => profile?.email_verified === true && isAllowedEmail(profile.email),
    // used by the proxy for an early redirect; pages check the session again themselves
    authorized: ({ auth }) => isAllowedEmail(auth?.user?.email),
  },
});
