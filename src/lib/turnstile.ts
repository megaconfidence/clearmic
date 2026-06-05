// Wait for the Turnstile script (loaded in index.html) to attach window.turnstile.
export function waitForTurnstile(timeoutMs = 10000): Promise<NonNullable<Window['turnstile']>> {
	return new Promise((resolve, reject) => {
		if (window.turnstile) {
			resolve(window.turnstile);
			return;
		}
		const startedAt = Date.now();
		const timer = setInterval(() => {
			if (window.turnstile) {
				clearInterval(timer);
				resolve(window.turnstile);
				return;
			}
			if (Date.now() - startedAt > timeoutMs) {
				clearInterval(timer);
				reject(new Error('Verification widget failed to load.'));
			}
		}, 100);
	});
}
