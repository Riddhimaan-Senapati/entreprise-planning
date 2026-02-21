import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns the stroke color hex for a given confidence score */
export function getConfidenceColor(score: number): string {
  if (score >= 90) return '#00e5a0'; // status-green
  if (score >= 60) return '#f5c842'; // status-yellow
  if (score >= 30) return '#ff8c42'; // status-amber
  return '#ff4d6a';                  // status-red
}

/** Returns a Tailwind text color class for a given confidence score */
export function getConfidenceTextClass(score: number): string {
  if (score >= 90) return 'text-status-green';
  if (score >= 60) return 'text-status-yellow';
  if (score >= 30) return 'text-status-amber';
  return 'text-status-red';
}

/** Returns background color class for priority badges */
export function getPriorityColor(priority: 'P0' | 'P1' | 'P2'): string {
  switch (priority) {
    case 'P0': return 'bg-status-red/20 text-status-red border-status-red/30';
    case 'P1': return 'bg-status-amber/20 text-status-amber border-status-amber/30';
    case 'P2': return 'bg-status-yellow/20 text-status-yellow border-status-yellow/30';
  }
}

/** Computes the SVG stroke-dasharray and stroke-dashoffset for a ring */
export function computeRingDash(score: number, radius: number): { dashArray: number; dashOffset: number } {
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;
  return { dashArray: circumference, dashOffset };
}
