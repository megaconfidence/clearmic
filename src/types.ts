export type JobStatus = "queued" | "processing" | "completed" | "failed" | "canceled";
export type CleanupPreset = "light" | "balanced" | "aggressive";
export type Solver = "Midpoint" | "RK4" | "Euler";
export type OutputChoice = "enhanced" | "denoised";

export type ProcessJobMessage = {
	jobId: string;
	baseUrl: string;
};

export type AppEnv = Omit<Env, "AUDIO_QUEUE"> & {
	AUDIO_QUEUE: Queue<ProcessJobMessage>;
};

export type ModelOptions = {
	preset: CleanupPreset;
	solver: Solver;
	numberFunctionEvaluations: number;
	priorTemperature: number;
	outputChoice: OutputChoice;
};

export type JobRow = {
	id: string;
	status: JobStatus;
	input_key: string;
	input_name: string;
	input_content_type: string | null;
	input_size: number;
	output_key: string | null;
	output_content_type: string | null;
	replicate_prediction_id: string | null;
	replicate_get_url: string | null;
	error: string | null;
	preset: CleanupPreset;
	solver: Solver;
	number_function_evaluations: number;
	prior_temperature: number;
	output_choice: OutputChoice;
	input_token: string;
	download_token: string;
	webhook_token: string;
};

export type ReplicatePrediction = {
	id: string;
	status: string;
	output?: unknown;
	error?: string | null;
	urls?: {
		get?: string;
		web?: string;
		cancel?: string;
	};
};

export type PublicJob = {
	id: string;
	status: JobStatus;
	preset: CleanupPreset;
	outputChoice: OutputChoice;
	inputName: string;
	inputSize: number;
	error: string | null;
	downloadUrl: string | null;
};
