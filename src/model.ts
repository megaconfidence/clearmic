import type { EnhancementPreset, ModelOptions, OutputChoice } from "./types";

export const NOISE_REMOVAL_MODEL = "playmore/speech-enhancer";
export const NOISE_REMOVAL_MODEL_VERSION = "bda37cf8cb38f5b677514933634a281b263a04225f7b2bf62c1c1b8748d21ae6";
export const ENHANCEMENT_MODEL = "resemble-ai/resemble-enhance";
export const ENHANCEMENT_MODEL_VERSION = "93266a7e7f5805fb79bcf213b1a4e0ef2e45aff3c06eefd96c59e850c87fd6a2";
export const TRANSCRIPTION_MODEL = "vaibhavs10/incredibly-fast-whisper";
export const TRANSCRIPTION_MODEL_VERSION = "3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c";

export function modelOptionsFromValues(presetInput: unknown, outputChoiceInput: unknown): ModelOptions | string {
	const preset = String(presetInput ?? "medium").toLowerCase();
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
