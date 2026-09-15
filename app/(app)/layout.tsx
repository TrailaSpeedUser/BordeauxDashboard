import Link from "next/link";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { AppNav } from "@/components/AppNav";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const role = user ? await getUserRole(user.id) : null;
  const isAdmin = role === "admin";

  return (
    <>
      <header className="app-header">
        <Link href="/trips" className="brand" style={{ color: "inherit" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Traila_logo_color-400x48.png" alt="Traila" className="logo" />
          <span className="wordmark">SoundTrack</span>
          <span className="beta">Beta</span>
        </Link>

        <AppNav isAdmin={isAdmin} />

        <div className="user">
          <span>{user?.email}</span>
          <form action="/api/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
          <ThemeToggle />
        </div>
      </header>
      {children}
    </>
  );
}
