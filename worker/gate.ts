import { json } from "./http";
import { RATE_LIMIT, type RateLimitResult } from "./rate-limiter";
import { validateTurnstile } from "./turnstile";
import type { AppEnv } from "./types";

// Public API gate for the expensive "start" call (auth.md Part A3).
//
// Order matters: bot check FIRST (fail closed) so a bot flood can't burn a real
// user's quota, then the per-IP rate limit (fail open) so a broken limiter never
// takes the API down. Reads that follow (status polls, downloads) stay open and
// are keyed by an unguessable id/token instead.
export async function gate(request: Request, env: AppEnv, turnstileToken: unknown, run: () => Promise<Response>): Promise<Response> {
	// 1) Bot check — FAIL CLOSED. validateTurnstile returns a Response on failure.
	const verification = await validateTurnstile(turnstileToken, request, env);
	if (verification) {
		return verification;
	}

	// 2) Per-IP rate limit — FAILS OPEN inside checkRateLimit.
	const limit = await checkRateLimit(request, env);
	if (!limit.allowed) {
		return json({ error: `Hourly limit reached. You can process ${limit.limit} files per hour — try again later.` }, 429, {
			"Retry-After": String(limit.retryAfter),
			"X-RateLimit-Limit": String(limit.limit),
			"X-RateLimit-Remaining": "0",
		});
	}

	// 3) Run the real handler.
	return run();
}

// Key the limiter by the edge-provided client IP. Fall back to a shared
// "unknown" bucket so anon callers without the header can't bypass the limit.
async function checkRateLimit(request: Request, env: AppEnv): Promise<RateLimitResult> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	try {
		return await env.RATE_LIMITER.getByName(ip).consume();
	} catch (error) {
		// A broken limiter must not take down the API.
		console.error("Rate limiter unavailable; failing open", error);
		return { allowed: true, remaining: RATE_LIMIT, limit: RATE_LIMIT, retryAfter: 0 };
	}
}
