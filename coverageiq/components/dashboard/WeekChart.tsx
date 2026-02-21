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
import { weekChartData } from '@/lib/mock-data';

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-bg-surface2 border border-border rounded-lg px-3 py-2 text-xs">
        <p className="text-muted-foreground">{label}</p>
        <p className="text-status-green font-mono font-medium mt-0.5">
          {payload[0].value} available
        </p>
      </div>
    );
  }
  return null;
}

export default function WeekChart() {
  return (
    <div className="w-full h-48">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={weekChartData}
          margin={{ top: 8, right: 16, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="availGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00e5a0" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#00e5a0" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a38" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: '#6b6b80', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#6b6b80', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 24]}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a2a38' }} />
          <Area
            type="monotone"
            dataKey="available"
            stroke="#00e5a0"
            strokeWidth={2}
            fill="url(#availGradient)"
            dot={{ fill: '#00e5a0', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#00e5a0', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
