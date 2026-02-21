'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTeamMembers } from '@/hooks/use-api';
import { getHistoricalTrend } from '@/lib/historical-data';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface BarTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function BarTooltip({ active, payload, label }: BarTooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-bg-surface2 border border-border rounded-lg px-3 py-2 text-xs space-y-0.5">
        <p className="text-muted-foreground">{label}</p>
        <p className="text-status-green font-mono font-medium">
          {payload[0].value} avg available
        </p>
      </div>
    );
  }
  return null;
}

export default function WeekAheadPage() {
  const { data: members } = useTeamMembers();
  const trend = getHistoricalTrend(members ?? []);

  // Compute mean for the reference line
  const mean =
    trend.length > 0
      ? Math.round(trend.reduce((s, d) => s + d.avgAvailable, 0) / trend.length * 10) / 10
      : 0;

  return (
    <div className="p-6 pb-20 md:pb-6 space-y-6 max-w-[960px]">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Week Ahead</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Historical availability trend · last 20 weeks
          </p>
        </div>
        <a
          href={`${API_URL}/calendar/team.ics`}
          download="vantage-team.ics"
        >
          <Button variant="outline" size="sm" className="gap-2 text-xs border-border text-muted-foreground hover:text-foreground">
            <Download className="w-3.5 h-3.5" />
            Download Team Calendar
          </Button>
        </a>
      </div>

      {/* Historical trend chart */}
      <div className="p-5 rounded-xl bg-bg-surface border border-border space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              Historical Availability Trend · Last 20 Weeks
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Average available headcount per day across the team — simulated from calendar patterns
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-muted-foreground font-mono">20-week avg</p>
            <p className="text-sm font-mono text-status-green">{mean}</p>
          </div>
        </div>

        <div className="w-full h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={trend}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
              barSize={18}
            >
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.85} />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2235" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fill: '#8b90b8', fontSize: 10, fontFamily: 'var(--font-dm-mono)' }}
                axisLine={false}
                tickLine={false}
                interval={3}
              />
              <YAxis
                tick={{ fill: '#8b90b8', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }}
                axisLine={false}
                tickLine={false}
                domain={[0, 'auto']}
              />
              <Tooltip content={<BarTooltip />} cursor={{ fill: '#1e2235' }} />
              <ReferenceLine
                y={mean}
                stroke="#818cf8"
                strokeDasharray="4 3"
                strokeOpacity={0.4}
                label={{
                  value: `avg ${mean}`,
                  position: 'insideTopRight',
                  fill: '#8b90b8',
                  fontSize: 10,
                  fontFamily: 'var(--font-dm-mono)',
                }}
              />
              <Bar dataKey="avgAvailable" fill="url(#barGradient)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <p className="text-[10px] text-muted-foreground font-mono">
          W-20 = 20 weeks ago · W-1 = last week · Derived from calendar event density per member
        </p>
      </div>

      {/* Info card */}
      <div className="p-4 rounded-xl bg-bg-surface border border-border flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-status-green/10 border border-status-green/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Download className="w-4 h-4 text-status-green" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Team Calendar (ICS)</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Download a unified ICS file containing all team members&apos; schedules. Import it into
            Google Calendar, Outlook, or Apple Calendar to see everyone&apos;s availability in one
            view. The file is generated live from the database and stays in sync.
          </p>
        </div>
      </div>
    </div>
  );
}
