// Frontend-facing types. The job shape mirrors `PublicJob` returned by the
// Worker (worker/types.ts) so the client stays in sync with the API contract.

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
export type ProcessingStep = 'noise_removal' | 'enhancement' | 'transcription';
export type EnhancementPreset = 'low' | 'medium' | 'high';
export type OutputChoice = 'enhanced' | 'denoised';
export type Step = 'file' | 'options' | 'auth' | 'processing';

export interface User {
	id: string;
	email: string;
}

export interface Quota {
	used: number;
	limit: number;
}

export interface PublicJob {
	id: string;
	status: JobStatus;
	processingStep: ProcessingStep | null;
	preset: EnhancementPreset;
	outputChoice: OutputChoice;
	inputName: string;
	inputSize: number;
	noiseRemovalRequested: boolean;
	enhancementRequested: boolean;
	transcriptionRequested: boolean;
	transcript: string | null;
	error: string | null;
	downloadUrl: string | null;
	transcriptUrl: string | null;
	expiresAt: string;
}

export interface PipelineOptions {
	noiseRemoval: boolean;
	enhance: boolean;
	enhancementPreset: EnhancementPreset;
	transcribe: boolean;
	emailOnCompletion: boolean;
}

export interface MeResponse {
	user: User | null;
	quota: Quota | null;
}

export interface JobsResponse {
	jobs: PublicJob[];
	quota: Quota | null;
}

export interface ConfigResponse {
	turnstileSiteKey: string;
}

export interface UploadDescriptor {
	id: string;
	url: string;
	headers: Record<string, string>;
}

export interface CreateUploadResponse {
	upload: UploadDescriptor;
}

export interface JobResponse {
	job: PublicJob;
}

export interface VerifyResponse {
	user: User;
}

export interface AdminStats {
	generatedAt: string;
	dailyJobLimit: number;
	statsSince: string | null;
	users: {
		total: number;
		new24h: number;
		new7d: number;
	};
	sessions: {
		active: number;
	};
	uploads: {
		pending: number;
	};
	live: {
		jobs: number;
		byStatus: {
			queued: number;
			processing: number;
			completed: number;
			failed: number;
			canceled: number;
		};
	};
	allTime: {
		jobs: number;
		completed: number;
		failed: number;
		canceled: number;
		steps: {
			noiseRemoval: number;
			enhancement: number;
			transcription: number;
		};
		emailOptIn: number;
		inputBytes: number;
		avgInputBytes: number;
	};
}
