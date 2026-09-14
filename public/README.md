Static assets served at the site root.

`Traila_logo_color-400x48.png` — the company wordmark shown in the app header.
Referenced from `app/(app)/layout.tsx` as `/Traila_logo_color-400x48.png` and
sized by the `.app-header .brand .logo` rule in `app/globals.css`.

If you swap it, keep a transparent background and export at least 2x the
rendered height (the header renders it at 24px, so 48px+) to stay sharp on
high-DPI screens. Update the `src` in the layout to match the new filename.
