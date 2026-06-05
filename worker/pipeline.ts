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

export function firstSelectedProcessingStep(selection: ProcessingSelection): ProcessingStep | null {
	if (selection.silence_removal === 1) {
		return "silence_removal";
	}
	if (selection.noise_removal === 1) {
		return "noise_removal";
	}
	if (selection.enhance === 1) {
		return "enhancement";
	}
	return selection.transcribe === 1 ? "transcription" : null;
}

export function nextSelectedProcessingStep(selection: ProcessingSelection, currentStep: ProcessingStep): ProcessingStep | null {
	if (currentStep === "silence_removal") {
		if (selection.noise_removal === 1) {
			return "noise_removal";
		}
		if (selection.enhance === 1) {
			return "enhancement";
		}
		return selection.transcribe === 1 ? "transcription" : null;
	}

	if (currentStep === "noise_removal") {
		if (selection.enhance === 1) {
			return "enhancement";
		}
		return selection.transcribe === 1 ? "transcription" : null;
	}

	if (currentStep === "enhancement") {
		return selection.transcribe === 1 ? "transcription" : null;
	}

	return null;
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
