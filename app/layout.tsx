import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SWRegister from "@/components/SWRegister";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "WorkLog — Attendance",
  description: "Location-based attendance and leave management",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WorkLog",
  },
};

export const viewport: Viewport = {
  themeColor: "#003ec7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-surface text-ink antialiased`}>
        <SWRegister />
        {children}
      </body>
    </html>
  );
}
