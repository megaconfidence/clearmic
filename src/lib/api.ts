import type {
	ConfigResponse,
	CreateUploadResponse,
	JobResponse,
	JobsResponse,
	MeResponse,
	PipelineOptions,
	VerifyResponse,
} from '../types';

export class ApiError extends Error {}

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
		throw new ApiError(payload.error || 'Request failed.');
	}
	return payload;
}

export const getMe = () => api<MeResponse>('/api/me');

export const getConfig = () => api<ConfigResponse>('/api/config');

export const listJobs = () => api<JobsResponse>('/api/jobs');

export const requestOtp = (email: string, turnstileToken: string) =>
	api<Record<string, never>>('/api/auth/request-otp', {
		method: 'POST',
		body: JSON.stringify({ email, turnstileToken }),
	});

export const verifyOtp = (email: string, code: string) =>
	api<VerifyResponse>('/api/auth/verify', {
		method: 'POST',
		body: JSON.stringify({ email, code }),
	});

export const logout = () => api<Record<string, never>>('/api/logout', { method: 'POST' });

export interface CreateUploadBody {
	fileName: string;
	fileType: string;
	fileSize: number;
	options: PipelineOptions;
}

export const createUpload = ({ fileName, fileType, fileSize, options }: CreateUploadBody) =>
	api<CreateUploadResponse>('/api/uploads', {
		method: 'POST',
		body: JSON.stringify({
			fileName,
			fileType,
			fileSize,
			noise_removal: options.noiseRemoval,
			enhance: options.enhance,
			enhancement_preset: options.enhancementPreset,
			output_choice: 'enhanced',
			transcribe: options.transcribe,
			email_on_completion: options.emailOnCompletion,
		}),
	});

export const completeUpload = (uploadId: string) =>
	api<JobResponse>(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, { method: 'POST' });

export const getJob = (jobId: string) => api<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
