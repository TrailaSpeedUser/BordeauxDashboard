"use client";

import { useState } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "uploading"; pct: number }
  | { kind: "ok"; tripId: string }
  | { kind: "err"; message: string };

export function UploadForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [csv, setCsv] = useState<File | null>(null);
  const [meta, setMeta] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!csv || !meta) {
      setStage({ kind: "err", message: "Both files are required." });
      return;
    }
    setStage({ kind: "parsing" });

    let metadata: any;
    try {
      metadata = JSON.parse(await meta.text());
    } catch (err) {
      setStage({ kind: "err", message: "metadata.json is not valid JSON." });
      return;
    }

    let columns: string[] = [];
    let rows: (number | null)[][] = [];

    await new Promise<void>((resolve, reject) => {
      Papa.parse<string[]>(csv, {
        worker: true,
        skipEmptyLines: true,
        complete: (res) => {
          if (!res.data.length) {
            return reject(new Error("Empty CSV."));
          }
          columns = (res.data[0] as unknown as string[]).map((c) => c.trim());
          rows = (res.data.slice(1) as unknown as string[][]).map((row) =>
            row.map((v) => {
              if (v === "" || v === undefined || v === null) return null;
              const n = Number(v);
              return Number.isFinite(n) ? n : null;
            }),
          );
          resolve();
        },
        error: (err) => reject(err),
      });
    }).catch((err) => {
      setStage({ kind: "err", message: `CSV parse failed: ${err.message ?? err}` });
    });

    if (rows.length === 0) return;

    setStage({ kind: "uploading", pct: 0 });

    // Send in chunks because /api routes have a payload limit
    const CHUNK = 4000;
    const totalChunks = Math.ceil(rows.length / CHUNK);

    let tripId: string | null = null;
    for (let i = 0; i < totalChunks; i++) {
      const chunkRows = rows.slice(i * CHUNK, (i + 1) * CHUNK);
      const startSeq = i * CHUNK;
      const isFirst = i === 0;
      const isLast = i === totalChunks - 1;

      const body: Record<string, unknown> = {
        action: isFirst ? "create" : "append",
        tripId,
        name: isFirst ? name : undefined,
        notes: isFirst ? notes : undefined,
        metadata: isFirst ? metadata : undefined,
        columns,
        startSeq,
        rows: chunkRows,
        finalize: isLast,
      };

      const res: Response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        setStage({ kind: "err", message: `Upload failed: ${txt}` });
        return;
      }
      const out: { tripId: string } = await res.json();
      tripId = out.tripId;
      setStage({ kind: "uploading", pct: Math.round(((i + 1) / totalChunks) * 100) });
    }

    if (tripId) {
      setStage({ kind: "ok", tripId });
      router.push(`/trips/${tripId}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 540 }}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 4, color: "var(--muted)" }}>
          Trip name
        </label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bordeaux test #3"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 4, color: "var(--muted)" }}>
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 4, color: "var(--muted)" }}>
          track_metrics.csv
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => setCsv(e.target.files?.[0] ?? null)}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 4, color: "var(--muted)" }}>
          metadata.json
        </label>
        <input
          type="file"
          accept=".json,application/json"
          required
          onChange={(e) => setMeta(e.target.files?.[0] ?? null)}
        />
      </div>

      <button
        type="submit"
        className="btn"
        disabled={stage.kind === "parsing" || stage.kind === "uploading"}
      >
        {stage.kind === "parsing" && "Parsing…"}
        {stage.kind === "uploading" && `Uploading… ${stage.pct}%`}
        {(stage.kind === "idle" || stage.kind === "err" || stage.kind === "ok") &&
          "Upload"}
      </button>

      {stage.kind === "err" && (
        <div className="flash error" style={{ marginTop: 14 }}>
          {stage.message}
        </div>
      )}
      {stage.kind === "ok" && (
        <div className="flash ok" style={{ marginTop: 14 }}>
          Trip uploaded — redirecting…
        </div>
      )}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg2)",
  color: "var(--text)",
};
