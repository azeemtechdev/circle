import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { cookies } from 'next/headers';

import { OfflineBanner } from '@/components/ui/offline-banner';
import { Screen, TabBar } from '@/components/ui/tab-bar';
import { ToastProvider } from '@/components/ui/toast';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  // The fallback shows instantly on slow 3G; the real font swaps in.
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Circle',
  description: 'Savings circles (ajo / esusu) that keep their own books.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0F3B2C',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={jakarta.variable}
      data-theme={theme === 'system' ? undefined : theme}
    >
      <body>
        <ToastProvider>
          <div className="shell">
            <OfflineBanner />
            <Screen>{children}</Screen>
            <TabBar />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
