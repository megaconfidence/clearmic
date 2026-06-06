import type { Theme } from '../hooks/useTheme';
import { MoonIcon, SunIcon } from './icons';

interface NavProps {
	theme: Theme;
	onToggleTheme: () => void;
}

export function Nav({ theme, onToggleTheme }: NavProps) {
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

			<button className="icon-btn" type="button" aria-label="Switch theme" title="Switch theme" onClick={onToggleTheme}>
				{theme === 'dark' ? <MoonIcon className="h-[15px] w-[15px]" /> : <SunIcon className="h-[15px] w-[15px]" />}
			</button>
		</nav>
	);
}
