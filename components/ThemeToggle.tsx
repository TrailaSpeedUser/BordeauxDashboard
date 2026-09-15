"use client";

/**
 * Light/dark switch for the app header.
 *
 * Deliberately stateless: the icon shown is chosen by CSS off the
 * `data-theme` attribute rather than React state. That keeps the server
 * and client markup identical (no hydration mismatch) and means the
 * correct icon is painted on first frame, since the inline script in
 * `app/layout.tsx` sets `data-theme` before React ever runs.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("traila-theme", next);
    } catch {
      // Storage can throw in private mode or with cookies blocked. The
      // theme still applies for this page view, it just won't persist.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-toggle"
      // Static label: it describes the control, not the current state,
      // so it stays accurate without re-rendering.
      aria-label="Toggle light or dark theme"
      title="Toggle light or dark theme"
    >
      <span className="icon-when-dark" aria-hidden="true">&#9788;</span>
      <span className="icon-when-light" aria-hidden="true">&#9790;</span>
    </button>
  );
}
