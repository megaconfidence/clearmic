import { useRef, useState } from 'react';
import { formatBytes, labelForType } from '../lib/format';
import { CloseIcon, UploadIcon, WaveIcon } from './icons';

interface FileStepProps {
	file: File | null;
	onFile: (file: File | null) => void;
	onContinue: () => void;
	busy: boolean;
}

export function FileStep({ file, onFile, onContinue, busy }: FileStepProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [drag, setDrag] = useState(false);

	function openPicker() {
		if (!file) inputRef.current?.click();
	}

	function handleDrop(event: React.DragEvent) {
		event.preventDefault();
		setDrag(false);
		const dropped = event.dataTransfer?.files?.[0];
		if (!dropped) return;
		if (inputRef.current) {
			const dt = new DataTransfer();
			dt.items.add(dropped);
			inputRef.current.files = dt.files;
		}
		onFile(dropped);
	}

	const base = 'relative rounded-lg border-[1.5px] transition-[background-color,border-color,box-shadow] duration-200 ease-smooth';
	const containerClass = file
		? `${base} cursor-default border-solid border-border bg-surface p-2.5`
		: `${base} cursor-pointer border-dashed px-5 py-9 ${
				drag ? 'border-accent bg-accent-soft shadow-[0_0_0_4px_var(--accent-ring)]' : 'border-border-2 bg-surface-2 hover:border-accent hover:bg-accent-soft'
			}`;

	return (
		<section className="flex flex-col gap-[18px] animate-step-in step-in">
			<h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">Upload audio</h1>
			<p className="-mt-3.5 text-xs leading-normal text-fg-3">Drop a recording and we'll clean up the noise.</p>

			<div
				className={containerClass}
				onClick={file ? undefined : openPicker}
				onDragEnter={(e) => {
					e.preventDefault();
					if (!file) setDrag(true);
				}}
				onDragOver={(e) => {
					e.preventDefault();
					if (!file) setDrag(true);
				}}
				onDragLeave={(e) => {
					e.preventDefault();
					setDrag(false);
				}}
				onDrop={handleDrop}
			>
				<input
					ref={inputRef}
					className="sr-only"
					type="file"
					accept="audio/*"
					aria-label="Audio file"
					onChange={(e) => onFile(e.target.files?.[0] ?? null)}
				/>

				{file ? (
					<div className="flex items-center gap-3 py-1.5 pr-1.5 pl-1 animate-tag-in">
						<span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent">
							<WaveIcon className="h-[18px] w-[18px]" />
						</span>
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<strong className="truncate text-[13px] font-medium text-fg">{file.name}</strong>
							<span className="text-[11px] text-fg-3 tabular-nums">
								{formatBytes(file.size)} · {labelForType(file.type, file.name)}
							</span>
						</div>
						<button
							className="icon-btn"
							type="button"
							aria-label="Remove file"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								if (inputRef.current) inputRef.current.value = '';
								onFile(null);
							}}
						>
							<CloseIcon className="h-3.5 w-3.5" />
						</button>
					</div>
				) : (
					<div className="pointer-events-none flex flex-col items-center gap-2.5">
						<UploadIcon className="mb-0.5 h-7 w-7 text-fg-3" />
						<p className="text-sm font-medium text-fg">Drop file or click</p>
						<p className="text-xs leading-normal text-fg-3">WAV · MP3 · M4A · up to 200 MB</p>
					</div>
				)}
			</div>

			<div className="mt-1 flex justify-end">
				<button className="btn btn-primary" type="button" onClick={onContinue} disabled={!file || busy}>
					Continue
				</button>
			</div>
		</section>
	);
}
