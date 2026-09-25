"use client";

import { usePanel } from "./panel-provider";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  // show the paper/live switch (pages that don't split the two leave it off)
  withMode?: boolean;
};

const PageHeader = ({ title, subtitle, withMode = false }: PageHeaderProps) => {
  const { mode, setMode } = usePanel();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {withMode && (
        <div className="flex rounded-lg border border-border bg-card p-1 text-sm">
          {(["paper", "live"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              className={`rounded-md px-3 py-1 capitalize ${option === mode ? "bg-foreground text-background" : "text-muted"}`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
