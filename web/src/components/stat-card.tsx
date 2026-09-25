type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "gain" | "loss" | "neutral";
};

const TONE = { gain: "text-gain", loss: "text-loss", neutral: "" };

const StatCard = ({ label, value, hint, tone = "neutral" }: StatCardProps) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
    <p className={`mt-1 text-2xl font-semibold tabular-nums ${TONE[tone]}`}>{value}</p>
    {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
  </div>
);

export default StatCard;
