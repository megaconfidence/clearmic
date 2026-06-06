import { getAdminStats } from "./admin";
import { cleanupExpiredData } from "./cleanup";
import { markJobFailed } from "./db";
import { gate } from "./gate";
import { HttpError, getErrorMessage, json } from "./http";
import { attachJobEmail, downloadOutput, downloadTranscript, getInputAudio, getJobStatus, receiveReplicateWebhook } from "./jobs";
import { processQueuedJob } from "./replicate";
import { getConfig } from "./turnstile";
import { completeUpload, createUpload, uploadContent } from "./uploads";
import type { AppEnv, ProcessJobMessage } from "./types";

// Durable Object class must be re-exported from the Worker's entry module.
export { RateLimiter } from "./rate-limiter";

export default {
	async fetch(request: Request, env: AppEnv): Promise<Response> {
		try {
			return await routeRequest(request, env);
		} catch (error) {
			console.error(error);
			if (error instanceof HttpError) {
				return json({ error: error.message }, error.status);
			}

			return json({ error: "Something went wrong. Please try again." }, 500);
		}
	},

	async queue(batch: MessageBatch<ProcessJobMessage>, env: AppEnv): Promise<void> {
		for (const message of batch.messages) {
			try {
				await processQueuedJob(message.body, env);
			} catch (error) {
				console.error(error);
				await markJobFailed(env, message.body.jobId, getErrorMessage(error));
				throw error;
			}
		}
	},

	async scheduled(_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(runScheduledCleanup(env));
	},
} satisfies ExportedHandler<AppEnv, ProcessJobMessage>;

async function runScheduledCleanup(env: AppEnv): Promise<void> {
	const result = await cleanupExpiredData(env);
	console.log("Expired data cleanup completed", result);
}

async function routeRequest(request: Request, env: AppEnv): Promise<Response> {
	const url = new URL(request.url);

	if (!url.pathname.startsWith("/api/")) {
		return json({ error: "Not found" }, 404);
	}

	if (request.method === "GET" && url.pathname === "/api/config") {
		return getConfig(request, env);
	}

	// Admin usage stats — behind a shared passphrase (auth.md Part B).
	if (request.method === "GET" && url.pathname === "/api/admin/stats") {
		return getAdminStats(request, env);
	}

	// Starting a job is the expensive, abusable action: gate it with the bot
	// check + per-IP rate limit. Everything after is keyed by an opaque id.
	if (request.method === "POST" && url.pathname === "/api/uploads") {
		const turnstileToken = request.headers.get("cf-turnstile-response");
		return gate(request, env, turnstileToken, () => createUpload(request, env));
	}

	const uploadMatch = /^\/api\/uploads\/([^/]+)\/complete$/.exec(url.pathname);
	if (uploadMatch && request.method === "POST") {
		return completeUpload(decodeURIComponent(uploadMatch[1]), request, env);
	}

	const uploadContentMatch = /^\/api\/uploads\/([^/]+)\/content$/.exec(url.pathname);
	if (uploadContentMatch && request.method === "PUT") {
		return uploadContent(decodeURIComponent(uploadContentMatch[1]), request, env);
	}

	const match = /^\/api\/jobs\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(url.pathname);
	if (!match) {
		return json({ error: "Not found" }, 404);
	}

	const jobId = decodeURIComponent(match[1]);
	const action = match[2];
	// Secret tokens travel as a path segment (…/download/<token>) so emailed
	// links don't look like credential-bearing query strings to spam filters.
	// The legacy ?token= form is still honored for links issued before this.
	const token = match[3] ? decodeURIComponent(match[3]) : url.searchParams.get("token");

	if (!action && request.method === "GET") {
		return getJobStatus(jobId, request, env);
	}

	if (action === "input" && request.method === "GET") {
		return getInputAudio(jobId, token, env);
	}

	if (action === "download" && request.method === "GET") {
		return downloadOutput(jobId, token, env);
	}

	if (action === "transcript" && request.method === "GET") {
		return downloadTranscript(jobId, token, env);
	}

	if (action === "webhook" && request.method === "POST") {
		return receiveReplicateWebhook(jobId, url, request, env);
	}

	if (action === "email" && request.method === "POST") {
		return attachJobEmail(jobId, request, env);
	}

	return json({ error: "Not found" }, 404);
}
