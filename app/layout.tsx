import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plomari Firewatch Map | Χάρτης Πυροφύλαξης Πλωμαρίου",
  description:
    "A bilingual public situational-awareness map for the Plomari wildfire. Δίγλωσσος δημόσιος χάρτης επιχειρησιακής ενημέρωσης για την πυρκαγιά στο Πλωμάρι.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Firewatch",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#03070a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://server.arcgisonline.com" />
        <link rel="preconnect" href="https://services.arcgisonline.com" />
        <link rel="dns-prefetch" href="https://server.arcgisonline.com" />
        <link rel="dns-prefetch" href="https://services.arcgisonline.com" />
      </head>
      <body>{children}</body>
    </html>
  );
}
