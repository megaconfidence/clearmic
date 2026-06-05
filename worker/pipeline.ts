import { ENHANCEMENT_MODEL, NOISE_REMOVAL_MODEL, SILENCE_REMOVAL_MODEL, TRANSCRIPTION_MODEL } from "./model";
import type { ProcessingStep } from "./types";

type ProcessingSelection = {
	silence_removal: number;
	noise_removal: number;
	enhance: number;
	transcribe: number;
};

export function modelForProcessingStep(step: ProcessingStep): string {
	if (step === "silence_removal") {
		return SILENCE_REMOVAL_MODEL;
	}
	if (step === "noise_removal") {
		return NOISE_REMOVAL_MODEL;
	}

	return step === "transcription" ? TRANSCRIPTION_MODEL : ENHANCEMENT_MODEL;
}

export function processingStepForModel(model: string): ProcessingStep | null {
	if (model === SILENCE_REMOVAL_MODEL) {
		return "silence_removal";
	}
	if (model === NOISE_REMOVAL_MODEL) {
		return "noise_removal";
	}
	if (model === ENHANCEMENT_MODEL) {
		return "enhancement";
	}
	if (model === TRANSCRIPTION_MODEL) {
		return "transcription";
	}

	return null;
}

// Transcription is NOT part of the audio chain — it runs as a parallel branch
// (see worker/replicate.ts). These helpers only sequence the audio-cleaning
// steps: silence removal -> noise removal -> enhancement.
type AudioStep = Exclude<ProcessingStep, "transcription">;

export function hasAudioStep(selection: ProcessingSelection): boolean {
	return selection.silence_removal === 1 || selection.noise_removal === 1 || selection.enhance === 1;
}

export function firstAudioStep(selection: ProcessingSelection): AudioStep | null {
	if (selection.silence_removal === 1) {
		return "silence_removal";
	}
	if (selection.noise_removal === 1) {
		return "noise_removal";
	}
	return selection.enhance === 1 ? "enhancement" : null;
}

export function nextAudioStep(selection: ProcessingSelection, currentStep: AudioStep): AudioStep | null {
	if (currentStep === "silence_removal") {
		if (selection.noise_removal === 1) {
			return "noise_removal";
		}
		return selection.enhance === 1 ? "enhancement" : null;
	}

	if (currentStep === "noise_removal") {
		return selection.enhance === 1 ? "enhancement" : null;
	}

	return null;
}

// The first prediction the job kicks off (audio branch if any, else transcription).
export function firstSelectedProcessingStep(selection: ProcessingSelection): ProcessingStep | null {
	return firstAudioStep(selection) ?? (selection.transcribe === 1 ? "transcription" : null);
}

export function processingStepLabel(step: ProcessingStep): string {
	if (step === "silence_removal") {
		return "Silence removal";
	}
	if (step === "noise_removal") {
		return "Noise removal";
	}

	return step === "transcription" ? "Transcription" : "Enhancement";
}
