// Look after the leaderboard from your own machine. Reads the Redis keys
// that `vercel env pull` put in .env.local.
//
//   npm run board                   list the real board
//   npm run board -- remove 3       delete entry #3
//   npm run board -- clear --yes    wipe it
//   add --dev to any of these to work on the local/preview board instead

import { Redis } from "@upstash/redis";
import { BOARD_SIZE, entriesFromRange, keyPrefix } from "../api/_board.js";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const [command = "list", arg] = args.filter((a) => !a.startsWith("--"));

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error("No KV_REST_API_URL / KV_REST_API_TOKEN. Run `vercel env pull .env.local --yes` first.");
  process.exit(1);
}
const redis = new Redis({ url, token, enableTelemetry: false });
const key = `${keyPrefix(dev ? undefined : "production")}top`;

const fmt = (ms: number) => (ms / 1000).toFixed(2).padStart(7);

async function list() {
  const flat = (await redis.zrange(key, 0, BOARD_SIZE - 1, { withScores: true })) as unknown[];
  const top = entriesFromRange(flat);
  console.log(`${key} (${top.length})`);
  for (const e of top) console.log(`${String(e.rank).padStart(3)}  ${fmt(e.ms)}s  ${e.name.padEnd(12)}  ${new Date(e.at).toISOString().slice(0, 16)}`);
}

if (command === "list") {
  await list();
} else if (command === "remove") {
  const rank = Number(arg);
  if (!Number.isInteger(rank) || rank < 1) {
    console.error("Usage: npm run board -- remove <rank>");
    process.exit(1);
  }
  const [member] = (await redis.zrange(key, rank - 1, rank - 1)) as string[];
  if (!member) {
    console.error(`No entry #${rank}.`);
    process.exit(1);
  }
  await redis.zrem(key, member);
  console.log(`Removed #${rank}.`);
  await list();
} else if (command === "clear") {
  if (!args.includes("--yes")) {
    console.error(`This deletes every entry on ${key}. Re-run with --yes.`);
    process.exit(1);
  }
  await redis.del(key);
  console.log(`Cleared ${key}.`);
} else {
  console.error(`Unknown command "${command}". Try list, remove <rank>, or clear --yes.`);
  process.exit(1);
}
