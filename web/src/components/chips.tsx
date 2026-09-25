"use client";

type ChipsProps<T extends string> = {
  options: { value: T; label: string }[];
  current: T;
  onChange: (value: T) => void;
};

// A row of filter buttons; the active one is filled in. Filtering happens on data already loaded.
const Chips = <T extends string>({ options, current, onChange }: ChipsProps<T>) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={`rounded-full border px-3 py-1 text-xs ${
          option.value === current ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:text-foreground"
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export default Chips;
