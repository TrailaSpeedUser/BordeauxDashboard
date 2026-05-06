"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type TripRow = {
  id: string;
  name: string;
  session: string | null;
  recorded_on: string | null;
  duration_s: number | null;
  n_rows: number | null;
  created_at: string;
};

export function TripsList({
  initialTrips,
  isAdmin,
}: {
  initialTrips: TripRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [trips, setTrips] = useState<TripRow[]>(initialTrips);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function performDelete(ids: string[]) {
    setBusy(true);
    setErrMsg("");
    try {
      const res = await fetch("/api/trips/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      // Optimistic local removal so the UI updates immediately
      setTrips((prev) => prev.filter((t) => !ids.includes(t.id)));
      setSelected(new Set());
      // Then a router refresh so the next navigation has the fresh
      // server-side list (and any other tab loads it correctly).
      router.refresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleSingleDelete(t: TripRow, e: React.MouseEvent) {
    // The delete button lives inside an anchor — stop the navigation.
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete trip "${t.name}"?\n\nThis removes all sample data and cannot be undone.`)) {
      return;
    }
    performDelete([t.id]);
  }

  function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} trip${ids.length === 1 ? "" : "s"}?\n\nThis removes all sample data and cannot be undone.`)) {
      return;
    }
    performDelete(ids);
  }

  return (
    <div className="container">
      <div className="trips-header">
        <h1>Trips</h1>
        <div className="trips-header-actions">
          {isAdmin && trips.length > 0 && (
            <>
              {selectMode ? (
                <>
                  <span className="trips-selected-count">
                    {selected.size} selected
                  </span>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      setSelectMode(false);
                      setSelected(new Set());
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={handleBulkDelete}
                    disabled={busy || selected.size === 0}
                  >
                    {busy ? "Deleting…" : `Delete ${selected.size}`}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setSelectMode(true)}
                >
                  Select
                </button>
              )}
            </>
          )}
          {isAdmin && !selectMode && (
            <Link href="/upload" className="btn">
              + Upload trip
            </Link>
          )}
        </div>
      </div>

      {errMsg && <div className="flash error">{errMsg}</div>}

      {trips.length === 0 ? (
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
          {trips.map((t) => {
            const isSelected = selected.has(t.id);
            const cardInner = (
              <>
                {selectMode && (
                  <input
                    type="checkbox"
                    className="trip-card-checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelected(t.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${t.name}`}
                  />
                )}
                <div className="title">{t.name}</div>
                <div className="meta">
                  {t.session && <span>{t.session}</span>}
                  {t.recorded_on && <span>{t.recorded_on}</span>}
                  {t.duration_s && <span>{(t.duration_s / 60).toFixed(1)} min</span>}
                  {t.n_rows && (
                    <span>{t.n_rows.toLocaleString("en-US")} samples</span>
                  )}
                </div>
                {isAdmin && !selectMode && (
                  <button
                    type="button"
                    className="trip-card-delete"
                    onClick={(e) => handleSingleDelete(t, e)}
                    title="Delete trip"
                    aria-label={`Delete ${t.name}`}
                    disabled={busy}
                  >
                    ×
                  </button>
                )}
              </>
            );

            // In select mode, the whole card is a button toggling selection
            // (no navigation). Otherwise it's a Link to the trip detail.
            return selectMode ? (
              <div
                key={t.id}
                className={`trip-card${isSelected ? " trip-card-selected" : ""}`}
                onClick={() => toggleSelected(t.id)}
                role="checkbox"
                aria-checked={isSelected}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggleSelected(t.id);
                  }
                }}
                style={{ cursor: "pointer", position: "relative" }}
              >
                {cardInner}
              </div>
            ) : (
              <Link
                key={t.id}
                href={`/trips/${t.id}`}
                className="trip-card"
                style={{ position: "relative" }}
              >
                {cardInner}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
