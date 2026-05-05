-- =====================================================================
-- 0002 — add datetime + distance_m to track_metrics
-- =====================================================================
-- The data pipeline now emits two extra columns per sample:
--   datetime    UTC wall-clock time, ISO 8601 string
--   distance_m  cumulative travelled distance (m), trapezoidal integration
--
-- We promote both to typed columns. The dashboard previously computed
-- distance from speed on the fly; it now reads distance_m directly.
-- datetime is new.
-- =====================================================================

alter table public.track_metrics
  add column if not exists datetime    timestamptz,
  add column if not exists distance_m  double precision;

-- No backfill: existing rows from earlier uploads stay null. The
-- dashboard handles a missing distance_m by falling back to the old
-- speed-integrated computation, and a missing datetime by hiding the
-- wall-clock x-axis option.
