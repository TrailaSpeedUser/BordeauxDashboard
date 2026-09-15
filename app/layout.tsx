import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Traila SoundTrack (Beta)",
  description: "Tram lubrication / noise-source dashboard",
};

// Runs before first paint so the stored theme is already on <html> when
// the page renders — without it the dark default paints first and the
// page visibly flips to light. Falls back to the OS preference on a
// first visit. Kept inline and minified on purpose: an external file
// would be fetched too late to prevent the flash.
const NO_FLASH_THEME = `(function(){try{var t=localStorage.getItem('traila-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the script above sets data-theme on this
    // element before React hydrates, which would otherwise be reported
    // as a server/client attribute mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
