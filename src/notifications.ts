import { cleanedFileName, transcriptFileName } from "./audio";
import { getUser, isExpired } from "./db";
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

		try {
			await env.EMAIL.send({
				to: user.email,
				from: env.EMAIL_FROM,
				subject: "Your ClearMic file is ready",
				text: renderCompletionEmailText(job, links),
				html: renderCompletionEmailHtml(job, links),
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

type CompletionLink = {
	label: string;
	url: string;
	fileName: string;
};

function completionLinks(job: JobRow, origin: string): CompletionLink[] {
	const links: CompletionLink[] = [];
	const token = encodeURIComponent(job.download_token);
	const jobId = encodeURIComponent(job.id);

	if (job.output_key) {
		links.push({
			label: "Download audio",
			url: `${origin}/api/jobs/${jobId}/download?token=${token}`,
			fileName: cleanedFileName(job.input_name),
		});
	}

	if (job.transcript) {
		links.push({
			label: "Download transcript",
			url: `${origin}/api/jobs/${jobId}/transcript?token=${token}`,
			fileName: transcriptFileName(job.input_name),
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

function renderCompletionEmailText(job: JobRow, links: CompletionLink[]): string {
	return (
		`ClearMic\n\n` +
		`Your processing job is ready: ${job.input_name}\n\n` +
		links.map((link) => `${link.label} (${link.fileName}):\n${link.url}`).join("\n\n") +
		`\n\nLinks expire in 24 hours from upload. If you did not request this, you can ignore this email.`
	);
}

function renderCompletionEmailHtml(job: JobRow, links: CompletionLink[]): string {
	const sans = "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
	const fileName = escapeHtml(job.input_name);
	const linkHtml = links
		.map(
			(link) => `<tr><td style="padding:8px 28px 0;">
<a href="${escapeAttribute(link.url)}" style="display:block;background:#373cff;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 14px;font-family:${sans};font-size:14px;font-weight:600;text-align:center;">${escapeHtml(link.label)}</a>
<p style="font-family:${sans};font-size:11px;color:#a3a3a3;margin:6px 0 0;word-break:break-all;">${escapeHtml(link.fileName)}</p>
</td></tr>`,
		)
		.join("");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>Your ClearMic file is ready</title>
</head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:${sans};color:#0a0a0a;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafaf9;padding:48px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:440px;background:#ffffff;border:1px solid #ececeb;border-radius:16px;">
<tr><td style="padding:28px 28px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:9px;line-height:0;font-size:0;"><span style="display:inline-block;width:9px;height:9px;border-radius:999px;background:#373cff;"></span></td>
<td style="vertical-align:middle;font-family:${sans};font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#0a0a0a;">ClearMic</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px 28px 4px;">
<h1 style="font-family:${sans};font-size:19px;font-weight:600;letter-spacing:-0.015em;color:#0a0a0a;margin:0 0 6px;">Your file is ready</h1>
<p style="font-family:${sans};font-size:13px;color:#525252;line-height:1.5;margin:0;">${fileName} finished processing. Download links expire 24 hours after upload.</p>
</td></tr>
${linkHtml}
<tr><td style="padding:20px 28px 28px;">
<p style="font-family:${sans};font-size:12px;color:#a3a3a3;line-height:1.5;margin:0;">If you did not request this, you can ignore this email.</p>
</td></tr>
</table>
<p style="font-family:${sans};font-size:11px;color:#a3a3a3;margin:20px 0 0;text-align:center;">ClearMic</p>
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/'/g, "&#39;");
}
