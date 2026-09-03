-- =====================================================================
-- 0003 — Network aggregation function
-- =====================================================================
-- Powers the /network view by aggregating track_metrics across all
-- trips into spatial cells. Computed on the fly; at production scale
-- (thousands of trips) this should move to a pre-computed cells table
-- populated by an offline pipeline. The frontend's API contract stays
-- the same when that happens.
--
-- band_column is restricted to a whitelist inside the function so the
-- API route's validation is double-checked at the DB level.
-- =====================================================================

create or replace function public.traila_aggregate_cells(
  band_column text,
  cell_decimals int default 4,
  min_samples int default 2,
  max_cells int default 5000
)
returns table (
  lat numeric,
  lon numeric,
  n_samples bigint,
  p95 double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  sql text;
begin
  if band_column not in ('noise_db', 'noise_band_1', 'noise_band_2',
                         'noise_band_3', 'noise_band_4') then
    raise exception 'invalid band_column: %', band_column;
  end if;

  -- format() with %I quotes the identifier (band_column), %s for ints.
  -- The band_column whitelist above prevents injection; %I would prevent
  -- it anyway, but defense-in-depth is cheap.
  sql := format($f$
    select
      round(lat::numeric,  %1$s) as lat,
      round(lon::numeric,  %1$s) as lon,
      count(*)::bigint            as n_samples,
      percentile_cont(0.95) within group (order by %2$I) as p95
    from public.track_metrics
    where lat is not null
      and lon is not null
      and %2$I is not null
    group by round(lat::numeric, %1$s), round(lon::numeric, %1$s)
    having count(*) >= %3$s
    order by p95 desc nulls last
    limit %4$s
  $f$, cell_decimals, band_column, min_samples, max_cells);

  return query execute sql;
end;
$$;

grant execute on function
  public.traila_aggregate_cells(text, int, int, int)
  to authenticated, service_role;
