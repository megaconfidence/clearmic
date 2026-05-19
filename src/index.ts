import { markJobFailed } from "./db";
import { getErrorMessage, json } from "./http";
import { createJob, downloadOutput, getInputAudio, getJobStatus, receiveReplicateWebhook } from "./jobs";
import { processQueuedJob } from "./replicate";
import type { AppEnv, ProcessJobMessage } from "./types";

export default {
	async fetch(request: Request, env: AppEnv): Promise<Response> {
		try {
			return await routeRequest(request, env);
		} catch (error) {
			console.error(error);
			return json({ error: getErrorMessage(error) }, 500);
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
} satisfies ExportedHandler<AppEnv, ProcessJobMessage>;

async function routeRequest(request: Request, env: AppEnv): Promise<Response> {
	const url = new URL(request.url);

	if (!url.pathname.startsWith("/api/")) {
		return json({ error: "Not found" }, 404);
	}

	if (request.method === "POST" && url.pathname === "/api/jobs") {
		return createJob(request, env);
	}

	const match = /^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
	if (!match) {
		return json({ error: "Not found" }, 404);
	}

	const jobId = decodeURIComponent(match[1]);
	const action = match[2];

	if (!action && request.method === "GET") {
		return getJobStatus(jobId, env);
	}

	if (action === "input" && request.method === "GET") {
		return getInputAudio(jobId, url, env);
	}

	if (action === "download" && request.method === "GET") {
		return downloadOutput(jobId, url, env);
	}

	if (action === "webhook" && request.method === "POST") {
		return receiveReplicateWebhook(jobId, url, request, env);
	}

	return json({ error: "Not found" }, 404);
}
