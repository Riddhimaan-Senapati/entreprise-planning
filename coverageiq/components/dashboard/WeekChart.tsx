'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface WeekChartDataPoint {
  day: string;
  predicted: number;
  low?: number;
  high?: number;
}

interface WeekChartProps {
  data: WeekChartDataPoint[];
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (active && payload && payload.length) {
    const predicted = payload.find((p) => p.name === 'predicted')?.value;
    const low = payload.find((p) => p.name === 'low')?.value;
    const high = payload.find((p) => p.name === 'high')?.value;
    return (
      <div className="bg-bg-surface2 border border-border rounded-lg px-3 py-2 text-xs space-y-0.5">
        <p className="text-muted-foreground">{label}</p>
        <p className="text-status-green font-mono font-medium">~{predicted} available</p>
        {low !== undefined && high !== undefined && (
          <p className="text-muted-foreground font-mono">range {low}–{high}</p>
        )}
      </div>
    );
  }
  return null;
}

export default function WeekChart({ data }: WeekChartProps) {
  return (
    <div className="w-full h-48">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 16, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="predictGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#818cf8" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="bandGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.08} />
              <stop offset="95%" stopColor="#818cf8" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2235" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: '#8b90b8', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#8b90b8', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 'auto']}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#1e2235' }} />
          {/* Confidence band — high */}
          <Area
            type="monotone"
            dataKey="high"
            stroke="none"
            fill="url(#bandGradient)"
            dot={false}
            activeDot={false}
            legendType="none"
          />
          {/* Confidence band — low (masks bottom of band) */}
          <Area
            type="monotone"
            dataKey="low"
            stroke="none"
            fill="#0b0c12"
            dot={false}
            activeDot={false}
            legendType="none"
          />
          {/* Predicted line */}
          <Area
            type="monotone"
            dataKey="predicted"
            stroke="#818cf8"
            strokeWidth={2}
            fill="url(#predictGradient)"
            dot={{ fill: '#818cf8', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#818cf8', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
