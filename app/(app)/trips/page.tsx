import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { TripsList } from "./TripsList";

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

  return <TripsList initialTrips={trips ?? []} isAdmin={isAdmin} />;
}
