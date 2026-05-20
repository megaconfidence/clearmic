// Shared email template helpers
// Keeps OTP and completion emails visually consistent with the UI.

export const EMAIL_FONTS = {
	sans: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif",
	mono: "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
};

export type EmailShellOptions = {
	/** Absolute origin of the deployed Worker, e.g. https://clearmic.conflare.workers.dev */
	origin: string | null;
	/** <title> shown in the email client */
	title: string;
	/** Hidden preheader text shown in inbox previews */
	preheader?: string;
	/** HTML body — a sequence of <tr><td>...</td></tr> rows that are injected into the card */
	body: string;
};

/**
 * Wraps any email body in the ClearMic card shell: brand header, optional preheader,
 * and footer caption. Markup is intentionally table-based for broad client support.
 */
export function renderEmailShell({ origin, title, preheader, body }: EmailShellOptions): string {
	const { sans } = EMAIL_FONTS;
	const brand = brandMark(origin);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:${sans};color:#0a0a0a;-webkit-font-smoothing:antialiased;">
${preheader ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${escapeHtml(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafaf9;padding:48px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:460px;background:#ffffff;border:1px solid #ececeb;border-radius:16px;">
<tr><td style="padding:24px 28px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:10px;line-height:0;font-size:0;">${brand}</td>
<td style="vertical-align:middle;font-family:${sans};font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#0a0a0a;">ClearMic</td>
</tr></table>
</td></tr>
${body}
</table>
<p style="font-family:${sans};font-size:11px;color:#a3a3a3;margin:20px 0 0;text-align:center;letter-spacing:0;">ClearMic &middot; Studio-grade voice cleanup</p>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Renders a download-style email button row. Use variant="primary" for the main action
 * and variant="ghost" for secondary actions.
 */
export function renderEmailButton({
	url,
	label,
	variant = "primary",
}: {
	url: string;
	label: string;
	variant?: "primary" | "ghost";
}): string {
	const { sans } = EMAIL_FONTS;
	const styles =
		variant === "primary"
			? "background:#373cff;color:#ffffff;"
			: "background:#ffffff;color:#0a0a0a;box-shadow:inset 0 0 0 1px #dcdcda;";
	return `<tr><td style="padding:10px 28px 0;">
<a href="${escapeAttribute(url)}" style="display:block;${styles}text-decoration:none;border-radius:8px;padding:12px 14px;font-family:${sans};font-size:14px;font-weight:500;letter-spacing:-0.005em;text-align:center;">${escapeHtml(label)}</a>
</td></tr>`;
}

export function emailOriginFromRequest(request: Request): string {
	try {
		const url = new URL(request.url);
		// Only return a public origin we'd want embedded into an email's <img src>.
		if (url.protocol !== "https:") return "";
		if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return "";
		return url.origin;
	} catch {
		return "";
	}
}

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

export function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/'/g, "&#39;");
}

function brandMark(origin: string | null): string {
	// Matches the app's `.brand-mark` (public/styles.css): 22x22 circle with a hairline
	// outline and an accent-tinted lift shadow so the email header reads like the nav.
	const shared =
		"display:block;width:22px;height:22px;border-radius:50%;outline:1px solid rgba(0,0,0,0.06);outline-offset:-1px;box-shadow:0 1px 2px rgba(55,60,255,0.22);";
	if (origin && /^https?:\/\//.test(origin)) {
		const logoUrl = `${origin.replace(/\/+$/, "")}/icon.svg`;
		// Most modern email clients render SVG. Older clients fall back to the alt text.
		return `<img src="${escapeAttribute(logoUrl)}" alt="ClearMic" width="22" height="22" style="${shared}">`;
	}
	// Origin unknown (e.g. local dev) — render an icon-shaped gradient circle that
	// matches the SVG's blue gradient and dimensions so the layout looks identical.
	return `<span aria-hidden="true" style="${shared}background:linear-gradient(180deg,#4F53FF 0%,#2D32FF 100%);"></span>`;
}
