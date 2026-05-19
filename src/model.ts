import type { CleanupPreset, ModelOptions, OutputChoice } from "./types";

export const REPLICATE_MODEL = "resemble-ai/resemble-enhance";
export const REPLICATE_MODEL_VERSION = "93266a7e7f5805fb79bcf213b1a4e0ef2e45aff3c06eefd96c59e850c87fd6a2";

const CLEANUP_PRESETS: Record<CleanupPreset, Omit<ModelOptions, "preset" | "outputChoice">> = {
	light: {
		solver: "Midpoint",
		numberFunctionEvaluations: 32,
		priorTemperature: 0.3,
	},
	balanced: {
		solver: "Midpoint",
		numberFunctionEvaluations: 64,
		priorTemperature: 0.5,
	},
	aggressive: {
		solver: "RK4",
		numberFunctionEvaluations: 96,
		priorTemperature: 0.7,
	},
};

export function parseModelOptions(form: FormData): ModelOptions | string {
	const preset = String(form.get("preset") ?? "balanced").toLowerCase();
	if (!isCleanupPreset(preset)) {
		return "Invalid cleanup preset.";
	}

	const outputChoice = String(form.get("output_choice") ?? "enhanced").toLowerCase();
	if (!isOutputChoice(outputChoice)) {
		return "Invalid output choice.";
	}

	return {
		preset,
		outputChoice,
		...CLEANUP_PRESETS[preset],
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

function isCleanupPreset(value: string): value is CleanupPreset {
	return value === "light" || value === "balanced" || value === "aggressive";
}

function isOutputChoice(value: string): value is OutputChoice {
	return value === "enhanced" || value === "denoised";
}
