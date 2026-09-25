"use client";

import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CurvePoint } from "@/lib/overview";

type BankrollChartProps = { points: CurvePoint[]; capital: number };

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });

// Capital + realized P&L after each settled bet; the dashed line is the starting capital
const BankrollChart = ({ points, capital }: BankrollChartProps) => {
  if (points.length < 2) {
    return <p className="py-16 text-center text-sm text-muted">The curve appears once bets start settling.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="at" tickFormatter={shortDate} tick={{ fontSize: 12 }} stroke="var(--muted)" minTickGap={32} />
        <YAxis
          tickFormatter={(value: number) => naira.format(value)}
          tick={{ fontSize: 12 }}
          stroke="var(--muted)"
          width={84}
          domain={["auto", "auto"]}
        />
        <ReferenceLine y={capital} stroke="var(--muted)" strokeDasharray="4 4" />
        <Tooltip
          formatter={(value) => naira.format(Number(value))}
          labelFormatter={(label) => new Date(String(label)).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}
          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
        />
        <Line type="stepAfter" dataKey="bankroll" name="Bankroll" stroke="var(--accent)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default BankrollChart;
