-- =====================================================================
-- 0003 — delete_trips() RPC
-- =====================================================================
-- Deleting a trip through the FK cascade times out on large sessions.
-- Two reasons:
--
--   1. The ON DELETE CASCADE on track_metrics.trip_id runs as a per-row
--      trigger: Postgres issues one child DELETE per parent row, and
--      each deleted sample updates the (trip_id, seq) PK, the
--      (trip_id, ts) index, and the WAL. At ~1 Hz a long session is
--      10^5-10^6 rows.
--   2. Supabase caps statement duration per role (a few seconds), and
--      PostgREST gives no way to raise it for a single request.
--
-- This function fixes both: it deletes the children in one set-based
-- statement (no per-row trigger), and carries its own statement_timeout
-- via the function-level SET clause below.
--
-- SECURITY DEFINER is required to raise the timeout and to bypass RLS,
-- so execute is granted to service_role ONLY. The /api/trips/delete
-- route already verifies the caller's admin role before invoking it.
-- =====================================================================

create or replace function public.delete_trips(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  n integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- Children first, set-based. This is the expensive part, and doing it
  -- explicitly avoids the per-row RI_FKey_cascade_del trigger.
  delete from public.track_metrics where trip_id = any(p_ids);

  -- Parent. The cascade now has nothing left to do.
  delete from public.trips where id = any(p_ids);
  get diagnostics n = row_count;

  return n;
end;
$$;

-- Lock it down: a SECURITY DEFINER delete must not be reachable with an
-- anon or plain authenticated key via PostgREST.
revoke all on function public.delete_trips(uuid[]) from public, anon, authenticated;
grant execute on function public.delete_trips(uuid[]) to service_role;
