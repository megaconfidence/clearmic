import type { EnhancementPreset, ModelOptions, OutputChoice, TranscriptFormat } from "./types";

export const SILENCE_REMOVAL_MODEL = "nikitalokhmachev-ai/silero-vad";
export const SILENCE_REMOVAL_MODEL_VERSION = "4bc84609d5deaef365a6dc3b574af633748dedb4157b8e4ba98817f888ba563d";
export const NOISE_REMOVAL_MODEL = "playmore/speech-enhancer";
export const NOISE_REMOVAL_MODEL_VERSION = "bda37cf8cb38f5b677514933634a281b263a04225f7b2bf62c1c1b8748d21ae6";
export const ENHANCEMENT_MODEL = "resemble-ai/resemble-enhance";
export const ENHANCEMENT_MODEL_VERSION = "93266a7e7f5805fb79bcf213b1a4e0ef2e45aff3c06eefd96c59e850c87fd6a2";
export const TRANSCRIPTION_MODEL = "openai/whisper";
export const TRANSCRIPTION_MODEL_VERSION = "8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e";

// Accepts the optional client value and returns a safe format code, or null when
// a non-empty value isn't one we support.
export function transcriptFormatFromValue(value: unknown): TranscriptFormat | null {
	if (value === undefined || value === null || value === "") {
		return "txt";
	}
	const format = String(value).toLowerCase();
	return isTranscriptFormat(format) ? format : null;
}

// Maps our short code to the openai/whisper `transcription` input value.
export function whisperTranscriptionArg(format: TranscriptFormat): "plain text" | "srt" | "vtt" {
	if (format === "srt") {
		return "srt";
	}
	if (format === "vtt") {
		return "vtt";
	}
	return "plain text";
}

function isTranscriptFormat(value: string): value is TranscriptFormat {
	return value === "txt" || value === "srt" || value === "vtt";
}

export function modelOptionsFromValues(presetInput: unknown, outputChoiceInput: unknown): ModelOptions | string {
	const preset = String(presetInput ?? "low").toLowerCase();
	if (!isEnhancementPreset(preset)) {
		return "Invalid enhancement preset.";
	}

	const outputChoice = String(outputChoiceInput ?? "enhanced").toLowerCase();
	if (!isOutputChoice(outputChoice)) {
		return "Invalid output choice.";
	}

	return {
		preset,
		solver: "Midpoint",
		numberFunctionEvaluations: numberFunctionEvaluationsForPreset(preset),
		priorTemperature: 0.5,
		outputChoice,
	};
}

export function pickOutputUrl(output: unknown, outputChoice: OutputChoice): string | null {
	if (typeof output === "string") {
		return output;
	}

	if (Array.isArray(output)) {
		const urls = output.filter((item): item is string => typeof item === "string");
		return urls.find((url) => url.toLowerCase().includes(outputChoice)) ?? urls.at(-1) ?? null;
	}

	return null;
}

function isOutputChoice(value: string): value is OutputChoice {
	return value === "enhanced" || value === "denoised";
}

function isEnhancementPreset(value: string): value is EnhancementPreset {
	return value === "low" || value === "medium" || value === "high";
}

function numberFunctionEvaluationsForPreset(preset: EnhancementPreset): number {
	if (preset === "low") {
		return 32;
	}
	if (preset === "high") {
		return 128;
	}

	return 64;
}
