import { useState } from 'react';
import type { PublicJob } from '../types';
import { downloadNameForJob, previewTranscript, subForJob, timeRemaining, titleForStatus, transcriptNameForJob } from '../lib/format';
import { DownloadIcon, TranscriptIcon, WaveIcon } from './icons';
import { StatusBadge } from './StatusBadge';
import { StepHeader } from './StepHeader';

interface ProcessingStepProps {
	job: PublicJob;
	busy: boolean;
	onReset: () => void;
	onAddEmail: (email: string) => Promise<void>;
}

export function ProcessingStep({ job, busy, onReset, onAddEmail }: ProcessingStepProps) {
	const status = String(job.status || 'pending').toLowerCase();
	const hasResult = Boolean(job.downloadUrl || job.transcript || job.transcriptUrl);
	const transcriptIsPrimary = Boolean(job.transcriptUrl) && !job.downloadUrl;
	const transcriptPreview = job.transcript ? previewTranscript(job.transcript, 3) : null;
	const canAddEmail = status !== 'failed' && status !== 'canceled';

	const [email, setEmail] = useState('');
	const [emailBusy, setEmailBusy] = useState(false);
	const [emailError, setEmailError] = useState('');

	async function submitEmail(e: React.FormEvent) {
		e.preventDefault();
		setEmailError('');
		setEmailBusy(true);
		try {
			await onAddEmail(email.trim());
			setEmail('');
		} catch (err) {
			setEmailError(err instanceof Error ? err.message : 'Could not save your email.');
		} finally {
			setEmailBusy(false);
		}
	}

	return (
		<section className="flex flex-col gap-[18px] animate-step-in step-in">
			<StepHeader title={titleForStatus(status)}>{subForJob(job, status)}</StepHeader>

			{/* File, expiry, and live status folded into one chip. */}
			<div className="flex items-center gap-3 rounded-lg bg-surface-2 p-2.5 shadow-[inset_0_0_0_1px_var(--border)]">
				<span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent">
					<WaveIcon className="h-[18px] w-[18px]" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<strong className="truncate text-[13px] font-medium text-fg" title={job.inputName}>
						{job.inputName}
					</strong>
					<span className="text-[11px] tabular-nums text-fg-3">Expires in {timeRemaining(job.expiresAt)}</span>
				</div>
				<StatusBadge status={status} />
			</div>

			{hasResult && (
				<div className="flex flex-col gap-2.5 animate-result-in">
					{job.downloadUrl && <audio className="player block h-10 w-full rounded-md" controls preload="metadata" src={job.downloadUrl} />}

					{transcriptPreview && (
						<div className="flex flex-col gap-2 rounded-md bg-surface-2 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--border)]">
							<div className="flex items-center gap-2 text-fg-2">
								<TranscriptIcon className="h-[13px] w-[13px] text-fg-3" />
								<span className="text-xs font-medium">Transcript preview</span>
							</div>
							<p className="text-[12.5px] leading-[1.55] text-fg-2">{transcriptPreview.preview}</p>
							{transcriptPreview.truncated && <p className="mt-0.5 text-xs leading-normal text-fg-3">Full text in the download below.</p>}
						</div>
					)}

					<div className="mt-0.5 flex flex-col gap-1.5">
						{job.downloadUrl && (
							<a className="btn btn-primary btn-block" href={job.downloadUrl} download={downloadNameForJob(job)}>
								<DownloadIcon className="h-3.5 w-3.5" />
								Download audio
							</a>
						)}
						{job.transcriptUrl && (
							<a
								className={`btn btn-block ${transcriptIsPrimary ? 'btn-primary' : 'btn-ghost'}`}
								href={job.transcriptUrl}
								download={transcriptNameForJob(job)}
							>
								<DownloadIcon className="h-3.5 w-3.5" />
								Download transcript
							</a>
						)}
					</div>
				</div>
			)}

			{canAddEmail &&
				(job.emailRequested ? (
					<p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-xs leading-normal text-fg-2 shadow-[inset_0_0_0_1px_var(--border)] animate-result-in">
						We'll email your links the moment they're ready, then forget your address.
					</p>
				) : (
					<form className="flex flex-col gap-2" onSubmit={submitEmail}>
						<span className="text-xs font-medium text-fg-2">
							{status === 'completed' ? 'Email me the links' : 'Email me when it’s done'} <span className="font-normal text-fg-3">· optional</span>
						</span>
						<div className="flex items-center gap-1.5">
							<input
								className="input flex-1"
								type="email"
								name="email"
								inputMode="email"
								autoComplete="email"
								placeholder="you@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								disabled={emailBusy}
							/>
							<button className="btn btn-ghost shrink-0" type="submit" disabled={emailBusy || !email.trim()}>
								{emailBusy ? 'Saving…' : 'Notify me'}
							</button>
						</div>
						{emailError && <p className="text-xs leading-normal text-err">{emailError}</p>}
						<p className="text-[11px] leading-normal text-fg-3">We send the 24-hour links, then forget your address.</p>
					</form>
				))}

			<button className="btn btn-ghost btn-block mt-1" type="button" onClick={onReset} disabled={busy}>
				Clean another
			</button>
		</section>
	);
}
