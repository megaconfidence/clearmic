/// <reference types="vite/client" />

// Cloudflare Turnstile is loaded via a <script> tag in index.html and exposes a
// global `window.turnstile`. These types cover the explicit-render API we use.
interface TurnstileRenderOptions {
	sitekey: string;
	theme?: 'light' | 'dark' | 'auto';
	appearance?: 'always' | 'execute' | 'interaction-only';
	'refresh-expired'?: 'auto' | 'manual' | 'never';
	callback?: (token: string) => void;
	'expired-callback'?: () => void;
	'timeout-callback'?: () => void;
	'error-callback'?: () => boolean | void;
}

interface TurnstileApi {
	render: (container: string | HTMLElement, options: TurnstileRenderOptions) => string;
	reset: (widgetId?: string) => void;
	remove: (widgetId?: string) => void;
}

interface Window {
	turnstile?: TurnstileApi;
}
