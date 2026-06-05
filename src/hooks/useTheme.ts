import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'clearmic-theme';

function domTheme(): Theme {
	return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function storedTheme(): Theme | null {
	try {
		const value = localStorage.getItem(THEME_STORAGE_KEY);
		return value === 'light' || value === 'dark' ? value : null;
	} catch {
		return null;
	}
}

// Theme mirrors the value resolved pre-paint in index.html. A click on the nav
// toggle persists an explicit choice; otherwise we follow the system setting.
export function useTheme() {
	const [theme, setTheme] = useState<Theme>(() => domTheme());

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	useEffect(() => {
		const query = window.matchMedia?.('(prefers-color-scheme: dark)');
		if (!query) return;
		const onChange = (event: MediaQueryListEvent) => {
			if (storedTheme()) return;
			setTheme(event.matches ? 'dark' : 'light');
		};
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, []);

	const toggle = useCallback(() => {
		setTheme((prev) => {
			const next = prev === 'dark' ? 'light' : 'dark';
			try {
				localStorage.setItem(THEME_STORAGE_KEY, next);
			} catch {
				// localStorage unavailable (privacy mode, quota) — toggle still works for the session.
			}
			return next;
		});
	}, []);

	return { theme, toggle };
}
