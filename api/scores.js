// @ts-check
// GET  /api/scores  the top 10, fastest first
// POST /api/scores  { name, ms }  add a time; the board keeps only the top 10
//
// The timer runs in the browser on a real cube, so nothing here can prove a
// solve happened. What it can do: refuse impossible times, cap posts per
// address and per month (the Redis is a free tier shared with one-light-day),
// and keep names short and plain. `npm run board` removes anything rude.

import { createHash, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { BOARD_SIZE, cleanName, encodeMember, entriesFromRange, keyPrefix, validMs } from "./_board.js";

const PREFIX = keyPrefix(process.env.VERCEL_ENV);
const TOP_KEY = `${PREFIX}top`;
const POSTS_PER_WINDOW = 5;
const WINDOW_SEC = 10 * 60;
const MONTHLY_CAP = 3000;
const MAX_BODY = 512;

/**
 * Runs inside Redis via EVAL (Redis's server-side Lua). The script is a fixed
 * constant; keys and args are built here, never taken from the request.
 * Atomic: per-address limit, monthly cap, add, trim to the top N, rank.
 * Returns the new 0-based rank, -1 throttled, -2 month full, -3 didn't make it.
 */
const POST_SCRIPT = `
local n = redis.call("INCR", KEYS[1])
if n == 1 then redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1])) end
if n > tonumber(ARGV[2]) then return -1 end
local month = redis.call("INCR", KEYS[2])
if month == 1 then redis.call("EXPIRE", KEYS[2], 3456000) end
if month > tonumber(ARGV[3]) then return -2 end
redis.call("ZADD", KEYS[3], tonumber(ARGV[4]), ARGV[5])
redis.call("ZREMRANGEBYRANK", KEYS[3], tonumber(ARGV[6]), -1)
local rank = redis.call("ZRANK", KEYS[3], ARGV[5])
if not rank then return -3 end
return rank
`;

/** @param {string | undefined} token */
function client(token) {
  const url = process.env.KV_REST_API_URL;
  if (!url || !token) return null;
  return new Redis({
    url,
    token,
    enableTelemetry: false,
    retry: { retries: 1, backoff: () => 150 },
    signal: () => AbortSignal.timeout(3000),
  });
}

/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** @param {Redis} redis */
async function readTop(redis) {
  const flat = await redis.zrange(TOP_KEY, 0, BOARD_SIZE - 1, { withScores: true });
  return entriesFromRange(/** @type {unknown[]} */ (flat));
}

async function getBoard() {
  const redis = client(process.env.KV_REST_API_READ_ONLY_TOKEN);
  if (!redis) return json({ error: "The board isn't set up." }, 503);
  try {
    const top = await readTop(redis);
    // A few seconds at the CDN soaks up traffic; posting returns a fresh board anyway.
    return json({ top }, 200, { "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=60" });
  } catch (err) {
    console.error("board read failed", err);
    return json({ error: "Couldn't reach the board." }, 503);
  }
}

/**
 * Browsers send Origin on POST; it must match the host the request came to.
 * @param {Request} request
 */
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** @param {Request} request */
function addressKey(request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  // Hashed so no raw addresses sit in Redis.
  const hash = createHash("sha256").update(`cube-board:${ip}`).digest("hex").slice(0, 24);
  return `${PREFIX}rl:${hash}`;
}

/** @param {Request} request */
async function postScore(request) {
  if (!sameOrigin(request)) return json({ error: "Post from the timer page." }, 403);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "Too much." }, 413);

  /** @type {{ name?: unknown; ms?: unknown }} */
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const name = cleanName(body?.name);
  if (!name) return json({ error: "Name: letters, numbers and spaces, up to 12." }, 400);
  if (!validMs(body?.ms)) return json({ error: "That time doesn't look real." }, 400);
  const ms = /** @type {number} */ (body.ms);

  const redis = client(process.env.KV_REST_API_TOKEN);
  if (!redis) return json({ error: "The board isn't set up." }, 503);

  const now = Date.now();
  const member = encodeMember(name, now, randomBytes(4).toString("hex"));
  const monthKey = `${PREFIX}posts:${new Date(now).toISOString().slice(0, 7)}`;
  try {
    const result = Number(
      await redis.eval(
        POST_SCRIPT,
        [addressKey(request), monthKey, TOP_KEY],
        [String(WINDOW_SEC), String(POSTS_PER_WINDOW), String(MONTHLY_CAP), String(ms), member, String(BOARD_SIZE)],
      ),
    );
    if (result === -1) return json({ error: "Easy. Too many posts, try again in a few minutes." }, 429);
    if (result === -2) return json({ error: "The board's full up for this month." }, 503);
    const top = await readTop(redis);
    return json({ top, rank: result >= 0 ? result + 1 : null });
  } catch (err) {
    console.error("board write failed", err);
    return json({ error: "Couldn't reach the board." }, 503);
  }
}

export default {
  /** @param {Request} request */
  async fetch(request) {
    if (request.method === "GET") return getBoard();
    if (request.method === "POST") return postScore(request);
    return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
  },
};
