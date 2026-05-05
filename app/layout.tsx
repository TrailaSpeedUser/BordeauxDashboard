import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Traila Dashboard — Bordeaux",
  description: "Tram lubrication / noise-source dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
