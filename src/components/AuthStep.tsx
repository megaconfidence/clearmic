import { useEffect, useRef, useState } from 'react';
import type { Theme } from '../hooks/useTheme';
import { getErrorMessage } from '../lib/api';
import { waitForTurnstile } from '../lib/turnstile';

type TurnstileState = 'idle' | 'ready' | 'error';

interface AuthStepProps {
	siteKey: string | null;
	theme: Theme;
	hasFile: boolean;
	busy: boolean;
	email: string;
	onEmailChange: (email: string) => void;
	onBack: () => void;
	onRequestOtp: (email: string, token: string) => Promise<boolean>;
	onVerify: (email: string, code: string) => Promise<void>;
	setError: (message: string) => void;
}

const EMPTY_CODE = ['', '', '', '', '', ''];

export function AuthStep({ siteKey, theme, hasFile, busy, email, onEmailChange, onBack, onRequestOtp, onVerify, setError }: AuthStepProps) {
	const [codeSent, setCodeSent] = useState(false);
	const [code, setCode] = useState<string[]>(EMPTY_CODE);
	const [popped, setPopped] = useState<boolean[]>(() => EMPTY_CODE.map(() => false));
	const [token, setToken] = useState('');
	const [status, setStatus] = useState<{ message: string; state: TurnstileState }>({ message: 'Loading verification…', state: 'idle' });
	const [resent, setResent] = useState(false);

	const containerRef = useRef<HTMLDivElement>(null);
	const widgetIdRef = useRef<string | undefined>(undefined);
	const emailRef = useRef<HTMLInputElement>(null);
	const cellRefs = useRef<Array<HTMLInputElement | null>>([]);

	const title = hasFile ? 'Verify email' : 'Sign in';
	const sub = hasFile ? "We'll save your file to your account." : 'Pick up where you left off.';
	const verifyLabel = hasFile ? 'Verify and upload' : 'Sign in';

	// Focus the email field when the step opens.
	useEffect(() => {
		emailRef.current?.focus();
	}, []);

	// Render the Turnstile widget once the script is ready. Theme is captured at
	// render time (the widget can't swap palettes live), matching the brief window.
	useEffect(() => {
		if (!siteKey) {
			setStatus({ message: 'Verification unavailable.', state: 'error' });
			return;
		}
		let cancelled = false;
		let widgetId: string | undefined;
		setStatus({ message: 'Loading verification…', state: 'idle' });

		waitForTurnstile()
			.then((ts) => {
				if (cancelled || !containerRef.current) return;
				widgetId = ts.render(containerRef.current, {
					sitekey: siteKey,
					theme,
					callback: (value) => {
						setToken(value);
						setStatus({ message: 'Verification ready.', state: 'ready' });
					},
					'expired-callback': () => {
						setToken('');
						setStatus({ message: 'Verification expired. Complete it again.', state: 'error' });
					},
					'timeout-callback': () => {
						setToken('');
						setStatus({ message: 'Verification timed out. Complete it again.', state: 'error' });
					},
					'error-callback': () => {
						setToken('');
						setStatus({ message: 'Verification error. Refresh or try again.', state: 'error' });
						return true;
					},
				});
				widgetIdRef.current = widgetId;
				setStatus({ message: 'Complete verification to request a code.', state: 'idle' });
			})
			.catch((error) => {
				if (cancelled) return;
				setStatus({ message: 'Verification unavailable.', state: 'error' });
				setError(getErrorMessage(error));
			});

		return () => {
			cancelled = true;
			if (window.turnstile && widgetId !== undefined) {
				try {
					window.turnstile.remove(widgetId);
				} catch {
					// widget already gone
				}
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [siteKey]);

	function resetTurnstile() {
		setToken('');
		if (window.turnstile && widgetIdRef.current !== undefined) {
			window.turnstile.reset(widgetIdRef.current);
			setStatus({ message: 'Complete verification to request a code.', state: 'idle' });
		}
	}

	function clearCode() {
		setCode(EMPTY_CODE);
		setPopped(EMPTY_CODE.map(() => false));
	}

	function focusCell(index: number) {
		const cell = cellRefs.current[index];
		cell?.focus();
		cell?.select();
	}

	async function submitCode(value: string) {
		await onVerify(email, value);
	}

	async function handleRequest(resend: boolean) {
		setError('');
		if (!token) {
			setError('Complete the verification challenge before requesting a code.');
			return;
		}
		const ok = await onRequestOtp(email, token);
		resetTurnstile();
		if (!ok) return;
		setCodeSent(true);
		clearCode();
		requestAnimationFrame(() => focusCell(0));
		if (resend) {
			setResent(true);
			setTimeout(() => setResent(false), 2500);
		}
	}

	function handleCellInput(index: number, raw: string) {
		const digit = raw.replace(/\D/g, '').slice(-1);
		setCode((prev) => {
			const next = [...prev];
			next[index] = digit;
			return next;
		});
		if (digit) {
			setPopped((prev) => {
				const next = [...prev];
				next[index] = true;
				return next;
			});
			if (index < 5) {
				focusCell(index + 1);
			} else {
				const value = code.map((c, i) => (i === index ? digit : c)).join('');
				if (value.length === 6) void submitCode(value);
			}
		}
	}

	function handleCellKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Backspace' && !code[index] && index > 0) {
			focusCell(index - 1);
		} else if (event.key === 'ArrowLeft' && index > 0) {
			event.preventDefault();
			focusCell(index - 1);
		} else if (event.key === 'ArrowRight' && index < 5) {
			event.preventDefault();
			focusCell(index + 1);
		}
	}

	function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
		const text = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
		if (!text) return;
		event.preventDefault();
		const next = EMPTY_CODE.map((_, i) => text[i] || '');
		setCode(next);
		setPopped(next.map((digit) => Boolean(digit)));
		focusCell(Math.min(text.length, 5));
		if (text.length === 6) void submitCode(text);
	}

	const dotColor = status.state === 'ready' ? 'bg-ok' : status.state === 'error' ? 'bg-err' : 'bg-fg-3';
	const textColor = status.state === 'ready' ? 'text-ok' : status.state === 'error' ? 'text-err' : 'text-fg-2';

	return (
		<section className="flex flex-col gap-[18px] animate-step-in step-in">
			<h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">{title}</h1>
			<p className="-mt-3.5 text-xs leading-normal text-fg-3">{sub}</p>

			<div className="flex flex-col gap-2">
				<input
					ref={emailRef}
					className="input"
					type="email"
					autoComplete="email"
					placeholder="you@example.com"
					value={email}
					onChange={(e) => onEmailChange(e.target.value)}
				/>
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex min-h-[65px] items-center">
					<div ref={containerRef} />
				</div>
				<p className={`inline-flex items-center gap-1.5 text-xs ${textColor}`}>
					<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
					{status.message}
				</p>
			</div>

			{!codeSent && (
				<button className="btn btn-primary btn-block" type="button" onClick={() => void handleRequest(false)} disabled={busy}>
					Send code
				</button>
			)}

			{codeSent && (
				<div className="flex flex-col gap-3.5 animate-code-in">
					<div className="flex flex-col gap-2">
						<div className="grid grid-cols-6 gap-1.5">
							{code.map((digit, index) => (
								<input
									key={index}
									ref={(el) => {
										cellRefs.current[index] = el;
									}}
									className={`code-cell ${digit ? 'is-filled' : ''} ${popped[index] ? 'just-filled' : ''}`}
									type="text"
									inputMode="numeric"
									maxLength={1}
									autoComplete={index === 0 ? 'one-time-code' : 'off'}
									aria-label={`Digit ${index + 1}`}
									value={digit}
									onChange={(e) => handleCellInput(index, e.target.value)}
									onKeyDown={(e) => handleCellKeyDown(index, e)}
									onPaste={handlePaste}
									onFocus={(e) => e.target.select()}
									onAnimationEnd={() =>
										setPopped((prev) => {
											if (!prev[index]) return prev;
											const next = [...prev];
											next[index] = false;
											return next;
										})
									}
								/>
							))}
						</div>
						<div className="flex items-baseline justify-between gap-3">
							<p className="text-xs leading-normal text-fg-3">Check your inbox. Code expires in 10 minutes.</p>
							<button
								className="rounded-sm text-xs font-medium text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:text-fg-3"
								type="button"
								onClick={() => void handleRequest(true)}
								disabled={busy || resent}
							>
								{resent ? 'Sent' : 'Resend'}
							</button>
						</div>
					</div>
					<button className="btn btn-primary btn-block" type="button" onClick={() => void submitCode(code.join(''))} disabled={busy}>
						{verifyLabel}
					</button>
				</div>
			)}

			<div className="mt-1 flex items-center justify-between gap-2">
				<button className="btn btn-ghost" type="button" onClick={onBack} disabled={busy}>
					Back
				</button>
			</div>
		</section>
	);
}
