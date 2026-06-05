import type { ReactNode } from 'react';
import type { EnhancementPreset, PipelineOptions } from '../types';

interface OptionsStepProps {
	options: PipelineOptions;
	onChange: (patch: Partial<PipelineOptions>) => void;
	onBack: () => void;
	onContinue: () => void;
	busy: boolean;
}

const FOCUS_RING = 'focus-within:shadow-[inset_0_0_0_1.5px_var(--accent),0_0_0_3px_var(--accent-ring)]';
const PRESETS: EnhancementPreset[] = ['low', 'medium', 'high'];

function ToggleCard({
	checked,
	title,
	desc,
	onToggle,
	children,
}: {
	checked: boolean;
	title: string;
	desc: string;
	onToggle: (checked: boolean) => void;
	children?: ReactNode;
}) {
	return (
		<article
			className={`flex flex-col gap-2.5 rounded-lg p-3.5 transition-[background-color,box-shadow,transform] duration-200 ease-smooth ${FOCUS_RING} ${
				checked
					? 'bg-accent-soft -translate-y-px shadow-[inset_0_0_0_1.5px_var(--accent)]'
					: 'bg-surface shadow-[inset_0_0_0_1px_var(--border)] hover:bg-surface-2'
			}`}
		>
			<label className="block cursor-pointer">
				<input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
				<span className="flex min-w-0 flex-col gap-[3px]">
					<strong className="text-sm font-semibold tracking-[-0.005em] text-fg">{title}</strong>
					<span className={`text-xs leading-normal ${checked ? 'text-accent opacity-[0.78]' : 'text-fg-3'}`}>{desc}</span>
				</span>
			</label>
			{children}
		</article>
	);
}

export function OptionsStep({ options, onChange, onBack, onContinue, busy }: OptionsStepProps) {
	const hasSelection = options.noiseRemoval || options.enhance || options.transcribe;

	return (
		<section className="flex flex-col gap-[18px] animate-step-in step-in">
			<h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">Clean it up</h1>
			<p className="-mt-3.5 text-xs leading-normal text-fg-3">Pick one or more. We'll apply them in order, top to bottom.</p>

			<div className="flex flex-col gap-2.5">
				<ToggleCard
					checked={options.noiseRemoval}
					title="Noise removal"
					desc="Removes background hum, hiss, and street bleed."
					onToggle={(checked) => onChange({ noiseRemoval: checked })}
				/>

				<ToggleCard
					checked={options.enhance}
					title="Enhancement"
					desc="Brightens dull recordings and adds voice detail."
					onToggle={(checked) => onChange({ enhance: checked })}
				>
					{options.enhance && (
						<div className="mt-1 flex flex-col gap-2.5 rounded-sm bg-[var(--knob-bg)] p-3 shadow-[inset_0_0_0_1px_var(--knob-border)] animate-result-in">
							<div className="flex flex-col gap-2">
								<span className="text-xs font-medium text-fg-2">Strength</span>
								<div className="grid grid-cols-3 gap-1.5">
									{PRESETS.map((preset) => {
										const selected = options.enhancementPreset === preset;
										return (
											<label
												key={preset}
												className={`relative flex min-h-[34px] cursor-pointer items-center justify-center rounded-md p-2 text-xs font-medium capitalize transition-[background-color,color,box-shadow,transform] duration-200 ease-smooth active:scale-[0.96] ${FOCUS_RING} ${
													selected
														? 'bg-accent-soft -translate-y-px text-accent shadow-[inset_0_0_0_1.5px_var(--accent)]'
														: 'bg-surface text-fg shadow-[inset_0_0_0_1px_var(--border-2)] hover:bg-surface-2'
												}`}
											>
												<input
													type="radio"
													name="enhancement_preset"
													className="sr-only"
													checked={selected}
													onChange={() => onChange({ enhancementPreset: preset })}
												/>
												<span>{preset}</span>
											</label>
										);
									})}
								</div>
							</div>
						</div>
					)}
				</ToggleCard>

				<ToggleCard
					checked={options.transcribe}
					title="Transcription"
					desc="Writes out what was said and lets you download the text."
					onToggle={(checked) => onChange({ transcribe: checked })}
				/>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-xs font-medium text-fg-2">Delivery</span>
				<label
					className={`block cursor-pointer rounded-md p-3.5 transition-[background-color,box-shadow,transform] duration-200 ease-smooth ${FOCUS_RING} ${
						options.emailOnCompletion
							? 'bg-accent-soft -translate-y-px shadow-[inset_0_0_0_1.5px_var(--accent)]'
							: 'bg-surface-2 hover:bg-surface-3'
					}`}
				>
					<input
						type="checkbox"
						className="sr-only"
						checked={options.emailOnCompletion}
						onChange={(e) => onChange({ emailOnCompletion: e.target.checked })}
					/>
					<span className="flex min-w-0 flex-col gap-[3px]">
						<strong className="text-sm font-semibold tracking-[-0.005em] text-fg">Email me when it's done</strong>
						<span className={`text-xs leading-normal ${options.emailOnCompletion ? 'text-accent opacity-[0.78]' : 'text-fg-3'}`}>
							Sends 24-hour download links to your inbox.
						</span>
					</span>
				</label>
			</div>

			<div className="mt-1 flex items-center justify-between gap-2">
				<button className="btn btn-ghost" type="button" onClick={onBack} disabled={busy}>
					Back
				</button>
				<button className="btn btn-primary" type="button" onClick={onContinue} disabled={!hasSelection || busy}>
					Continue
				</button>
			</div>
		</section>
	);
}
