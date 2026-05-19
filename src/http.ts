import type { AppEnv } from "./types";

const DEFAULT_JSON_BODY_LIMIT_BYTES = 16 * 1024;

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
	const responseHeaders = new Headers(headers);
	responseHeaders.set("content-type", "application/json; charset=utf-8");

	return new Response(JSON.stringify(data), {
		status,
		headers: responseHeaders,
	});
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function readJson<T>(request: Request, maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES): Promise<T | null> {
	const contentLength = request.headers.get("content-length");
	if (contentLength) {
		const size = Number(contentLength);
		if (Number.isFinite(size) && size > maxBytes) {
			throw new HttpError(413, "Request body is too large.");
		}
	}

	try {
		const { text, truncated } = await readLimitedText(request.body, maxBytes);
		if (truncated) {
			throw new HttpError(413, "Request body is too large.");
		}

		return JSON.parse(text) as T;
	} catch (error) {
		if (error instanceof HttpError) {
			throw error;
		}

		return null;
	}
}

export async function safeResponseText(response: Response, maxBytes = 1000): Promise<string> {
	try {
		const { text, truncated } = await readLimitedText(response.body, maxBytes);
		if (!text) {
			return response.statusText;
		}

		return truncated ? `${text}...` : text;
	} catch {
		return response.statusText;
	}
}

export function getPublicBaseUrl(request: Request): string | null {
	const origin = new URL(request.url).origin.replace(/\/+$/, "");
	return isPublicHttpsUrl(origin) ? origin : null;
}

export function rejectDisallowedOrigin(request: Request, env: AppEnv): Response | null {
	const origin = request.headers.get("origin");
	if (!origin) {
		return null;
	}

	if (origin === new URL(request.url).origin || getAllowedOrigins(env).has(origin)) {
		return null;
	}

	return json({ error: "Origin is not allowed." }, 403);
}

export function getAllowedOrigins(env: AppEnv): Set<string> {
	return new Set(
		(env.APP_ORIGINS ?? "")
			.split(",")
			.map((origin) => origin.trim().replace(/\/+$/, ""))
			.filter(Boolean),
	);
}

async function readLimitedText(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
	if (!body) {
		return { text: "", truncated: false };
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let truncated = false;

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		const remaining = maxBytes - size;
		if (value.byteLength > remaining) {
			chunks.push(value.slice(0, Math.max(0, remaining)));
			truncated = true;
			await reader.cancel();
			break;
		}

		chunks.push(value);
		size += value.byteLength;
	}

	const totalSize = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(totalSize);
	let offset = 0;

	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return { text: new TextDecoder().decode(bytes), truncated };
}

function isPublicHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
	} catch {
		return false;
	}
}
