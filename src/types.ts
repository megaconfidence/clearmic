// Frontend-facing types. The job shape mirrors `PublicJob` returned by the
// Worker (worker/types.ts) so the client stays in sync with the API contract.

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
export type ProcessingStep = 'silence_removal' | 'noise_removal' | 'enhancement' | 'transcription';
export type EnhancementPreset = 'low' | 'medium' | 'high';
export type OutputChoice = 'enhanced' | 'denoised';
export type TranscriptFormat = 'txt' | 'srt' | 'vtt';
export type Step = 'file' | 'options' | 'processing';

export interface PublicJob {
	id: string;
	status: JobStatus;
	processingStep: ProcessingStep | null;
	preset: EnhancementPreset;
	outputChoice: OutputChoice;
	inputName: string;
	inputSize: number;
	silenceRemovalRequested: boolean;
	noiseRemovalRequested: boolean;
	enhancementRequested: boolean;
	transcriptionRequested: boolean;
	transcript: string | null;
	transcriptFormat: TranscriptFormat;
	emailRequested: boolean;
	error: string | null;
	downloadUrl: string | null;
	transcriptUrl: string | null;
	expiresAt: string;
}

export interface PipelineOptions {
	silenceRemoval: boolean;
	noiseRemoval: boolean;
	enhance: boolean;
	enhancementPreset: EnhancementPreset;
	transcribe: boolean;
	transcriptFormat: TranscriptFormat;
	// Optional. When non-empty, the finished download links are emailed here. The
	// address is never stored beyond sending (see worker/notifications.ts).
	email: string;
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

export interface AdminStats {
	generatedAt: string;
	dailyJobLimit: number;
	statsSince: string | null;
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
			silenceRemoval: number;
			noiseRemoval: number;
			enhancement: number;
			transcription: number;
		};
		emailOptIn: number;
		inputBytes: number;
		avgInputBytes: number;
	};
}
