import { DurableObject } from "cloudflare:workers";

// Per-IP sliding-window rate limiter (auth.md Part A4). One Durable Object
// instance per client IP; its single-threaded execution makes the
// check-and-increment atomic, so callers can never race past the limit.
//
// A true sliding window ("N in any rolling WINDOW") — not a fixed clock window,
// which would let someone do 2×N by straddling the boundary.
const WINDOW_MS = 24 * 60 * 60 * 1000; // rolling 24 hours
export const RATE_LIMIT = 30; // requests per IP per window

export type RateLimitResult = {
	allowed: boolean;
	remaining: number;
	limit: number;
	retryAfter: number; // seconds until the window frees up (0 when allowed)
};

export class RateLimiter extends DurableObject {
	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS requests (timestamp INTEGER NOT NULL)");
			this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_ts ON requests (timestamp)");
		});
	}

	consume(): RateLimitResult {
		const now = Date.now();
		const sql = this.ctx.storage.sql;

		// Prune entries that have aged out of the window, then count what remains.
		sql.exec("DELETE FROM requests WHERE timestamp <= ?", now - WINDOW_MS);
		const count = sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM requests").one().count;

		if (count >= RATE_LIMIT) {
			const oldest = sql.exec<{ oldest: number | null }>("SELECT MIN(timestamp) AS oldest FROM requests").one().oldest ?? now;
			const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
			return { allowed: false, remaining: 0, limit: RATE_LIMIT, retryAfter };
		}

		sql.exec("INSERT INTO requests (timestamp) VALUES (?)", now);
		return { allowed: true, remaining: RATE_LIMIT - count - 1, limit: RATE_LIMIT, retryAfter: 0 };
	}
}
