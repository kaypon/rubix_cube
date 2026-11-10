import { parseAlg } from "../cube/notation.ts";

type Reply = { id: number; ok: true; moves: string } | { id: number; ok: false; error: string };

const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, { resolve: (m: string) => void; reject: (e: Error) => void }>();
let nextId = 1;

worker.onmessage = (e: MessageEvent<Reply>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.ok) p.resolve(e.data.moves);
  else p.reject(new Error(e.data.error));
};

function send(facelets?: string): Promise<string> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, facelets });
  });
}

/** Resolves once the solver's tables are built. */
export const solverReady: Promise<void> = send().then(() => undefined);

export async function solve(facelets: string): Promise<string[]> {
  return parseAlg(await send(facelets));
}
