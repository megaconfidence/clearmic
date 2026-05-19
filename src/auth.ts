import { getOrCreateUser, getUser } from "./db";
import { json, readJson } from "./http";
import { randomToken } from "./audio";
import { validateTurnstile } from "./turnstile";
import type { AppEnv, OtpCodeRow, User } from "./types";

const SESSION_COOKIE = "cm_session";
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type AuthBody = {
	email?: unknown;
	code?: unknown;
	turnstileToken?: unknown;
};

export async function requestOtp(request: Request, env: AppEnv): Promise<Response> {
	const body = await readJson<AuthBody>(request);
	const email = normalizeEmail(body?.email);
	if (!email) {
		return json({ error: "Enter a valid email address." }, 400);
	}

	const turnstileResponse = await validateTurnstile(body?.turnstileToken, request, env);
	if (turnstileResponse) {
		return turnstileResponse;
	}

	const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
	const now = new Date();
	await env.DB.prepare(
		"INSERT INTO otp_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
	)
		.bind(crypto.randomUUID(), email, await hashSecret(code), new Date(now.getTime() + OTP_TTL_MS).toISOString(), now.toISOString())
		.run();

	await env.EMAIL.send({
		to: email,
		from: env.EMAIL_FROM,
		subject: "Your ClearMic login code",
		text: `Your ClearMic login code is ${code}. It expires in 10 minutes.`,
		html: `<p>Your ClearMic login code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
	});

	return json({ ok: true });
}

export async function verifyOtp(request: Request, env: AppEnv): Promise<Response> {
	const body = await readJson<AuthBody>(request);
	const email = normalizeEmail(body?.email);
	const code = normalizeCode(body?.code);
	if (!email || !code) {
		return json({ error: "Enter your email and 6-digit code." }, 400);
	}

	const now = new Date().toISOString();
	const otp = await env.DB.prepare(
		`SELECT id, code_hash, attempts
		 FROM otp_codes
		 WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
		 ORDER BY created_at DESC
		 LIMIT 1`,
	)
		.bind(email, now)
		.first<OtpCodeRow>();

	if (!otp || otp.attempts >= 5) {
		return json({ error: "Invalid or expired code." }, 400);
	}

	if ((await hashSecret(code)) !== otp.code_hash) {
		await env.DB.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?").bind(otp.id).run();
		return json({ error: "Invalid or expired code." }, 400);
	}

	const user = await getOrCreateUser(env, email);
	const token = randomToken();
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

	await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(crypto.randomUUID(), user.id, await hashSecret(token), expiresAt, now)
		.run();
	await env.DB.prepare("UPDATE otp_codes SET consumed_at = ? WHERE id = ?").bind(now, otp.id).run();

	return json({ user }, 200, {
		"set-cookie": sessionCookie(token, request, SESSION_TTL_MS / 1000),
	});
}

export async function getCurrentUser(request: Request, env: AppEnv): Promise<User | null> {
	const token = getCookie(request, SESSION_COOKIE);
	if (!token) {
		return null;
	}

	const session = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
		.bind(await hashSecret(token), new Date().toISOString())
		.first<{ user_id: string }>();
	if (!session) {
		return null;
	}

	return getUser(env, session.user_id);
}

export async function getMe(request: Request, env: AppEnv): Promise<Response> {
	const user = await getCurrentUser(request, env);
	return json({ user });
}

export async function logout(request: Request, env: AppEnv): Promise<Response> {
	const token = getCookie(request, SESSION_COOKIE);
	if (token) {
		await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashSecret(token)).run();
	}

	return json({ ok: true }, 200, {
		"set-cookie": sessionCookie("", request, 0),
	});
}

export function unauthorized(): Response {
	return json({ error: "Sign in to continue." }, 401);
}

function normalizeEmail(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const email = value.trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeCode(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const code = value.trim();
	return /^\d{6}$/.test(code) ? code : null;
}

function getCookie(request: Request, name: string): string | null {
	const cookie = request.headers.get("cookie") ?? "";
	for (const part of cookie.split(";")) {
		const [key, ...value] = part.trim().split("=");
		if (key === name) {
			return value.join("=") || null;
		}
	}

	return null;
}

function sessionCookie(value: string, request: Request, maxAgeSeconds: number): string {
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${Math.floor(maxAgeSeconds)}; HttpOnly; SameSite=Lax${secure}`;
}

async function hashSecret(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
