'use client';

import { useEffect, useState } from 'react';

export default function LoadingScreen() {
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Logo animates in at ~0.1s, text at ~0.4s — give everything time to fully
    // appear before starting the exit slide (1 400ms feels snappy but readable).
    const exitTimer = setTimeout(() => setExiting(true), 800);
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

      <div className="relative">
        <img
          src="/logo_main.png"
          alt="Vantage"
          style={{
            width: '480px',
            height: 'auto',
            animation: 'vantage-logo-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both',
          }}
        />
      </div>
    </div>
  );
}
