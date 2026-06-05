export function StatusBadge({ status }: { status: string }) {
	const state = String(status || 'pending').toLowerCase();
	return (
		<span className="status-badge" data-state={state}>
			<span className="badge-dot" />
			{state}
		</span>
	);
}
