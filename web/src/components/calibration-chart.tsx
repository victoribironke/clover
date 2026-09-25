"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

export type CalibrationPoint = {
  label: string;
  predicted: number;
  actual: number;
  n: number;
};

type CalibrationChartProps = { points: CalibrationPoint[]; xLabel: string };

const percent = (value: number) => `${Math.round(value * 100)}%`;

// Each dot is a bucket: where it sits against the diagonal says whether that probability was
// honest. Above the line = it won more often than predicted (too pessimistic); below = too optimistic.
const CalibrationChart = ({ points, xLabel }: CalibrationChartProps) => {
  const shown = points.filter((point) => point.n > 0);
  if (shown.length === 0)
    return (
      <p className="py-16 text-center text-sm text-muted">
        Not enough settled bets yet.
      </p>
    );
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="var(--border)" />
        <XAxis
          type="number"
          dataKey="predicted"
          domain={[0, 1]}
          tickFormatter={percent}
          stroke="var(--muted)"
          tick={{ fontSize: 12 }}
          label={{
            value: xLabel,
            position: "insideBottom",
            offset: -12,
            fill: "var(--muted)",
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          dataKey="actual"
          domain={[0, 1]}
          tickFormatter={percent}
          stroke="var(--muted)"
          tick={{ fontSize: 12 }}
          width={44}
        />
        <ZAxis type="number" dataKey="n" range={[40, 400]} />
        <ReferenceLine
          segment={[
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ]}
          stroke="var(--muted)"
          strokeDasharray="4 4"
        />
        <Tooltip
          formatter={(value, name) =>
            name === "n" ? String(value) : percent(Number(value))
          }
          labelFormatter={() => ""}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        />
        <Scatter data={shown} fill="var(--accent)" />
      </ScatterChart>
    </ResponsiveContainer>
  );
};

export default CalibrationChart;
