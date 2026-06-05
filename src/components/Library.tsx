import { Fragment } from 'react';
import type { PublicJob } from '../types';
import { downloadNameForJob, pipelineLabels, timeRemaining, transcriptNameForJob } from '../lib/format';
import { StatusBadge } from './StatusBadge';

function JobCard({ job, index }: { job: PublicJob; index: number }) {
	const labels = pipelineLabels(job);
	const hasDownloads = Boolean(job.downloadUrl || job.transcriptUrl);

	return (
		<article
			className="grid grid-cols-[1fr_auto] items-center gap-x-3 -mx-1 rounded-md px-2 py-3 transition-colors animate-row-in hover:bg-surface-2 [&:not(:first-child)]:shadow-[0_-1px_0_var(--border)] hover:shadow-none"
			style={{ animationDelay: `${index * 55}ms` }}
		>
			<div className="flex min-w-0 flex-col gap-[5px]">
				<div className="flex min-w-0 items-center gap-2">
					<div className="truncate text-[13.5px] font-medium text-fg" title={job.inputName}>
						{job.inputName}
					</div>
					<StatusBadge status={job.status} />
				</div>
				<div className="flex items-center gap-1.5 text-[11.5px] tabular-nums text-fg-3">
					{labels.length > 0 && (
						<>
							<span className="inline-flex shrink-0 items-center gap-1">
								{labels.map((label, i) => (
									<Fragment key={label}>
										{i > 0 && <span className="-mx-px text-fg-4">→</span>}
										<span>{label}</span>
									</Fragment>
								))}
							</span>
							<span className="-mx-px text-fg-4">·</span>
						</>
					)}
					<span>{timeRemaining(job.expiresAt)} left</span>
				</div>
			</div>

			{hasDownloads && (
				<div className="inline-flex shrink-0 items-center justify-end gap-1">
					{job.downloadUrl && (
						<a
							className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12.5px] font-medium text-accent transition-[background-color,transform] hover:bg-accent-soft active:scale-[0.96]"
							href={job.downloadUrl}
							download={downloadNameForJob(job)}
						>
							Audio
						</a>
					)}
					{job.transcriptUrl && (
						<a
							className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12.5px] font-medium text-accent transition-[background-color,transform] hover:bg-accent-soft active:scale-[0.96]"
							href={job.transcriptUrl}
							download={transcriptNameForJob(job)}
						>
							Transcript
						</a>
					)}
				</div>
			)}
		</article>
	);
}

export function Library({ jobs }: { jobs: PublicJob[] }) {
	return (
		<section className="mt-9 animate-step-in">
			<header className="mb-1 flex items-baseline justify-between border-b border-border px-1.5 pb-3">
				<h2 className="text-[13px] font-medium tracking-[-0.005em] text-fg-2">Recent</h2>
				<span className="font-mono text-[11px] font-medium text-fg-3">on this device</span>
			</header>
			<div className="flex flex-col">
				{jobs.length === 0 ? (
					<p className="py-7 text-center text-[13px] text-fg-3">No files yet. Your recent files show up here, just on this device.</p>
				) : (
					jobs.map((job, index) => <JobCard key={job.id} job={job} index={index} />)
				)}
			</div>
		</section>
	);
}
