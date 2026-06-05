import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { getConfig } from './api';

// One shared Turnstile widget for the whole app (auth.md A2). It runs in
// "interaction-only" mode, so it stays invisible unless Cloudflare actually
// needs a challenge — there is no sign-in step anymore. `getToken()` hands out a
// fresh, single-use token and immediately resets the widget so the next
// challenge pre-warms in parallel with the network request.

interface TurnstileContextValue {
	getToken: () => Promise<string>;
}

const TurnstileContext = createContext<TurnstileContextValue | null>(null);

// Cloudflare's always-pass test sitekey — used as a fallback in local dev if the
// config request hasn't resolved yet. Production gets its key from /api/config.
const TEST_SITE_KEY = '1x00000000000000000000AA';

export function TurnstileProvider({ children }: { children: ReactNode }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const widgetId = useRef<string | undefined>(undefined);
	const cachedToken = useRef<string | null>(null);
	const waiters = useRef<Array<(token: string) => void>>([]);

	useEffect(() => {
		let cancelled = false;
		let id: string | undefined;

		const onToken = (token: string) => {
			const waiter = waiters.current.shift();
			if (waiter) waiter(token); // someone is waiting -> hand it over
			else cachedToken.current = token; // otherwise cache for the next call
		};

		(async () => {
			const ts = await waitForTurnstile().catch(() => null);
			if (cancelled || !ts || !containerRef.current) return;

			let siteKey = TEST_SITE_KEY;
			try {
				siteKey = (await getConfig()).turnstileSiteKey || TEST_SITE_KEY;
			} catch {
				// Config unavailable — fall back to the dev test key.
			}
			if (cancelled || !containerRef.current) return;

			id = ts.render(containerRef.current, {
				sitekey: siteKey,
				appearance: 'interaction-only',
				'refresh-expired': 'auto',
				callback: onToken,
				'expired-callback': () => (cachedToken.current = null),
				'error-callback': () => {
					cachedToken.current = null;
					return undefined;
				},
			});
			widgetId.current = id;
		})();

		return () => {
			cancelled = true;
			if (id !== undefined) {
				try {
					window.turnstile?.remove(id);
				} catch {
					// widget already gone
				}
			}
		};
	}, []);

	const getToken = useCallback(() => {
		// Fast path: a token is already warmed up.
		if (cachedToken.current) {
			const token = cachedToken.current;
			cachedToken.current = null;
			window.turnstile?.reset(widgetId.current); // pre-warm the next token
			return Promise.resolve(token);
		}

		// Slow path: queue a waiter for the first token (covers "clicked before the
		// widget finished"), and time out so a blocked script can't hang the UI.
		return new Promise<string>((resolve, reject) => {
			const waiter = (token: string) => {
				window.turnstile?.reset(widgetId.current);
				resolve(token);
			};
			waiters.current.push(waiter);
			setTimeout(() => {
				const index = waiters.current.indexOf(waiter);
				if (index !== -1) {
					waiters.current.splice(index, 1);
					reject(new Error('Verification timed out. Refresh and try again.'));
				}
			}, 15000);
		});
	}, []);

	return (
		<TurnstileContext.Provider value={{ getToken }}>
			{children}
			{/* Hidden until a challenge is required, then shown bottom-right. */}
			<div ref={containerRef} className="fixed bottom-3 right-3 z-50 empty:hidden" />
		</TurnstileContext.Provider>
	);
}

export function useTurnstile(): TurnstileContextValue {
	const context = useContext(TurnstileContext);
	if (!context) {
		throw new Error('useTurnstile must be used within a TurnstileProvider');
	}
	return context;
}

// Wait for the Turnstile script (loaded in index.html) to attach window.turnstile.
function waitForTurnstile(timeoutMs = 10000): Promise<NonNullable<Window['turnstile']>> {
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
