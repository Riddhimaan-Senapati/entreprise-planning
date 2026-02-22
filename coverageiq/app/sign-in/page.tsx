'use client';

import { useSignIn } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Second-factor (Client Trust / MFA) state
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [otp, setOtp] = useState('');

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push('/');
      } else if (result.status === 'needs_second_factor') {
        const emailCodeFactor = result.supportedSecondFactors?.find(
          (f) => f.strategy === 'email_code',
        );
        if (emailCodeFactor) {
          await signIn.prepareSecondFactor({
            strategy: 'email_code',
            emailAddressId: (emailCodeFactor as { emailAddressId: string }).emailAddressId,
          });
        }
        setStep('otp');
      } else {
        setError('Sign-in could not be completed. Please try again.');
      }
    } catch (err: unknown) {
      const clerkError = err as { errors?: { longMessage?: string; message?: string }[] };
      setError(
        clerkError.errors?.[0]?.longMessage ||
        clerkError.errors?.[0]?.message ||
        'Invalid credentials. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading || !signIn) return;
    setLoading(true);
    setError('');
    try {
      const result = await signIn.attemptSecondFactor({ strategy: 'email_code', code: otp });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push('/');
      } else {
        setError('Verification failed. Please try again.');
      }
    } catch (err: unknown) {
      const clerkError = err as { errors?: { longMessage?: string; message?: string }[] };
      setError(
        clerkError.errors?.[0]?.longMessage ||
        clerkError.errors?.[0]?.message ||
        'Invalid code. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base relative overflow-hidden">
      {/* Ambient glow — uses the app's primary accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="w-[560px] h-[560px] rounded-full bg-status-green/5 blur-[120px]" />
      </div>

      {/* Subtle grid texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative z-10 w-full max-w-[380px] mx-auto px-5 py-10 flex flex-col items-center gap-8">
        {/* Logo */}
        <img
          src="/logo_main.png"
          alt="Vantage"
          className="w-full h-auto object-contain"
        />

        {/* Card */}
        <div className="w-full rounded-2xl bg-bg-surface border border-border shadow-[0_8px_40px_rgba(0,0,0,0.4)] overflow-hidden">
          {/* Card header stripe */}
          <div className="h-px bg-gradient-to-r from-transparent via-status-green/30 to-transparent" />

          <div className="p-7">
            {step === 'credentials' ? (
              <>
                <div className="mb-6">
                  <h1 className="text-xl font-heading font-bold text-foreground tracking-tight">
                    Welcome back
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Sign in to your Vantage workspace
                  </p>
                </div>

                <form onSubmit={handleCredentials} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      autoComplete="email"
                      className="w-full px-3.5 py-2.5 rounded-lg text-sm bg-bg-surface2 border border-border text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-status-green/50 focus:ring-1 focus:ring-status-green/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••"
                        required
                        autoComplete="current-password"
                        className="w-full px-3.5 py-2.5 pr-10 rounded-lg text-sm bg-bg-surface2 border border-border text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-status-green/50 focus:ring-1 focus:ring-status-green/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        tabIndex={-1}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-lg px-3 py-2 text-xs text-destructive bg-destructive/8 border border-destructive/20">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !isLoaded}
                    className={cn(
                      'w-full py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 mt-2',
                      'bg-status-green text-bg-base hover:opacity-90 shadow-[0_0_20px_rgba(129,140,248,0.3)]',
                      'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
                    )}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Signing in…
                      </>
                    ) : (
                      'Sign in'
                    )}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <h1 className="text-xl font-heading font-bold text-foreground tracking-tight">
                    Check your email
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    We sent a 6-digit code to{' '}
                    <span className="text-foreground font-medium">{email}</span>
                  </p>
                </div>

                <form onSubmit={handleOtp} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Verification code
                    </label>
                    <input
                      type="text"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      required
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      className="w-full px-3.5 py-2.5 rounded-lg text-sm bg-bg-surface2 border border-border text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-status-green/50 focus:ring-1 focus:ring-status-green/20 tracking-[0.4em] text-center font-mono"
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg px-3 py-2 text-xs text-destructive bg-destructive/8 border border-destructive/20">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || otp.length < 6}
                    className={cn(
                      'w-full py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 mt-2',
                      'bg-status-green text-bg-base hover:opacity-90 shadow-[0_0_20px_rgba(129,140,248,0.3)]',
                      'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
                    )}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Verifying…
                      </>
                    ) : (
                      'Verify & sign in'
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStep('credentials'); setError(''); setOtp(''); }}
                    className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors pt-0.5"
                  >
                    Back to sign in
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/50 font-mono tracking-wide">
          VANTAGE · TEAM COVERAGE INTELLIGENCE
        </p>
      </div>
    </div>
  );
}
