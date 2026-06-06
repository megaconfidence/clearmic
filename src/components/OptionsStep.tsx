import type { ReactNode } from 'react';
import type { EnhancementPreset, PipelineOptions, TranscriptFormat } from '../types';
import { CheckIcon } from './icons';
import { StepHeader } from './StepHeader';

interface OptionsStepProps {
	options: PipelineOptions;
	onChange: (patch: Partial<PipelineOptions>) => void;
	onBack: () => void;
	onContinue: () => void;
	busy: boolean;
}

const FOCUS_RING = 'focus-within:shadow-[inset_0_0_0_1.5px_var(--accent),0_0_0_3px_var(--accent-ring)]';

const PRESETS: { value: EnhancementPreset; label: string }[] = [
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
];

const TRANSCRIPT_FORMATS: { value: TranscriptFormat; label: string; hint: string }[] = [
	{ value: 'txt', label: 'Text', hint: '.txt' },
	{ value: 'srt', label: 'SRT', hint: 'Subtitles' },
	{ value: 'vtt', label: 'VTT', hint: 'Captions' },
];

// A compact iOS-style segmented control. The active choice lifts to a white
// pill; the label is supplied via aria-label so no extra visible caption is
// needed (the parent option already names it).
function Segmented<T extends string>({
	ariaLabel,
	name,
	value,
	options,
	onChange,
}: {
	ariaLabel: string;
	name: string;
	value: T;
	options: { value: T; label: string; hint?: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-3 gap-1 rounded-md bg-[var(--knob-bg)] p-1 shadow-[inset_0_0_0_1px_var(--knob-border)]">
			{options.map((opt) => {
				const selected = value === opt.value;
				return (
					<label
						key={opt.value}
						className={`flex min-h-[34px] cursor-pointer flex-col items-center justify-center gap-px rounded-[5px] px-1 text-center transition-[background-color,color,box-shadow,transform] duration-200 ease-smooth active:scale-[0.96] ${FOCUS_RING} ${
							selected ? 'bg-surface text-accent shadow-[inset_0_0_0_1px_var(--accent),0_1px_2px_rgba(15,15,15,0.12)]' : 'text-fg-2 hover:text-fg'
						}`}
					>
						<input type="radio" name={name} className="sr-only" checked={selected} onChange={() => onChange(opt.value)} />
						<span className="text-xs font-semibold leading-none">{opt.label}</span>
						{opt.hint && <span className={`text-[10.5px] leading-none ${selected ? 'text-accent opacity-70' : 'text-fg-3'}`}>{opt.hint}</span>}
					</label>
				);
			})}
		</div>
	);
}

function Option({
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
		<div
			className={`rounded-lg transition-[background-color,box-shadow] duration-200 ease-smooth ${FOCUS_RING} ${
				checked ? 'bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]' : 'bg-surface shadow-[inset_0_0_0_1px_var(--border)] hover:bg-surface-2'
			}`}
		>
			<label className="flex cursor-pointer items-start gap-3 p-3">
				<input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
				<span
					className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] transition-[background-color,box-shadow] duration-200 ease-smooth ${
						checked ? 'bg-accent text-white shadow-[0_1px_2px_rgba(55,60,255,0.3)]' : 'bg-surface shadow-[inset_0_0_0_1.5px_var(--border-2)]'
					}`}
				>
					{checked && <CheckIcon className="h-[11px] w-[11px]" />}
				</span>
				<span className="flex min-w-0 flex-col gap-0.5">
					<strong className="text-sm font-semibold tracking-[-0.005em] text-fg">{title}</strong>
					<span className={`text-xs leading-snug ${checked ? 'text-accent opacity-80' : 'text-fg-3'}`}>{desc}</span>
				</span>
			</label>
			{children && <div className="-mt-1 pr-3 pb-3 pl-[42px] animate-result-in">{children}</div>}
		</div>
	);
}

export function OptionsStep({ options, onChange, onBack, onContinue, busy }: OptionsStepProps) {
	const hasSelection = options.silenceRemoval || options.noiseRemoval || options.enhance || options.transcribe;

	return (
		<section className="flex flex-col gap-[18px] animate-step-in step-in">
			<StepHeader title="Clean it up">Pick one or more.</StepHeader>

			<div className="flex flex-col gap-2">
				<Option
					checked={options.silenceRemoval}
					title="Silence removal"
					desc="Trim silent gaps and dead air."
					onToggle={(checked) => onChange({ silenceRemoval: checked })}
				/>

				<Option
					checked={options.noiseRemoval}
					title="Noise removal"
					desc="Remove background hum, hiss, and bleed."
					onToggle={(checked) => onChange({ noiseRemoval: checked })}
				/>

				<Option
					checked={options.enhance}
					title="Enhancement"
					desc="Brighten and add voice detail."
					onToggle={(checked) => onChange({ enhance: checked })}
				>
					{options.enhance && (
						<Segmented
							ariaLabel="Enhancement strength"
							name="enhancement_preset"
							value={options.enhancementPreset}
							options={PRESETS}
							onChange={(value) => onChange({ enhancementPreset: value })}
						/>
					)}
				</Option>

				<Option
					checked={options.transcribe}
					title="Transcription"
					desc="Write out the words as text or subtitles."
					onToggle={(checked) => onChange({ transcribe: checked })}
				>
					{options.transcribe && (
						<Segmented
							ariaLabel="Transcript format"
							name="transcript_format"
							value={options.transcriptFormat}
							options={TRANSCRIPT_FORMATS}
							onChange={(value) => onChange({ transcriptFormat: value })}
						/>
					)}
				</Option>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-xs font-medium text-fg-2">
					Email me the links <span className="font-normal text-fg-3">· optional</span>
				</span>
				<input
					className="input"
					type="email"
					name="email"
					inputMode="email"
					autoComplete="email"
					placeholder="you@example.com"
					value={options.email}
					onChange={(e) => onChange({ email: e.target.value })}
				/>
				<p className="text-[11px] leading-normal text-fg-3">We send the 24-hour links, then forget your address.</p>
			</div>

			<div className="mt-1 flex items-center justify-between gap-2">
				<button className="btn btn-ghost" type="button" onClick={onBack} disabled={busy}>
					Back
				</button>
				<button className="btn btn-primary" type="button" onClick={onContinue} disabled={!hasSelection || busy}>
					Clean audio
				</button>
			</div>
		</section>
	);
}
