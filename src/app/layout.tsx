import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ErrorReporter } from "@/components/ErrorReporter";
import { config } from "@/lib/server/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(config.appUrl),
  title: { default: "Twiins · Your talking 3D avatar", template: "%s · Twiins" },
  description:
    "Turn a selfie and a voice recording into a talking 3D avatar with your look, your voice and your personality. Share one link; anyone can chat with it.",
  openGraph: { siteName: "Twiins", type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#f7f4ef",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <ErrorReporter />
      </body>
    </html>
  );
}
