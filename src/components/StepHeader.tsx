import type { ReactNode } from 'react';

// Shared title + optional subtitle used at the top of every step so spacing and
// type sizing stay identical across the wizard.
export function StepHeader({ title, children }: { title: string; children?: ReactNode }) {
	return (
		<div className="flex flex-col gap-1">
			<h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">{title}</h1>
			{children ? <p className="text-xs leading-normal text-fg-3">{children}</p> : null}
		</div>
	);
}
