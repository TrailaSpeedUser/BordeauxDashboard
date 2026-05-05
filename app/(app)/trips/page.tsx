import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCurrentUser, getUserRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const supabase = createSupabaseServerClient();
  const { data: trips } = await supabase
    .from("trips")
    .select("id, name, session, recorded_on, duration_s, n_rows, created_at")
    .order("created_at", { ascending: false });

  const user = await getCurrentUser();
  const role = user ? await getUserRole(user.id) : null;
  const isAdmin = role === "admin";

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h1>Trips</h1>
        {isAdmin && (
          <Link href="/upload" className="btn">
            + Upload trip
          </Link>
        )}
      </div>

      {(!trips || trips.length === 0) ? (
        <div className="empty">
          <p>No trips yet.</p>
          {isAdmin && (
            <Link href="/upload" className="btn">
              Upload your first trip
            </Link>
          )}
        </div>
      ) : (
        <div className="trip-grid">
          {trips.map((t) => (
            <Link key={t.id} href={`/trips/${t.id}`} className="trip-card">
              <div className="title">{t.name}</div>
              <div className="meta">
                {t.session && <span>{t.session}</span>}
                {t.recorded_on && <span>{t.recorded_on}</span>}
                {t.duration_s && <span>{(t.duration_s / 60).toFixed(1)} min</span>}
                {t.n_rows && <span>{t.n_rows.toLocaleString("en-US")} samples</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
