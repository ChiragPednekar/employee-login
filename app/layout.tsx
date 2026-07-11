import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import SWRegister from "@/components/SWRegister";

const geist = Geist({ subsets: ["latin"] });

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
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-slate-100 text-slate-900 antialiased`}>
        <SWRegister />
        {children}
      </body>
    </html>
  );
}
