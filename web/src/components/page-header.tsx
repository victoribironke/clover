"use client";

import type { Venue } from "@/lib/types";
import { usePanel } from "./panel-provider";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  // show the paper/live switch (pages that don't split the two leave it off)
  withMode?: boolean;
  // show the Bayse/Kalshi switch (pages that only cover Bayse leave it off)
  withVenue?: boolean;
};

const VENUES: { value: Venue; label: string }[] = [
  { value: "bayse", label: "Bayse ₦" },
  { value: "kalshi", label: "Kalshi $" },
];

const Switch = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="flex rounded-lg border border-border bg-card p-1 text-sm">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={`rounded-md px-3 py-1 ${option.value === value ? "bg-foreground text-background" : "text-muted"}`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const PageHeader = ({
  title,
  subtitle,
  withMode = false,
  withVenue = withMode,
}: PageHeaderProps) => {
  const { mode, setMode, venue, setVenue } = usePanel();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {(withVenue || withMode) && (
        <div className="flex flex-wrap gap-2">
          {withVenue && <Switch options={VENUES} value={venue} onChange={setVenue} />}
          {withMode && (
            <Switch
              options={[
                { value: "paper", label: "Paper" },
                { value: "live", label: "Live" },
              ]}
              value={mode}
              onChange={setMode}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
