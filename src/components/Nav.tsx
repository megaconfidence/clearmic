import type { Quota, User } from '../types';
import type { Theme } from '../hooks/useTheme';
import { MoonIcon, SunIcon } from './icons';

interface NavProps {
	user: User | null;
	quota: Quota | null;
	theme: Theme;
	busy: boolean;
	onToggleTheme: () => void;
	onSignIn: () => void;
	onSignOut: () => void;
}

export function Nav({ user, quota, theme, busy, onToggleTheme, onSignIn, onSignOut }: NavProps) {
	const remaining = quota ? Math.max(0, quota.limit - quota.used) : 0;
	const quotaState = remaining === 0 ? 'empty' : remaining <= 2 ? 'low' : 'ok';
	const quotaColor =
		quotaState === 'empty' ? 'bg-err-soft text-err' : quotaState === 'low' ? 'bg-amber-soft text-amber' : 'bg-accent-soft text-accent';

	return (
		<nav className="mx-auto flex max-w-[920px] items-center justify-between px-6 py-[18px] max-[480px]:px-5 max-[480px]:py-4">
			<a className="group inline-flex items-center gap-2.5 text-sm font-semibold tracking-[-0.01em] text-fg" href="/" aria-label="ClearMic home">
				<img
					className="block h-[22px] w-[22px] shrink-0 rounded-full outline outline-1 -outline-offset-1 [outline-color:var(--mark-outline)] shadow-[0_1px_2px_rgba(55,60,255,0.22)] transition-transform duration-300 ease-spring group-hover:-rotate-2 group-hover:scale-[1.04] group-active:scale-[0.96]"
					src="/icon.svg"
					alt=""
					width={22}
					height={22}
				/>
				<span>ClearMic</span>
			</a>

			<div className="inline-flex items-center gap-3.5 max-[480px]:gap-2">
				{user && quota && (
					<div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-xs font-medium animate-quota-in ${quotaColor}`} aria-live="polite">
						<span className="font-semibold tabular-nums">{remaining}</span>
						<span className="opacity-85 max-[600px]:hidden">left today</span>
					</div>
				)}

				<button className="icon-btn" type="button" aria-label="Switch theme" title="Switch theme" onClick={onToggleTheme}>
					{theme === 'dark' ? <MoonIcon className="h-[15px] w-[15px]" /> : <SunIcon className="h-[15px] w-[15px]" />}
				</button>

				<div className="inline-flex min-h-8 items-center gap-3 text-[13px]">
					{user ? (
						<>
							<span className="max-w-[220px] truncate text-fg-2 max-[480px]:max-w-[120px] max-[480px]:text-xs">{user.email}</span>
							<button className="link" type="button" onClick={onSignOut} disabled={busy}>
								Sign out
							</button>
						</>
					) : (
						<button className="link" type="button" onClick={onSignIn}>
							Sign in
						</button>
					)}
				</div>
			</div>
		</nav>
	);
}
