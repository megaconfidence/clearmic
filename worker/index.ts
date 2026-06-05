import { getAdminStats } from "./admin";
import { cleanupExpiredData } from "./cleanup";
import { getCurrentUser, getMe, logout, requestOtp, unauthorized, verifyOtp } from "./auth";
import { markJobFailed } from "./db";
import { HttpError, getErrorMessage, json } from "./http";
import { downloadOutput, downloadTranscript, getInputAudio, getJobStatus, listJobs, receiveReplicateWebhook } from "./jobs";
import { processQueuedJob } from "./replicate";
import { getConfig } from "./turnstile";
import { completeUpload, createUpload, uploadContent } from "./uploads";
import type { AppEnv, ProcessJobMessage } from "./types";

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

	// Public admin usage stats (no auth gate for now).
	if (request.method === "GET" && url.pathname === "/api/admin/stats") {
		return getAdminStats(env);
	}

	if (request.method === "POST" && url.pathname === "/api/auth/request-otp") {
		return requestOtp(request, env);
	}

	if (request.method === "POST" && url.pathname === "/api/auth/verify") {
		return verifyOtp(request, env);
	}

	if (request.method === "GET" && url.pathname === "/api/me") {
		return getMe(request, env);
	}

	if (request.method === "POST" && url.pathname === "/api/logout") {
		return logout(request, env);
	}

	const user = await getCurrentUser(request, env);

	if (request.method === "GET" && url.pathname === "/api/jobs") {
		if (!user) return unauthorized();
		return listJobs(env, user);
	}

	if (request.method === "POST" && url.pathname === "/api/uploads") {
		if (!user) return unauthorized();
		return createUpload(request, env, user);
	}

	const uploadMatch = /^\/api\/uploads\/([^/]+)\/complete$/.exec(url.pathname);
	if (uploadMatch && request.method === "POST") {
		if (!user) return unauthorized();
		return completeUpload(decodeURIComponent(uploadMatch[1]), request, env, user);
	}

	const uploadContentMatch = /^\/api\/uploads\/([^/]+)\/content$/.exec(url.pathname);
	if (uploadContentMatch && request.method === "PUT") {
		if (!user) return unauthorized();
		return uploadContent(decodeURIComponent(uploadContentMatch[1]), request, env, user);
	}

	const match = /^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
	if (!match) {
		return json({ error: "Not found" }, 404);
	}

	const jobId = decodeURIComponent(match[1]);
	const action = match[2];

	if (!action && request.method === "GET") {
		if (!user) return unauthorized();
		return getJobStatus(jobId, request, env, user);
	}

	if (action === "input" && request.method === "GET") {
		return getInputAudio(jobId, url, env);
	}

	if (action === "download" && request.method === "GET") {
		return downloadOutput(jobId, url, env);
	}

	if (action === "transcript" && request.method === "GET") {
		return downloadTranscript(jobId, url, env);
	}

	if (action === "webhook" && request.method === "POST") {
		return receiveReplicateWebhook(jobId, url, request, env);
	}

	return json({ error: "Not found" }, 404);
}
