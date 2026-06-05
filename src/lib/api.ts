import type { AdminStats, ConfigResponse, CreateUploadResponse, JobResponse, PipelineOptions } from '../types';

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status = 0,
	) {
		super(message);
	}
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

// Thin fetch wrapper: JSON in, JSON out, and surfaces `{ error }` payloads as
// thrown ApiErrors — matching the contract every /api/* route returns.
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
	const headers = new Headers(options.headers || {});
	if (options.body && typeof options.body === 'string') {
		headers.set('content-type', 'application/json');
	}

	const response = await fetch(path, { ...options, headers });
	const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

	if (!response.ok) {
		throw new ApiError(payload.error || 'Request failed.', response.status);
	}
	return payload;
}

export const getConfig = () => api<ConfigResponse>('/api/config');

export interface CreateUploadBody {
	fileName: string;
	fileType: string;
	fileSize: number;
	options: PipelineOptions;
	turnstileToken: string;
}

export const createUpload = ({ fileName, fileType, fileSize, options, turnstileToken }: CreateUploadBody) =>
	api<CreateUploadResponse>('/api/uploads', {
		method: 'POST',
		// Token travels in a header so the server reads it without consuming the body.
		headers: { 'cf-turnstile-response': turnstileToken },
		body: JSON.stringify({
			fileName,
			fileType,
			fileSize,
			silence_removal: options.silenceRemoval,
			noise_removal: options.noiseRemoval,
			enhance: options.enhance,
			enhancement_preset: options.enhancementPreset,
			output_choice: 'enhanced',
			transcribe: options.transcribe,
			transcript_format: options.transcriptFormat,
			email: options.email.trim(),
		}),
	});

export const completeUpload = (uploadId: string) =>
	api<JobResponse>(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, { method: 'POST' });

export const getJob = (jobId: string) => api<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);

export const getAdminStats = (passphrase: string) =>
	api<AdminStats>('/api/admin/stats', { headers: { 'x-admin-passphrase': passphrase } });
