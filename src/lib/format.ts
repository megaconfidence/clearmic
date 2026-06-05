import type { JobStatus, PublicJob } from '../types';

export function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function timeRemaining(expiresAt: string): string {
	const ms = new Date(expiresAt).getTime() - Date.now();
	if (!Number.isFinite(ms) || ms <= 0) return 'expired';
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
	return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function labelForType(mime: string, name: string): string {
	const lower = String(mime || '').toLowerCase();
	if (lower.includes('wav')) return 'WAV';
	if (lower.includes('mp3') || lower.includes('mpeg')) return 'MP3';
	if (lower.includes('m4a') || lower.includes('mp4')) return 'M4A';
	if (lower.includes('flac')) return 'FLAC';
	if (lower.includes('ogg')) return 'OGG';
	if (lower.includes('webm')) return 'WEBM';
	const ext = String(name || '')
		.split('.')
		.pop()
		?.toUpperCase();
	return ext || 'audio';
}

export function previewTranscript(text: string, maxSentences: number): { preview: string; truncated: boolean } {
	const trimmed = String(text).trim();
	if (!trimmed) {
		return { preview: '', truncated: false };
	}
	// Greedy match: non-terminator chars, then one or more terminators (.!?…), then whitespace or end.
	const matches = trimmed.match(/[^.!?…]+[.!?…]+(?:["'”’)]+)?(?=\s|$)/g);
	if (!matches || matches.length <= maxSentences) {
		return { preview: trimmed, truncated: false };
	}
	const preview = matches.slice(0, maxSentences).join(' ').replace(/\s+/g, ' ').trim();
	return { preview: `${preview} …`, truncated: true };
}

export function pipelineLabels(job: PublicJob): string[] {
	const labels: string[] = [];
	if (job.noiseRemovalRequested) labels.push('Noise');
	if (job.enhancementRequested) labels.push('Enhance');
	if (job.transcriptionRequested) labels.push('Transcript');
	return labels;
}

function safeBaseNameForJob(job: PublicJob): string {
	const base = String(job.inputName || 'audio').replace(/\.[^.]+$/, '') || 'audio';
	const safeBase = base
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 90);
	return safeBase || 'audio';
}

export function downloadNameForJob(job: PublicJob): string {
	return `${safeBaseNameForJob(job)}-cleaned.wav`;
}

export function transcriptNameForJob(job: PublicJob): string {
	return `${safeBaseNameForJob(job)}-transcript.txt`;
}

export function titleForStatus(status: JobStatus | string): string {
	if (status === 'completed') return 'Ready';
	if (status === 'failed') return 'Failed';
	if (status === 'canceled') return 'Canceled';
	if (status === 'queued') return 'Queued';
	return 'Processing';
}

export function subForJob(job: PublicJob, status: JobStatus | string): string {
	if (status === 'completed') return job.downloadUrl ? 'Preview below, then download.' : 'Transcript below.';
	if (status === 'failed') return 'Try again or pick a different file.';
	if (status === 'canceled') return 'Nothing was processed.';
	if (status === 'queued') return 'Lining up the engine.';
	if (job.processingStep === 'noise_removal') return 'Removing noise with Speech Enhancer.';
	if (job.processingStep === 'enhancement') return 'Enhancing voice detail with Resemble.';
	if (job.processingStep === 'transcription') return 'Transcribing the latest audio.';
	return 'Usually under a minute.';
}
