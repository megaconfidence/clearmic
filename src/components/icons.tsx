import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
			{children}
		</svg>
	);
}

export function SunIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.5" />
			<path
				d="M12 3v2M12 19v2M5.05 5.05l1.41 1.41M17.54 17.54l1.41 1.41M3 12h2M19 12h2M5.05 18.95l1.41-1.41M17.54 6.46l1.41-1.41"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</Icon>
	);
}

export function MoonIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path
				d="M20.5 14.5A8 8 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Icon>
	);
}

export function UploadIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 15V4M12 4L7.5 8.5M12 4L16.5 8.5M5 19h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
		</Icon>
	);
}

export function WaveIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M5 12v0M8 9v6M11 6v12M14 8v8M17 10v4M20 12v0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</Icon>
	);
}

export function CloseIcon(props: IconProps) {
	return (
		<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
			<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

export function CheckIcon(props: IconProps) {
	return (
		<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
			<path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function DownloadIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
		</Icon>
	);
}

export function TranscriptIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M5 6h14M5 10h14M5 14h10M5 18h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</Icon>
	);
}
