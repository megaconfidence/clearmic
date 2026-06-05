import { useEffect, useRef, useState } from 'react';
import type { PipelineOptions, PublicJob, Quota, Step, User } from './types';
import {
	completeUpload,
	createUpload,
	getConfig,
	getErrorMessage,
	getJob,
	getMe,
	listJobs,
	logout,
	requestOtp,
	verifyOtp,
} from './lib/api';
import { useTheme } from './hooks/useTheme';
import { Nav } from './components/Nav';
import { ProgressDots } from './components/ProgressDots';
import { FileStep } from './components/FileStep';
import { OptionsStep } from './components/OptionsStep';
import { AuthStep } from './components/AuthStep';
import { ProcessingStep } from './components/ProcessingStep';
import { Library } from './components/Library';
import { ErrorBanner } from './components/ErrorBanner';

const TERMINAL_STATUSES = new Set<string>(['completed', 'failed', 'canceled']);
const ACTIVE_JOB_POLL_MS = 2500;
const SLOW_JOB_POLL_MS = 7500;
const POLL_BACKOFF_AFTER_MS = 60_000;
const JOB_LIST_REFRESH_MS = 30_000;

const DEFAULT_OPTIONS: PipelineOptions = {
	noiseRemoval: false,
	enhance: false,
	enhancementPreset: 'medium',
	transcribe: false,
	emailOnCompletion: false,
};

export function App() {
	const { theme, toggle } = useTheme();

	const [user, setUser] = useState<User | null>(null);
	const [quota, setQuota] = useState<Quota | null>(null);
	const [step, setStep] = useState<Step>('file');
	const [file, setFile] = useState<File | null>(null);
	const [options, setOptions] = useState<PipelineOptions>(DEFAULT_OPTIONS);
	const [email, setEmail] = useState('');
	const [siteKey, setSiteKey] = useState<string | null>(null);
	const [job, setJob] = useState<PublicJob | null>(null);
	const [jobs, setJobs] = useState<PublicJob[]>([]);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	const pollTimer = useRef<number | undefined>(undefined);
	const activePollJobId = useRef('');
	const activePollStartedAt = useRef(0);
	const lastJobListRefreshAt = useRef(0);
	const pollRef = useRef<(jobId: string) => void>(() => {});

	// ----- data loaders -----

	async function loadJobs() {
		const payload = await listJobs();
		setJobs(payload.jobs || []);
		setQuota(payload.quota);
		lastJobListRefreshAt.current = Date.now();
	}

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

	async function refreshJobListIfStale(force = false) {
		if (force || Date.now() - lastJobListRefreshAt.current >= JOB_LIST_REFRESH_MS) {
			try {
				await loadJobs();
			} catch (err) {
				console.error('Recent jobs refresh failed', err);
			}
		}
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
				await refreshJobListIfStale(true);
				return;
			}
			await refreshJobListIfStale();
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
			if (!options.noiseRemoval && !options.enhance && !options.transcribe) {
				throw new Error('Select at least one processing step.');
			}

			const { upload } = await createUpload({ fileName: file.name, fileType: file.type, fileSize: file.size, options });

			const putResponse = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file });
			if (!putResponse.ok) throw new Error('Direct upload to storage failed.');

			const { job: created } = await completeUpload(upload.id);
			applyJob(created);
			setStep('processing');
			await loadJobs();
			startJobPolling(created.id);
		} catch (err) {
			setError(getErrorMessage(err));
			setBusy(false);
		}
	}

	// ----- auth -----

	async function handleRequestOtp(emailValue: string, turnstileToken: string): Promise<boolean> {
		setError('');
		setBusy(true);
		try {
			await requestOtp(emailValue, turnstileToken);
			return true;
		} catch (err) {
			setError(getErrorMessage(err));
			return false;
		} finally {
			setBusy(false);
		}
	}

	async function handleVerify(emailValue: string, code: string): Promise<void> {
		setError('');
		setBusy(true);
		try {
			const { user: verifiedUser } = await verifyOtp(emailValue, code);
			setUser(verifiedUser);
			if (file) {
				await uploadSelectedFile();
			} else {
				await loadJobs();
				setStep('file');
				setBusy(false);
			}
		} catch (err) {
			setError(getErrorMessage(err));
			setBusy(false);
		}
	}

	async function handleLogout() {
		stopJobPolling();
		try {
			await logout();
		} catch {
			// best effort — clear local state regardless
		}
		setUser(null);
		setQuota(null);
		setJobs([]);
		lastJobListRefreshAt.current = 0;
		setFile(null);
		setJob(null);
		setOptions(DEFAULT_OPTIONS);
		setEmail('');
		setError('');
		setBusy(false);
		setStep('file');
	}

	// ----- navigation -----

	function resetFlow() {
		stopJobPolling();
		setBusy(false);
		setError('');
		setFile(null);
		setJob(null);
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
		if (!(options.noiseRemoval || options.enhance || options.transcribe)) {
			setError('Select at least one processing step.');
			return;
		}
		if (user) {
			void uploadSelectedFile();
			return;
		}
		setStep('auth');
	}

	function handleSignIn() {
		setError('');
		setStep('auth');
	}

	// ----- effects -----

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const me = await getMe();
				if (cancelled) return;
				setUser(me.user);
				setQuota(me.quota);
				if (me.user) {
					const jobsPayload = await listJobs();
					if (cancelled) return;
					setJobs(jobsPayload.jobs || []);
					setQuota(jobsPayload.quota);
					lastJobListRefreshAt.current = Date.now();
				}
			} catch (err) {
				if (!cancelled) setError(getErrorMessage(err));
			}
			try {
				const cfg = await getConfig();
				if (!cancelled) setSiteKey(cfg.turnstileSiteKey);
			} catch {
				// Turnstile config unavailable; AuthStep surfaces the error state.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

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
			<Nav
				user={user}
				quota={quota}
				theme={theme}
				busy={busy}
				onToggleTheme={toggle}
				onSignIn={handleSignIn}
				onSignOut={() => void handleLogout()}
			/>
			<main className="mx-auto max-w-[460px] px-6 pt-6 pb-[72px] max-[480px]:px-4 max-[480px]:pb-12">
				<section className="rounded-xl border border-border bg-surface p-7 shadow-[var(--shadow-card)] max-[480px]:rounded-lg max-[480px]:p-[22px]">
					<ProgressDots step={step} hasFile={Boolean(file)} hasUser={Boolean(user)} />

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

					{step === 'auth' && (
						<AuthStep
							siteKey={siteKey}
							theme={theme}
							hasFile={Boolean(file)}
							busy={busy}
							email={email}
							onEmailChange={setEmail}
							onBack={() => setStep(file ? 'options' : 'file')}
							onRequestOtp={handleRequestOtp}
							onVerify={handleVerify}
							setError={setError}
						/>
					)}

					{step === 'processing' && job && <ProcessingStep job={job} busy={busy} onReset={resetFlow} />}

					<ErrorBanner message={error} />
				</section>

				{user && <Library jobs={jobs} />}
			</main>
		</>
	);
}
