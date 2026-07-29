import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plomari Firewatch Map | Χάρτης Πυροφύλαξης Πλωμαρίου",
  description:
    "A bilingual public situational-awareness map for the Plomari wildfire. Δίγλωσσος δημόσιος χάρτης επιχειρησιακής ενημέρωσης για την πυρκαγιά στο Πλωμάρι.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
