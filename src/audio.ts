export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function isAudioUpload(name: string, contentType: string): boolean {
	return contentType.startsWith("audio/") || /\.(aac|aif|aiff|flac|m4a|mp3|ogg|opus|wav|webm|wma)$/i.test(name);
}

export function sanitizeFileName(name: string): string {
	const sanitized = name
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 90);

	return sanitized || "audio";
}

export function cleanedFileName(inputName: string): string {
	const base = sanitizeFileName(inputName).replace(/\.[^.]+$/, "");
	return `${base || "audio"}-cleaned.wav`;
}

export function escapeHeaderFilename(name: string): string {
	return name.replace(/["\\\r\n]/g, "");
}

export function objectHeaders(object: R2ObjectBody, fileName: string, fallbackContentType: string): Headers {
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	if (!headers.has("content-type")) {
		headers.set("content-type", fallbackContentType);
	}
	headers.set("content-disposition", `attachment; filename="${escapeHeaderFilename(fileName)}"`);
	return headers;
}

export function randomToken(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function extensionFromUrl(value: string): string {
	try {
		const ext = new URL(value).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
		return ext && ext.length <= 5 ? ext : "wav";
	} catch {
		return "wav";
	}
}

export function formatBytes(bytes: number): string {
	return `${Math.round(bytes / 1024 / 1024)} MB`;
}
