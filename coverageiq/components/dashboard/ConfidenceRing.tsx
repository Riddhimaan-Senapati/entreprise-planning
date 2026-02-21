'use client';

import { useEffect, useRef } from 'react';
import { getConfidenceColor, computeRingDash } from '@/lib/utils';

interface ConfidenceRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  index?: number;
  children?: React.ReactNode;
}

export default function ConfidenceRing({
  score,
  size = 64,
  strokeWidth = 4,
  index = 0,
  children,
}: ConfidenceRingProps) {
  const circleRef = useRef<SVGCircleElement>(null);
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const { dashArray, dashOffset } = computeRingDash(score, radius);
  const color = getConfidenceColor(score);
  const delay = index * 40;

  useEffect(() => {
    const circle = circleRef.current;
    if (!circle) return;

    // Start from full offset (empty ring)
    circle.style.strokeDashoffset = String(dashArray);
    circle.style.transition = 'none';

    const timer = setTimeout(() => {
      circle.style.transition = 'stroke-dashoffset 600ms cubic-bezier(0.4, 0, 0.2, 1)';
      circle.style.strokeDashoffset = String(dashOffset);
    }, delay);

    return () => clearTimeout(timer);
  }, [dashArray, dashOffset, delay]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        {/* Track ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        {/* Progress ring */}
        <circle
          ref={circleRef}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={dashArray}
          strokeDashoffset={dashArray}
        />
      </svg>
      {/* Center content */}
      <div className="relative z-10 flex items-center justify-center w-full h-full">
        {children}
      </div>
    </div>
  );
}
