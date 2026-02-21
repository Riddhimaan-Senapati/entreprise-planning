import { TeamMember } from './types';

type DayKey = keyof TeamMember['weekAvailability'];

const DAY_KEYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const NUM_WEEKS = 20;

/** Mulberry32 seeded PRNG — returns a value in [0, 1) */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string → stable 32-bit integer */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Simulate `NUM_WEEKS` historical weeks and return a Mon–Fri prediction.
 * Each member's weekly score is their current `weekAvailability[day]` ± noise.
 * Returns: { day, predicted, low, high } where predicted = mean headcount,
 * low/high = 10th/90th percentile across the 20 simulated weeks.
 */
export function getWeekPrediction(
  members: TeamMember[]
): { day: string; predicted: number; low: number; high: number }[] {
  return DAY_KEYS.map((key, di) => {
    const weekCounts: number[] = [];

    for (let w = 0; w < NUM_WEEKS; w++) {
      let count = 0;
      for (const member of members) {
        const base = member.weekAvailability[key];
        const rand = seeded(hashStr(member.id) ^ ((w * 37 + di * 13) >>> 0));
        const noise = (rand() - 0.5) * 30; // ±15 points
        const score = Math.max(0, Math.min(100, base + noise));
        if (score >= 50) count++;
      }
      weekCounts.push(count);
    }

    const mean = weekCounts.reduce((a, b) => a + b, 0) / NUM_WEEKS;
    const sorted = [...weekCounts].sort((a, b) => a - b);
    const low = sorted[Math.floor(NUM_WEEKS * 0.1)];
    const high = sorted[Math.floor(NUM_WEEKS * 0.9)];

    return { day: DAY_LABELS[di], predicted: Math.round(mean), low, high };
  });
}

/**
 * Returns 20 weekly average headcount data points for the historical trend chart.
 * x-axis: "W-20" (oldest) … "W-1" (most recent last week)
 */
export function getHistoricalTrend(
  members: TeamMember[]
): { week: string; avgAvailable: number }[] {
  return Array.from({ length: NUM_WEEKS }, (_, w) => {
    let total = 0;
    for (const key of DAY_KEYS) {
      let count = 0;
      for (const member of members) {
        const base = member.weekAvailability[key];
        const rand = seeded(hashStr(member.id) ^ ((w * 37 + DAY_KEYS.indexOf(key) * 13) >>> 0));
        const noise = (rand() - 0.5) * 30;
        const score = Math.max(0, Math.min(100, base + noise));
        if (score >= 50) count++;
      }
      total += count;
    }
    return {
      week: `W-${NUM_WEEKS - w}`,
      avgAvailable: Math.round((total / DAY_KEYS.length) * 10) / 10,
    };
  });
}
