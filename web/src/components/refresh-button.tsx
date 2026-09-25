"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { lagosTime } from "@/lib/format";
import { usePanel } from "./panel-provider";

// The only way (besides reloading the browser) to fetch new data: re-renders the panel layout on
// the server, which loads everything again. The paper/live switch and page filters are kept.
const RefreshButton = () => {
  const router = useRouter();
  const { fetchedAt } = usePanel();
  const [refreshing, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={refreshing}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-60"
      title="Load the latest data"
    >
      <span className={refreshing ? "animate-spin" : ""} aria-hidden>
        ↻
      </span>
      {refreshing ? "Refreshing…" : <span className="text-muted">{lagosTime(fetchedAt)}</span>}
    </button>
  );
};

export default RefreshButton;
