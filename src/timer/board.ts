// Talks to /api/scores. Errors come back as messages ready to show.

import type { Entry } from "../../api/_board.js";

export type { Entry };
export type BoardResult = { ok: true; top: Entry[]; rank?: number | null } | { ok: false; error: string };

async function call(init?: RequestInit): Promise<BoardResult> {
  try {
    const res = await fetch("/api/scores", init);
    const data = (await res.json().catch(() => ({}))) as { top?: Entry[]; rank?: number | null; error?: string };
    if (!res.ok || !Array.isArray(data.top)) return { ok: false, error: data.error ?? "Couldn't reach the board." };
    return { ok: true, top: data.top, rank: data.rank };
  } catch {
    return { ok: false, error: "Couldn't reach the board." };
  }
}

export const fetchBoard = () => call();

export const postScore = (name: string, ms: number) =>
  call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ms }) });
