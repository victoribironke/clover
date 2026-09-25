import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { isAllowedEmail } from "@/settings";

// Every page under (panel) goes through here. This is the real access check: the proxy only
// redirects early, and no panel data is read unless this passes.
const PanelLayout = async ({ children }: LayoutProps<"/">) => {
  const session = await auth();
  if (!isAllowedEmail(session?.user?.email)) redirect("/sign-in");

  const signOutAction = async () => {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/" className="text-base font-semibold">
              🍀 Clover
            </Link>
            <Link href="/" className="text-muted hover:text-foreground">
              Overview
            </Link>
          </nav>
          <form action={signOutAction} className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{session?.user?.email}</span>
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 hover:bg-background">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
};

export default PanelLayout;
