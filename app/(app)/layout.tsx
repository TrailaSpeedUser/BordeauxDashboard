import Link from "next/link";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { AppNav } from "@/components/AppNav";

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
          <span className="dot" />
          <span>Traila — Bordeaux</span>
        </Link>

        <AppNav isAdmin={isAdmin} />

        <div className="user">
          <span>{user?.email}</span>
          <form action="/api/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
