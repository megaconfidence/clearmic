import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { AdminStats } from '../types';
import { ApiError, getAdminStats, getErrorMessage } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useTheme } from '../hooks/useTheme';
import { MoonIcon, SunIcon } from '../components/icons';
import { ErrorBanner } from '../components/ErrorBanner';

// The passphrase IS the credential (auth.md Part B). Persist it so the operator
// stays unlocked across restarts; clear it on a 401 (e.g. the secret rotated).
const PASS_KEY = 'clearmic.admin.passphrase';

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
	return (
		<div className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
			<div className="text-xs font-medium text-fg-2">{label}</div>
			<div className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">{value}</div>
			{sub && <div className="mt-1.5 text-xs text-fg-3">{sub}</div>}
		</div>
	);
}

function SectionTitle({ children }: { children: ReactNode }) {
	return <h2 className="mb-3 border-b border-border px-1 pb-2 text-[13px] font-medium tracking-[-0.005em] text-fg-2">{children}</h2>;
}

function StatusStat({ label, value, color }: { label: string; value: number; color: string }) {
	return (
		<div className="rounded-md bg-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--border)]">
			<div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
			<div className="mt-0.5 text-[11.5px] capitalize text-fg-3">{label}</div>
		</div>
	);
}

function UsageBar({ label, count, total }: { label: string; count: number; total: number }) {
	const pct = total > 0 ? Math.round((count / total) * 100) : 0;
	return (
		<div>
			<div className="flex items-baseline justify-between text-xs">
				<span className="text-fg-2">{label}</span>
				<span className="tabular-nums text-fg-3">
					{count} · {pct}%
				</span>
			</div>
			<div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
				<div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out-expo" style={{ width: `${pct}%` }} />
			</div>
		</div>
	);
}

export function Admin() {
	const { theme, toggle } = useTheme();
	const [passphrase, setPassphrase] = useState('');
	const [unlocked, setUnlocked] = useState(false);
	const [stats, setStats] = useState<AdminStats | null>(null);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	const load = useCallback(async (pass: string) => {
		setLoading(true);
		setError('');
		try {
			const data = await getAdminStats(pass);
			setStats(data);
			setUnlocked(true);
			try {
				localStorage.setItem(PASS_KEY, pass);
			} catch {
				// localStorage unavailable — operator just re-enters next time.
			}
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				setUnlocked(false);
				setStats(null);
				try {
					localStorage.removeItem(PASS_KEY);
				} catch {
					// ignore
				}
				setError('Incorrect or expired passphrase.');
			} else {
				setError(getErrorMessage(err));
			}
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		let stored = '';
		try {
			stored = localStorage.getItem(PASS_KEY) || '';
		} catch {
			stored = '';
		}
		if (stored) {
			setPassphrase(stored);
			void load(stored);
		}
	}, [load]);

	function onSubmit(event: FormEvent) {
		event.preventDefault();
		const value = passphrase.trim();
		if (value) void load(value);
	}

	function lock() {
		try {
			localStorage.removeItem(PASS_KEY);
		} catch {
			// ignore
		}
		setUnlocked(false);
		setStats(null);
		setPassphrase('');
		setError('');
	}

	const allTime = stats?.allTime;
	const live = stats?.live;
	const completionRate = allTime && allTime.jobs > 0 ? Math.round((allTime.completed / allTime.jobs) * 100) : 0;
	const optInRate = allTime && allTime.jobs > 0 ? Math.round((allTime.emailOptIn / allTime.jobs) * 100) : 0;
	const since = stats?.statsSince ? new Date(stats.statsSince).toLocaleDateString() : null;

	return (
		<div className="min-h-screen">
			<header className="mx-auto flex max-w-[960px] items-center justify-between px-6 py-[18px] max-[480px]:px-5">
				<div className="inline-flex items-center gap-2.5">
					<img
						className="block h-[22px] w-[22px] shrink-0 rounded-full outline outline-1 -outline-offset-1 [outline-color:var(--mark-outline)] shadow-[0_1px_2px_rgba(55,60,255,0.22)]"
						src="/icon.svg"
						alt=""
						width={22}
						height={22}
					/>
					<span className="text-sm font-semibold tracking-[-0.01em] text-fg">ClearMic</span>
					<span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Admin</span>
				</div>
				<div className="inline-flex items-center gap-3.5">
					<button className="icon-btn" type="button" aria-label="Switch theme" title="Switch theme" onClick={toggle}>
						{theme === 'dark' ? <MoonIcon className="h-[15px] w-[15px]" /> : <SunIcon className="h-[15px] w-[15px]" />}
					</button>
					{unlocked && (
						<button className="link" type="button" onClick={lock}>
							Lock
						</button>
					)}
					<a className="link" href="/">
						Back to app
					</a>
				</div>
			</header>

			<main className="mx-auto max-w-[960px] px-6 pb-20 max-[480px]:px-5">
				{!unlocked ? (
					<div className="mx-auto mt-[10vh] max-w-[360px]">
						<div className="rounded-xl border border-border bg-surface p-7 shadow-[var(--shadow-card)]">
							<h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">Admin access</h1>
							<p className="mt-1.5 text-xs leading-normal text-fg-3">Enter the operator passphrase to view usage stats.</p>
							<form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
								<input
									className="input"
									type="password"
									name="admin-passphrase"
									autoComplete="current-password"
									placeholder="Passphrase"
									value={passphrase}
									onChange={(e) => setPassphrase(e.target.value)}
									autoFocus
								/>
								<button className="btn btn-primary btn-block" type="submit" disabled={loading || !passphrase.trim()}>
									{loading ? 'Checking…' : 'Unlock'}
								</button>
							</form>
							<div className="mt-4">
								<ErrorBanner message={error} />
							</div>
						</div>
					</div>
				) : (
					<>
						<div className="mb-6 mt-2 flex items-end justify-between gap-3">
							<div>
								<h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Usage</h1>
								<p className="mt-1 text-xs text-fg-3">
									{stats ? `Updated ${new Date(stats.generatedAt).toLocaleString()}` : 'Loading…'}
									{since ? ` · since ${since}` : ''}
								</p>
							</div>
							<button className="btn btn-ghost" type="button" onClick={() => void load(passphrase)} disabled={loading}>
								{loading ? 'Refreshing…' : 'Refresh'}
							</button>
						</div>

						<ErrorBanner message={error} />

						{stats && allTime && live && (
							<div className="flex flex-col gap-7 animate-step-in">
								<section>
									<SectionTitle>Overview</SectionTitle>
									<div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
										<Stat label="Jobs all-time" value={allTime.jobs} sub={`${live.jobs} active now`} />
										<Stat label="Completion rate" value={`${completionRate}%`} sub={`${allTime.completed} of ${allTime.jobs}`} />
										<Stat label="Audio processed" value={formatBytes(allTime.inputBytes)} sub={`avg ${formatBytes(allTime.avgInputBytes)}`} />
										<Stat label="Email opt-in" value={allTime.emailOptIn} sub={`${optInRate}% of jobs`} />
									</div>
								</section>

								<section>
									<SectionTitle>Outcomes · all-time</SectionTitle>
									<div className="grid grid-cols-3 gap-3">
										<StatusStat label="completed" value={allTime.completed} color="text-ok" />
										<StatusStat label="failed" value={allTime.failed} color="text-err" />
										<StatusStat label="canceled" value={allTime.canceled} color="text-fg-2" />
									</div>
								</section>

								<section>
									<SectionTitle>Pipeline usage · all-time</SectionTitle>
									<div className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
										<UsageBar label="Silence removal" count={allTime.steps.silenceRemoval} total={allTime.jobs} />
										<UsageBar label="Noise removal" count={allTime.steps.noiseRemoval} total={allTime.jobs} />
										<UsageBar label="Enhancement" count={allTime.steps.enhancement} total={allTime.jobs} />
										<UsageBar label="Transcription" count={allTime.steps.transcription} total={allTime.jobs} />
									</div>
								</section>

								<section>
									<SectionTitle>Live · last 24h</SectionTitle>
									<div className="grid grid-cols-2 gap-3 min-[560px]:grid-cols-3 min-[720px]:grid-cols-5">
										<StatusStat label="queued" value={live.byStatus.queued} color="text-amber" />
										<StatusStat label="processing" value={live.byStatus.processing} color="text-accent" />
										<StatusStat label="completed" value={live.byStatus.completed} color="text-ok" />
										<StatusStat label="failed" value={live.byStatus.failed} color="text-err" />
										<StatusStat label="canceled" value={live.byStatus.canceled} color="text-fg-2" />
									</div>
									<p className="mt-3 text-xs tabular-nums text-fg-3">
										{stats.uploads.pending} pending upload{stats.uploads.pending === 1 ? '' : 's'} · limit {stats.dailyJobLimit}/IP/day
									</p>
								</section>
							</div>
						)}

						{loading && !stats && <p className="py-16 text-center text-sm text-fg-3">Loading usage…</p>}
					</>
				)}
			</main>
		</div>
	);
}
