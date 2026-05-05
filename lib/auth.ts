import { createSupabaseServerClient } from "./supabase-server";

/** Returns the current authenticated user, or null. */
export async function getCurrentUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Returns the role for a given user id, or null if no profile exists. */
export async function getUserRole(userId: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return data?.role ?? null;
}

/** Convenience: is the current user an admin? */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const role = await getUserRole(user.id);
  return role === "admin";
}
