import { useEffect, useRef, useState } from 'react';
import type { PipelineOptions, PublicJob, Step } from './types';
import { addJobEmail, completeUpload, createUpload, getErrorMessage, getJob } from './lib/api';
import { useTheme } from './hooks/useTheme';
import { useRecents } from './hooks/useRecents';
import { useTurnstile } from './lib/turnstile';
import { Nav } from './components/Nav';
import { ProgressDots } from './components/ProgressDots';
import { FileStep } from './components/FileStep';
import { OptionsStep } from './components/OptionsStep';
import { ProcessingStep } from './components/ProcessingStep';
import { Library } from './components/Library';
import { ErrorBanner } from './components/ErrorBanner';

const TERMINAL_STATUSES = new Set<string>(['completed', 'failed', 'canceled']);
const ACTIVE_JOB_POLL_MS = 2500;
const SLOW_JOB_POLL_MS = 7500;
const POLL_BACKOFF_AFTER_MS = 60_000;

const DEFAULT_OPTIONS: PipelineOptions = {
	silenceRemoval: false,
	noiseRemoval: false,
	enhance: false,
	enhancementPreset: 'low',
	transcribe: false,
	transcriptFormat: 'txt',
	email: '',
};

export function App() {
	const { theme, toggle } = useTheme();
	const { getToken } = useTurnstile();
	const { recents, remember } = useRecents();

	const [step, setStep] = useState<Step>('file');
	const [file, setFile] = useState<File | null>(null);
	const [options, setOptions] = useState<PipelineOptions>(DEFAULT_OPTIONS);
	const [job, setJob] = useState<PublicJob | null>(null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	const pollTimer = useRef<number | undefined>(undefined);
	const activePollJobId = useRef('');
	const activePollStartedAt = useRef(0);
	const pollRef = useRef<(jobId: string) => void>(() => {});

	function applyJob(next: PublicJob) {
		setJob(next);
		setError(next.error || '');
	}

	// ----- polling -----

	function stopJobPolling() {
		if (pollTimer.current) clearTimeout(pollTimer.current);
		pollTimer.current = undefined;
		activePollJobId.current = '';
		activePollStartedAt.current = 0;
	}

	function scheduleNextPoll(jobId: string) {
		if (pollTimer.current) clearTimeout(pollTimer.current);
		if (document.hidden || jobId !== activePollJobId.current) return;
		const elapsed = Date.now() - activePollStartedAt.current;
		const delay = elapsed >= POLL_BACKOFF_AFTER_MS ? SLOW_JOB_POLL_MS : ACTIVE_JOB_POLL_MS;
		pollTimer.current = window.setTimeout(() => pollRef.current(jobId), delay);
	}

	async function poll(jobId: string) {
		if (document.hidden || jobId !== activePollJobId.current) return;
		try {
			const { job: next } = await getJob(jobId);
			if (jobId !== activePollJobId.current) return;
			applyJob(next);
			if (TERMINAL_STATUSES.has(next.status)) {
				stopJobPolling();
				setBusy(false);
				remember(next);
				return;
			}
			scheduleNextPoll(jobId);
		} catch (err) {
			stopJobPolling();
			setError(getErrorMessage(err));
			setBusy(false);
		}
	}
	pollRef.current = poll;

	function startJobPolling(jobId: string) {
		stopJobPolling();
		activePollJobId.current = jobId;
		activePollStartedAt.current = Date.now();
		pollRef.current(jobId);
	}

	// ----- upload -----

	async function uploadSelectedFile() {
		setError('');
		setBusy(true);
		stopJobPolling();
		try {
			if (!file) throw new Error('Choose an audio file first.');
			if (!options.silenceRemoval && !options.noiseRemoval && !options.enhance && !options.transcribe) {
				throw new Error('Select at least one processing step.');
			}

			// Bot check happens here, invisibly, right before the expensive call.
			const turnstileToken = await getToken();
			const { upload } = await createUpload({ fileName: file.name, fileType: file.type, fileSize: file.size, options, turnstileToken });

			const putResponse = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file });
			if (!putResponse.ok) throw new Error('Direct upload to storage failed.');

			const { job: created } = await completeUpload(upload.id);
			applyJob(created);
			setStep('processing');
			startJobPolling(created.id);
		} catch (err) {
			setError(getErrorMessage(err));
			setBusy(false);
		}
	}

	// ----- navigation -----

	function resetFlow() {
		stopJobPolling();
		setBusy(false);
		setError('');
		setFile(null);
		setJob(null);
		setOptions(DEFAULT_OPTIONS);
		setStep('file');
	}

	function fileContinue() {
		setError('');
		if (!file) {
			setError('Choose an audio file first.');
			return;
		}
		setStep('options');
	}

	function optionsContinue() {
		setError('');
		if (!(options.silenceRemoval || options.noiseRemoval || options.enhance || options.transcribe)) {
			setError('Select at least one processing step.');
			return;
		}
		void uploadSelectedFile();
	}

	// Attach an email after processing has started (for users who skipped it).
	// Throws on failure so the form can surface the message.
	async function addEmail(emailAddress: string) {
		if (!job) return;
		const { job: updated } = await addJobEmail(job.id, emailAddress);
		applyJob(updated);
	}

	// ----- effects -----

	useEffect(() => {
		const onVisibility = () => {
			if (!activePollJobId.current) return;
			if (pollTimer.current) clearTimeout(pollTimer.current);
			if (!document.hidden) pollRef.current(activePollJobId.current);
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => document.removeEventListener('visibilitychange', onVisibility);
	}, []);

	useEffect(() => {
		return () => {
			if (pollTimer.current) clearTimeout(pollTimer.current);
		};
	}, []);

	return (
		<>
			<Nav theme={theme} onToggleTheme={toggle} />
			<main className="mx-auto max-w-[460px] px-6 pt-6 pb-[72px] max-[480px]:px-4 max-[480px]:pb-12">
				<section className="rounded-xl border border-border bg-surface p-7 shadow-[var(--shadow-card)] max-[480px]:rounded-lg max-[480px]:p-[22px]">
					<ProgressDots step={step} hasFile={Boolean(file)} />

					{step === 'file' && <FileStep file={file} onFile={setFile} onContinue={fileContinue} busy={busy} />}

					{step === 'options' && (
						<OptionsStep
							options={options}
							onChange={(patch) => setOptions((prev) => ({ ...prev, ...patch }))}
							onBack={() => setStep('file')}
							onContinue={optionsContinue}
							busy={busy}
						/>
					)}

					{step === 'processing' && job && <ProcessingStep job={job} busy={busy} onReset={resetFlow} onAddEmail={addEmail} />}

					<ErrorBanner message={error} />
				</section>

				<Library jobs={recents} />
			</main>
		</>
	);
}
