import { MAX_UPLOAD_BYTES, formatBytes, isAudioUpload, randomToken, sanitizeFileName } from "./audio";
import { getJob, isExpired, markJobFailed, publicJob } from "./db";
import { getErrorMessage, getPublicBaseUrl, json, readJson, rejectDisallowedOrigin } from "./http";
import { modelOptionsFromValues, REPLICATE_MODEL } from "./model";
import { createPresignedPutUrl } from "./r2";
import type { AppEnv, UploadIntentRow, User } from "./types";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const DAILY_JOB_LIMIT = 10;
const UPLOAD_ID_METADATA_HEADER = "X-Amz-Meta-Clearmic-Upload-Id";
const UPLOAD_SIZE_METADATA_HEADER = "X-Amz-Meta-Clearmic-Expected-Size";

export async function getDailyJobUsage(env: AppEnv, user: User): Promise<{ used: number; limit: number }> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const row = await env.DB.prepare(
		`SELECT
			(SELECT COUNT(*) FROM jobs WHERE user_id = ? AND created_at >= ?) +
			(SELECT COUNT(*) FROM upload_intents WHERE user_id = ? AND created_at >= ?) AS count`,
	)
		.bind(user.id, since, user.id, since)
		.first<{ count: number }>();

	return { used: Math.min(row?.count ?? 0, DAILY_JOB_LIMIT), limit: DAILY_JOB_LIMIT };
}

type UploadRequest = {
	fileName?: unknown;
	fileType?: unknown;
	fileSize?: unknown;
	preset?: unknown;
	output_choice?: unknown;
};

type UploadMetadata = {
	fileName: string;
	fileType: string;
	fileSize: number;
};

export async function createUpload(request: Request, env: AppEnv, user: User): Promise<Response> {
	if (!env.REPLICATE_API_TOKEN) {
		return json({ error: "Missing REPLICATE_API_TOKEN secret." }, 500);
	}

	const originResponse = rejectDisallowedOrigin(request);
	if (originResponse) {
		return originResponse;
	}

	await cleanupExpiredUploadIntents(env).catch((error) => console.error("Expired upload cleanup failed", error));

	if (!(await hasDailyUploadCapacity(env, user))) {
		return json({ error: `Daily limit reached. You can process ${DAILY_JOB_LIMIT} files per email per day.` }, 429);
	}

	const body = await readJson<UploadRequest>(request);
	if (!body) {
		return json({ error: "Send upload metadata as JSON." }, 400);
	}

	const parsedUpload = parseUploadRequest(body);
	if ("error" in parsedUpload) {
		return json({ error: parsedUpload.error }, parsedUpload.status);
	}
	const upload = parsedUpload.metadata;

	const modelOptions = modelOptionsFromValues(body.preset, body.output_choice);
	if (typeof modelOptions === "string") {
		return json({ error: modelOptions }, 400);
	}

	const now = new Date().toISOString();
	const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	const uploadExpiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
	const uploadId = crypto.randomUUID();
	const inputContentType = normalizeContentType(upload.fileType);
	const inputKey = `inputs/${uploadId}/${sanitizeFileName(upload.fileName)}`;
	const uploadHeaders = browserUploadHeaders(uploadId, upload.fileSize, inputContentType);

	await env.DB.prepare(
		`INSERT INTO upload_intents (
			id, user_id, input_key, input_name, input_content_type, input_size,
			preset, solver, number_function_evaluations, prior_temperature, output_choice,
			input_token, download_token, webhook_token, expires_at, upload_expires_at, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			uploadId,
			user.id,
			inputKey,
			upload.fileName,
			inputContentType,
			upload.fileSize,
			modelOptions.preset,
			modelOptions.solver,
			modelOptions.numberFunctionEvaluations,
			modelOptions.priorTemperature,
			modelOptions.outputChoice,
			randomToken(),
			randomToken(),
			randomToken(),
			expiresAt,
			uploadExpiresAt,
			now,
		)
		.run();

	return json({
		upload: {
			id: uploadId,
			url: await createPresignedPutUrl(env, inputKey, UPLOAD_URL_TTL_SECONDS, {
				...uploadHeaders,
				"Content-Length": String(upload.fileSize),
			}),
			headers: uploadHeaders,
			expiresAt: uploadExpiresAt,
		},
	});
}

export async function completeUpload(uploadId: string, request: Request, env: AppEnv, user: User): Promise<Response> {
	const originResponse = rejectDisallowedOrigin(request);
	if (originResponse) {
		return originResponse;
	}

	await cleanupExpiredUploadIntents(env).catch((error) => console.error("Expired upload cleanup failed", error));

	const existingJob = await getJob(env, uploadId);
	if (existingJob?.user_id === user.id && !isExpired(existingJob.expires_at)) {
		return json({ job: publicJob(existingJob) });
	}

	const upload = await env.DB.prepare("SELECT * FROM upload_intents WHERE id = ? AND user_id = ? AND upload_expires_at > ?")
		.bind(uploadId, user.id, new Date().toISOString())
		.first<UploadIntentRow>();
	if (!upload) {
		return json({ error: "Upload not found or expired." }, 404);
	}

	if (!(await hasDailyJobCapacity(env, user))) {
		await deleteUploadIntent(env, upload);
		return json({ error: `Daily limit reached. You can process ${DAILY_JOB_LIMIT} files per email per day.` }, 429);
	}

	const object = await env.AUDIO_BUCKET.head(upload.input_key);
	if (!object) {
		return json({ error: "Upload is not complete yet." }, 409);
	}

	const uploadMismatch = getUploadMismatch(upload, object);
	if (uploadMismatch) {
		await deleteUploadIntent(env, upload);
		return json({ error: uploadMismatch }, 400);
	}

	const baseUrl = getPublicBaseUrl(request);
	if (!baseUrl) {
		return json({ error: "Replicate needs a public HTTPS URL. Deploy the Worker or open the app through `npm run dev:tunnel`." }, 400);
	}

	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO jobs (
			id, user_id, status, model, input_key, input_name, input_content_type, input_size,
			preset, solver, number_function_evaluations, prior_temperature, output_choice,
			input_token, download_token, webhook_token, expires_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			upload.id,
			user.id,
			"queued",
			REPLICATE_MODEL,
			upload.input_key,
			upload.input_name,
			upload.input_content_type,
			upload.input_size,
			upload.preset,
			upload.solver,
			upload.number_function_evaluations,
			upload.prior_temperature,
			upload.output_choice,
			upload.input_token,
			upload.download_token,
			upload.webhook_token,
			upload.expires_at,
			now,
			now,
		)
		.run();
	await env.DB.prepare("DELETE FROM upload_intents WHERE id = ?").bind(upload.id).run();

	try {
		await env.AUDIO_QUEUE.send({ jobId: upload.id, baseUrl });
	} catch (error) {
		await markJobFailed(env, upload.id, `Failed to enqueue job: ${getErrorMessage(error)}`);
		throw error;
	}

	const job = await getJob(env, upload.id);
	if (!job) {
		throw new Error("Failed to read created job.");
	}

	return json({ job: publicJob(job) }, 201);
}

function parseUploadRequest(body: UploadRequest): { metadata: UploadMetadata } | { error: string; status: number } {
	const fileName = typeof body.fileName === "string" ? body.fileName : "";
	const fileType = typeof body.fileType === "string" ? body.fileType : "";
	const fileSize = typeof body.fileSize === "number" ? body.fileSize : Number(body.fileSize);

	if (!fileName || !Number.isSafeInteger(fileSize)) {
		return { error: "Missing upload metadata.", status: 400 };
	}

	if (fileSize <= 0) {
		return { error: "Audio file is empty.", status: 400 };
	}

	if (fileSize > MAX_UPLOAD_BYTES) {
		return { error: `Audio file is too large. MVP limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`, status: 413 };
	}

	if (!isAudioUpload(fileName, fileType)) {
		return { error: "File must be an audio upload.", status: 400 };
	}

	return { metadata: { fileName, fileType, fileSize } };
}

function browserUploadHeaders(uploadId: string, fileSize: number, contentType: string): Record<string, string> {
	return {
		"Content-Type": contentType,
		[UPLOAD_ID_METADATA_HEADER]: uploadId,
		[UPLOAD_SIZE_METADATA_HEADER]: String(fileSize),
	};
}

function normalizeContentType(value: string): string {
	const contentType = value.trim();
	return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;\s*[a-z0-9!#$&^_.+-]+=[^;\r\n]+)*$/i.test(contentType)
		? contentType
		: "application/octet-stream";
}

function getUploadMismatch(upload: UploadIntentRow, object: R2Object): string | null {
	if (object.size !== upload.input_size) {
		return "Uploaded file size did not match.";
	}

	if (object.httpMetadata?.contentType !== upload.input_content_type) {
		return "Uploaded file type did not match.";
	}

	if (customMetadataValue(object, "clearmic-upload-id") !== upload.id) {
		return "Uploaded file metadata did not match.";
	}

	if (customMetadataValue(object, "clearmic-expected-size") !== String(upload.input_size)) {
		return "Uploaded file metadata did not match.";
	}

	return null;
}

function customMetadataValue(object: R2Object, key: string): string | null {
	for (const [metadataKey, value] of Object.entries(object.customMetadata ?? {})) {
		if (metadataKey.toLowerCase() === key) {
			return value;
		}
	}

	return null;
}

async function hasDailyJobCapacity(env: AppEnv, user: User): Promise<boolean> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id = ? AND created_at >= ?")
		.bind(user.id, since)
		.first<{ count: number }>();

	return (row?.count ?? 0) < DAILY_JOB_LIMIT;
}

async function hasDailyUploadCapacity(env: AppEnv, user: User): Promise<boolean> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const row = await env.DB.prepare(
		`SELECT
			(SELECT COUNT(*) FROM jobs WHERE user_id = ? AND created_at >= ?) +
			(SELECT COUNT(*) FROM upload_intents WHERE user_id = ? AND created_at >= ?) AS count`,
	)
		.bind(user.id, since, user.id, since)
		.first<{ count: number }>();

	return (row?.count ?? 0) < DAILY_JOB_LIMIT;
}

async function cleanupExpiredUploadIntents(env: AppEnv): Promise<void> {
	const { results } = await env.DB.prepare("SELECT id, input_key FROM upload_intents WHERE upload_expires_at <= ? LIMIT 25")
		.bind(new Date().toISOString())
		.all<Pick<UploadIntentRow, "id" | "input_key">>();

	for (const upload of results) {
		await deleteUploadIntent(env, upload);
	}
}

async function deleteUploadIntent(env: AppEnv, upload: Pick<UploadIntentRow, "id" | "input_key">): Promise<void> {
	await env.AUDIO_BUCKET.delete(upload.input_key);
	await env.DB.prepare("DELETE FROM upload_intents WHERE id = ?").bind(upload.id).run();
}
