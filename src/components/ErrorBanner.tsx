export function ErrorBanner({ message }: { message: string }) {
	if (!message) return null;
	return (
		<div role="alert" className="mt-1.5 rounded-md bg-err-soft px-3 py-2.5 text-[13px] leading-snug text-err animate-step-in">
			{message}
		</div>
	);
}
