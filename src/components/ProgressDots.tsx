import type { Step } from '../types';

const STEPS: Step[] = ['file', 'options', 'processing'];

interface ProgressDotsProps {
	step: Step;
	hasFile: boolean;
}

export function ProgressDots({ step, hasFile }: ProgressDotsProps) {
	const isPastOptions = STEPS.indexOf(step) > STEPS.indexOf('options');

	return (
		<div className="mb-[22px] flex gap-[5px]" aria-hidden="true">
			{STEPS.map((name) => {
				const active = name === step;
				let done = false;
				if (name === 'file') done = hasFile;
				else if (name === 'options') done = hasFile && isPastOptions;
				done = done && !active;

				return (
					<span
						key={name}
						className={[
							'h-1.5 rounded-full transition-all duration-[240ms] ease-smooth',
							active ? 'w-[22px] bg-accent' : done ? 'w-1.5 bg-fg-3' : 'w-1.5 bg-surface-3',
						].join(' ')}
					/>
				);
			})}
		</div>
	);
}
