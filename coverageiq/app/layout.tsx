import type { Metadata } from 'next';
import { Syne, DM_Sans, DM_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import Sidebar from '@/components/dashboard/Sidebar';
import LoadingScreen from '@/components/LoadingScreen';

const syne = Syne({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-syne',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-dm-sans',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
});

export const metadata: Metadata = {
  title: 'Vantage',
  description: 'Team coverage intelligence — Vantage',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${syne.variable} ${dmSans.variable} ${dmMono.variable} antialiased bg-bg-base text-foreground`}
      >
        <LoadingScreen />
        <TooltipProvider delayDuration={300}>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
          <Toaster
            theme="dark"
            toastOptions={{
              style: {
                background: '#191c2c',
                border: '1px solid #1e2235',
                color: '#e8e8f0',
              },
            }}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}
