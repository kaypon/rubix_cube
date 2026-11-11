// @ts-check
// Leaderboard rules, shared by the API, the timer page and the admin script.
// Plain JS so Vercel runs it without compiling (the leading underscore keeps
// it from becoming a route of its own).

export const BOARD_SIZE = 10;
/** The world record is a little over 3 s. Anything faster is a misfire or a fib. */
export const MIN_MS = 3000;
export const MAX_MS = 60 * 60 * 1000;
export const NAME_MAX = 12;

/**
 * Trimmed, single-spaced name, or null if it's empty, too long, or has
 * characters other than letters, digits, spaces and _ . - ! ? '
 * @param {unknown} raw
 * @returns {string | null}
 */
export function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!name || [...name].length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N} _.\-!?']+$/u.test(name)) return null;
  return name;
}

/** @param {unknown} ms */
export function validMs(ms) {
  return typeof ms === "number" && Number.isInteger(ms) && ms >= MIN_MS && ms <= MAX_MS;
}

/**
 * @typedef {{ rank: number; name: string; ms: number; at: number }} Entry
 */

/**
 * Would this time get onto the board as it stands? Ties go to whoever was first.
 * @param {Entry[]} board sorted fastest first
 * @param {number} ms
 */
export function qualifies(board, ms) {
  return validMs(ms) && (board.length < BOARD_SIZE || ms < board[board.length - 1].ms);
}

// A board entry lives in a Redis sorted set: score = ms, member = this
// string. Members with equal scores sort by the member, so leading with a
// fixed-width timestamp means the earlier of two equal times ranks higher.

/**
 * @param {string} name already cleaned (so it has no "|")
 * @param {number} at epoch ms
 * @param {string} id
 */
export function encodeMember(name, at, id) {
  return `${String(at).padStart(13, "0")}|${id}|${name}`;
}

/**
 * @param {unknown} member
 * @param {unknown} score
 * @param {number} rank 1-based
 * @returns {Entry | null}
 */
export function decodeMember(member, score, rank) {
  if (typeof member !== "string") return null;
  const parts = member.split("|");
  if (parts.length < 3) return null;
  const at = Number(parts[0]);
  const ms = Math.round(Number(score));
  if (!Number.isFinite(at) || !Number.isFinite(ms)) return null;
  return { rank, name: parts.slice(2).join("|"), ms, at };
}

/**
 * Redis ZRANGE ... WITHSCORES replies [member, score, member, score, ...].
 * @param {unknown[]} flat
 * @returns {Entry[]}
 */
export function entriesFromRange(flat) {
  /** @type {Entry[]} */
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const e = decodeMember(flat[i], flat[i + 1], out.length + 1);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Who the per-person post limit applies to. IPv4 is the address itself;
 * IPv6 is its /64, since one connection usually gets a whole /64 and could
 * otherwise hop addresses to dodge the limit.
 * @param {string} ip
 */
export function addressBucket(ip) {
  const v = ip.trim().toLowerCase().replace(/%.*$/, "");
  if (!v.includes(":")) return v || "unknown";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return mapped[1];
  const [head, tail] = v.split("::");
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  const prefix = groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16));
  return `${prefix.join(":")}::/64`;
}

/**
 * Keys live next to one-light-day's in a shared Redis, so everything is
 * prefixed. Only production touches the real board; local runs and
 * previews get their own.
 * @param {string | undefined} vercelEnv
 */
export function keyPrefix(vercelEnv) {
  return vercelEnv === "production" ? "cube:" : "cube-dev:";
}
