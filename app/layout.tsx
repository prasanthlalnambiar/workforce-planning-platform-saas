import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Workforce Planning Platform',
  description: 'Phase 1 SaaS foundation for workforce planning and labour budget governance.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
