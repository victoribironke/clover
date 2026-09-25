import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { PanelProvider } from "@/components/panel-provider";
import RefreshButton from "@/components/refresh-button";
import { loadPanelData } from "@/lib/panel-data";
import { isAllowedEmail } from "@/settings";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/bets", label: "Bets" },
  { href: "/kinds", label: "Market types" },
  { href: "/calibration", label: "Calibration" },
  { href: "/research", label: "Research" },
  { href: "/study", label: "Study" },
];

// Every page under (panel) goes through here. This is the real access check: the proxy only
// redirects early, and no panel data is read unless this passes.
// It also loads all panel data, once: Next keeps layouts across page changes, so this reruns only
// on a browser reload, a sign-in, or the Refresh button (router.refresh).
const PanelLayout = async ({ children }: LayoutProps<"/">) => {
  const session = await auth();
  if (!isAllowedEmail(session?.user?.email)) redirect("/sign-in");
  const data = await loadPanelData();

  const signOutAction = async () => {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  };

  return (
    <PanelProvider data={data}>
      <div className="flex flex-1 flex-col">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <nav className="flex min-w-0 items-center gap-5 overflow-x-auto text-sm">
              <Link href="/" className="shrink-0 text-base font-semibold">
                🍀 Clover
              </Link>
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="shrink-0 text-muted hover:text-foreground">
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-2 text-sm">
              <RefreshButton />
              <form action={signOutAction} className="flex items-center gap-3">
                <span className="hidden text-muted lg:inline">{session?.user?.email}</span>
                <button type="submit" className="rounded-md border border-border px-3 py-1.5 hover:bg-background">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </div>
    </PanelProvider>
  );
};

export default PanelLayout;
