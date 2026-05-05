import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { TripDashboard } from "./TripDashboard";

export const dynamic = "force-dynamic";

export default async function TripPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!trip) notFound();

  return <TripDashboard trip={trip} />;
}
