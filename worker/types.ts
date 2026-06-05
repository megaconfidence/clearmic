export type JobStatus = "queued" | "processing" | "completed" | "failed" | "canceled";
export type ProcessingStep = "noise_removal" | "enhancement" | "transcription";
export type EnhancementPreset = "low" | "medium" | "high";
export type Solver = "Midpoint" | "RK4" | "Euler";
export type OutputChoice = "enhanced" | "denoised";

export type ProcessJobMessage = {
	jobId: string;
	baseUrl: string;
};

export type AppEnv = Omit<Env, "AUDIO_QUEUE"> & {
	AUDIO_QUEUE: Queue<ProcessJobMessage>;
};

export type User = {
	id: string;
	email: string;
};

export type OtpCodeRow = {
	id: string;
	code_hash: string;
	attempts: number;
};

export type ModelOptions = {
	preset: EnhancementPreset;
	solver: Solver;
	numberFunctionEvaluations: number;
	priorTemperature: number;
	outputChoice: OutputChoice;
};

export type JobRow = {
	id: string;
	user_id: string | null;
	status: JobStatus;
	model: string;
	input_key: string;
	input_name: string;
	input_content_type: string | null;
	input_size: number;
	output_key: string | null;
	output_content_type: string | null;
	email_on_completion: number;
	completion_email_sent_at: string | null;
	replicate_prediction_id: string | null;
	replicate_get_url: string | null;
	replicate_webhook_url: string | null;
	error: string | null;
	noise_removal: number;
	enhance: number;
	transcribe: number;
	transcript: string | null;
	preset: EnhancementPreset;
	solver: Solver;
	number_function_evaluations: number;
	prior_temperature: number;
	output_choice: OutputChoice;
	input_token: string;
	download_token: string;
	webhook_token: string;
	expires_at: string;
};

export type UploadIntentRow = {
	id: string;
	user_id: string;
	input_key: string;
	input_name: string;
	input_content_type: string | null;
	input_size: number;
	email_on_completion: number;
	noise_removal: number;
	enhance: number;
	transcribe: number;
	preset: EnhancementPreset;
	solver: Solver;
	number_function_evaluations: number;
	prior_temperature: number;
	output_choice: OutputChoice;
	input_token: string;
	download_token: string;
	webhook_token: string;
	expires_at: string;
	upload_expires_at: string;
};

export type ReplicatePrediction = {
	id: string;
	status: string;
	output?: unknown;
	error?: unknown;
	webhook?: string;
	urls?: {
		get?: string;
		web?: string;
	};
};

export type PublicJob = {
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
};
