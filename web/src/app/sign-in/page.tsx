import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { isAllowedEmail } from "@/settings";

const ERRORS: Record<string, string> = {
  AccessDenied: "That Google account isn't allowed here.",
  Configuration: "Sign-in isn't configured correctly on the server.",
};

const SignInPage = async ({ searchParams }: PageProps<"/sign-in">) => {
  const session = await auth();
  if (isAllowedEmail(session?.user?.email)) redirect("/");

  const { error } = await searchParams;
  const message = typeof error === "string" ? (ERRORS[error] ?? "Sign-in failed. Try again.") : null;

  const signInWithGoogle = async () => {
    "use server";
    await signIn("google", { redirectTo: "/" });
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Clover</h1>
        <p className="mt-1 text-sm text-muted">Admin panel. Sign in with the allowed Google account.</p>
        {message && <p className="mt-4 rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">{message}</p>}
        <form action={signInWithGoogle} className="mt-6">
          <button
            type="submit"
            className="w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
};

export default SignInPage;
