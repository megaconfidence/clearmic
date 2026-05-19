export function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
	});
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function safeResponseText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return response.statusText;
	}
}

export function getPublicBaseUrl(request: Request): string | null {
	const origin = new URL(request.url).origin.replace(/\/+$/, "");
	return isPublicHttpsUrl(origin) ? origin : null;
}

function isPublicHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
	} catch {
		return false;
	}
}
