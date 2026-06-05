import { getUser, isExpired } from "./db";
import { EMAIL_FONTS, escapeHtml, renderEmailButton, renderEmailShell } from "./email-template";
import type { AppEnv, JobRow } from "./types";

export async function maybeSendCompletionEmail(job: JobRow, env: AppEnv, baseUrl?: string): Promise<void> {
	try {
		if (job.status !== "completed" || job.email_on_completion !== 1 || job.completion_email_sent_at || isExpired(job.expires_at)) {
			return;
		}

		const origin = completionEmailOrigin(job, baseUrl);
		if (!origin) {
			console.warn(`Skipping completion email for ${job.id}: missing public base URL.`);
			return;
		}

		const user = job.user_id ? await getUser(env, job.user_id) : null;
		if (!user) {
			return;
		}

		const links = completionLinks(job, origin);
		if (!links.length) {
			return;
		}
		const claimedAt = new Date().toISOString();
		const claim = await env.DB.prepare(
			`UPDATE jobs
			 SET completion_email_sent_at = ?, updated_at = ?
			 WHERE id = ? AND status = 'completed' AND email_on_completion = 1 AND completion_email_sent_at IS NULL`,
		)
			.bind(claimedAt, claimedAt, job.id)
			.run();
		if ((claim.meta.changes ?? 0) === 0) {
			return;
		}

		const fileName = job.input_name || "audio";

		try {
			await env.EMAIL.send({
				to: user.email,
				from: env.EMAIL_FROM,
				subject: subjectFor(fileName),
				text: renderCompletionEmailText(fileName, links),
				html: renderCompletionEmailHtml(fileName, links, origin),
			});
		} catch (error) {
			await env.DB.prepare("UPDATE jobs SET completion_email_sent_at = NULL, updated_at = ? WHERE id = ? AND completion_email_sent_at = ?")
				.bind(new Date().toISOString(), job.id, claimedAt)
				.run();
			throw error;
		}
	} catch (error) {
		console.error("Completion email failed", error);
	}
}

// Inbox subjects above ~70 chars get truncated by most clients. Keep the
// "Your file is ready" lead-in front-loaded so it stays readable when long
// filenames get clipped at the tail.
function subjectFor(fileName: string): string {
	const stripped = fileName.replace(/[\r\n"\\]/g, "").trim();
	if (!stripped) return "Your ClearMic file is ready";
	const max = 52; // leaves headroom for the "Your file is ready: " prefix
	const display = stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
	return `Your file is ready: ${display}`;
}

type CompletionLink = {
	label: string;
	url: string;
};

function completionLinks(job: JobRow, origin: string): CompletionLink[] {
	const links: CompletionLink[] = [];
	const token = encodeURIComponent(job.download_token);
	const jobId = encodeURIComponent(job.id);

	if (job.output_key) {
		links.push({
			label: "Download audio",
			url: `${origin}/api/jobs/${jobId}/download?token=${token}`,
		});
	}

	if (job.transcript) {
		links.push({
			label: "Download transcript",
			url: `${origin}/api/jobs/${jobId}/transcript?token=${token}`,
		});
	}

	return links;
}

function completionEmailOrigin(job: JobRow, baseUrl?: string): string | null {
	for (const value of [baseUrl, originFromUrl(job.replicate_webhook_url)]) {
		if (value && isPublicHttpsOrigin(value)) {
			return value.replace(/\/+$/, "");
		}
	}

	return null;
}

function originFromUrl(value: string | null): string | null {
	if (!value) {
		return null;
	}

	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

function isPublicHttpsOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
	} catch {
		return false;
	}
}

function renderCompletionEmailText(fileName: string, links: CompletionLink[]): string {
	return (
		`ClearMic\n\n` +
		`Your file is ready.\n` +
		`File: ${fileName}\n\n` +
		links.map((link) => `${link.label}:\n${link.url}`).join("\n\n") +
		`\n\nLinks expire 24 hours after upload. If you didn't request this, you can ignore this email.`
	);
}

function renderCompletionEmailHtml(fileName: string, links: CompletionLink[], origin: string): string {
	const { sans, mono } = EMAIL_FONTS;
	const linkHtml = links
		.map((link, i) =>
			renderEmailButton({
				url: link.url,
				label: link.label,
				variant: i === 0 ? "primary" : "ghost",
			}),
		)
		.join("");

	// Filename rendered as a soft monospace chip so it visually echoes the
	// file-tag treatment in the app and remains scannable when long.
	const fileChip = `<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:#f5f5f4;font-family:${mono};font-size:12px;font-weight:500;color:#525252;letter-spacing:0;word-break:break-all;">${escapeHtml(fileName)}</span>`;

	const body = `<tr><td style="padding:24px 28px 4px;">
<h1 style="font-family:${sans};font-size:19px;font-weight:600;letter-spacing:-0.015em;color:#0a0a0a;margin:0 0 10px;">Your file is ready</h1>
<p style="margin:0 0 8px;line-height:1.6;">${fileChip}</p>
<p style="font-family:${sans};font-size:13px;color:#525252;line-height:1.5;margin:0;">Download links expire 24 hours after upload.</p>
</td></tr>
${linkHtml}
<tr><td style="padding:22px 28px 28px;">
<p style="font-family:${sans};font-size:12px;color:#a3a3a3;line-height:1.5;margin:0;">If you didn't request this, you can ignore this email.</p>
</td></tr>`;

	return renderEmailShell({
		origin: origin || null,
		title: `Your ClearMic file "${fileName}" is ready`,
		preheader: `${fileName} is ready. Download links expire in 24h.`,
		body,
	});
}
