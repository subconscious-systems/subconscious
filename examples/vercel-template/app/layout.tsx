import type { Metadata } from "next";
import { Manrope, Chivo_Mono } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const chivoMono = Chivo_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Subconscious Agent Runner",
  description:
    "Run multi-hop reasoning agents powered by Subconscious TIM",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${manrope.variable} ${chivoMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
