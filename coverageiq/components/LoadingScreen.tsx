'use client';

import { useEffect, useState } from 'react';

export default function LoadingScreen() {
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), 1000);
    const doneTimer = setTimeout(() => setDone(true), 1600);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (done) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        backgroundColor: '#0b0c12',
        animation: exiting ? 'vantage-exit 0.6s cubic-bezier(0.76, 0, 0.24, 1) forwards' : undefined,
        pointerEvents: exiting ? 'none' : 'all',
        willChange: 'transform',
      }}
    >
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          width: '480px',
          height: '480px',
          background: 'radial-gradient(circle, rgba(129, 140, 248, 0.13) 0%, transparent 60%)',
          animation: 'vantage-glow-pulse 2s ease-in-out infinite',
        }}
      />

      <div className="flex flex-col items-center gap-4 relative">
        {/* Logo mark */}
        <div
          className="w-16 h-16 rounded-2xl bg-status-green flex items-center justify-center"
          style={{
            animation: 'vantage-logo-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both',
            boxShadow: '0 0 60px rgba(129, 140, 248, 0.35)',
          }}
        >
          <svg viewBox="0 0 16 16" width="34" height="34" fill="none" aria-hidden="true">
            <path
              d="M5 3L8 13L11 3"
              stroke="#0b0c12"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* App name — overflow hidden makes the slide-up feel like a curtain reveal */}
        <div style={{ overflow: 'hidden', paddingBottom: '3px' }}>
          <h1
            className="font-heading font-bold text-[1.75rem] tracking-wide text-foreground"
            style={{ animation: 'vantage-slide-up 0.35s ease-out 0.48s both' }}
          >
            Vantage
          </h1>
        </div>
      </div>
    </div>
  );
}
