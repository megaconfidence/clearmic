import { useState } from 'react';
import type { PublicJob } from '../types';
import { downloadNameForJob, previewTranscript, subForJob, titleForStatus, timeRemaining, transcriptNameForJob } from '../lib/format';
import { DownloadIcon, TranscriptIcon } from './icons';
import { StatusBadge } from './StatusBadge';

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
			<h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">{titleForStatus(status)}</h1>
			<p className="-mt-3.5 text-xs leading-normal text-fg-3">{subForJob(job, status)}</p>

			<div className="flex flex-col overflow-hidden rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--border)]">
				<div className="flex items-center justify-between gap-3 px-3.5 py-[11px] text-[13px] [&:not(:last-child)]:shadow-[0_1px_0_var(--border)]">
					<span className="shrink-0 text-fg-2">Status</span>
					<StatusBadge status={status} />
				</div>
				<div className="flex items-center justify-between gap-3 px-3.5 py-[11px] text-[13px] [&:not(:last-child)]:shadow-[0_1px_0_var(--border)]">
					<span className="shrink-0 text-fg-2">File</span>
					<span className="min-w-0 truncate text-right text-fg" title={job.inputName}>
						{job.inputName}
					</span>
				</div>
				<div className="flex items-center justify-between gap-3 px-3.5 py-[11px] text-[13px]">
					<span className="shrink-0 text-fg-2">Expires</span>
					<span className="min-w-0 truncate text-right tabular-nums text-fg">{timeRemaining(job.expiresAt)}</span>
				</div>
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
							{transcriptPreview.truncated && <p className="mt-0.5 text-xs leading-normal text-fg-3">Download the transcript below for the full text.</p>}
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
						We'll email your download links the moment they're ready, then discard your address.
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
						<p className="text-xs leading-normal text-fg-3">
							We'll send your 24-hour links, then discard the address — <span className="text-fg-2">we don't store your email.</span>
						</p>
					</form>
				))}

			<div className="mt-1 flex items-center justify-between gap-2">
				<button className="btn btn-ghost" type="button" onClick={onReset} disabled={busy}>
					Clean another
				</button>
			</div>
		</section>
	);
}
