export type Trip = {
  id: string;
  owner_id: string;
  name: string;
  notes: string | null;
  session: string | null;
  recorded_on: string | null;
  ts_start_us: number | null;
  ts_end_us: number | null;
  duration_s: number | null;
  n_rows: number | null;
  metadata: Record<string, any>;
  created_at: string;
};

export type MetricsResponse = {
  columns: string[];
  rows: (number | null)[][];
};
