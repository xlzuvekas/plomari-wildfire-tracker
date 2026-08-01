import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Firewatch | Global Wildfire Intelligence",
  description:
    "Evidence-aware global wildfire discovery with localized incident context, explicit source coverage, and clear time uncertainty.",
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
