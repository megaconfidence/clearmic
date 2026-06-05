import { isLocalDevHost, json } from "./http";
import type { AppEnv } from "./types";

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

type TurnstileResult = {
	success: boolean;
	"error-codes"?: string[];
};

export function getConfig(request: Request, env: AppEnv): Response {
	return json({ turnstileSiteKey: turnstileKeys(request, env).siteKey });
}

export async function validateTurnstile(token: unknown, request: Request, env: AppEnv): Promise<Response | null> {
	if (typeof token !== "string" || !token || token.length > 2048) {
		return json({ error: "Complete the verification challenge before continuing." }, 403);
	}

	const form = new FormData();
	form.set("secret", turnstileKeys(request, env).secretKey);
	form.set("response", token);
	form.set("idempotency_key", crypto.randomUUID());

	const remoteIp = request.headers.get("CF-Connecting-IP");
	if (remoteIp) {
		form.set("remoteip", remoteIp);
	}

	let outcome: TurnstileResult;
	try {
		const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
			method: "POST",
			body: form,
		});

		if (!response.ok) {
			return json({ error: "Verification is temporarily unavailable." }, 503);
		}

		outcome = (await response.json()) as TurnstileResult;
	} catch (error) {
		console.error("Turnstile validation error", error);
		return json({ error: "Verification is temporarily unavailable." }, 503);
	}

	return outcome.success ? null : json({ error: "Verification failed. Please try again." }, 403);
}

function turnstileKeys(request: Request, env: AppEnv): { siteKey: string; secretKey: string } {
	if (isLocalDevHost(new URL(request.url).hostname)) {
		return {
			siteKey: TURNSTILE_TEST_SITE_KEY,
			secretKey: TURNSTILE_TEST_SECRET_KEY,
		};
	}

	return {
		siteKey: env.TURNSTILE_SITE_KEY,
		secretKey: env.TURNSTILE_SECRET_KEY,
	};
}
