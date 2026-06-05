import { useCallback, useEffect, useState } from 'react';
import type { PublicJob } from '../types';

// Device-local "recent files" — no account, no server history. We keep a small
// list of finished jobs (id + tokenized download links) in localStorage so a
// user can re-grab their results on this device until the 24h expiry.
const STORAGE_KEY = 'clearmic.recents.v1';
const MAX_RECENTS = 20;

function isActive(job: PublicJob): boolean {
	return new Date(job.expiresAt).getTime() > Date.now();
}

function read(): PublicJob[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return (parsed as PublicJob[]).filter((job) => job && typeof job.id === 'string' && isActive(job));
	} catch {
		return [];
	}
}

function write(jobs: PublicJob[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
	} catch {
		// localStorage unavailable (privacy mode/quota) — recents just won't persist.
	}
}

export function useRecents() {
	const [recents, setRecents] = useState<PublicJob[]>([]);

	useEffect(() => {
		setRecents(read());
	}, []);

	const remember = useCallback((job: PublicJob) => {
		setRecents((prev) => {
			// Don't persist transcript text on the device; the tokenized link is enough.
			const snapshot: PublicJob = { ...job, transcript: null };
			const next = [snapshot, ...prev.filter((entry) => entry.id !== job.id)].filter(isActive).slice(0, MAX_RECENTS);
			write(next);
			return next;
		});
	}, []);

	return { recents, remember };
}
