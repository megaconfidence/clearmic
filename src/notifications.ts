import { getUser, isExpired } from "./db";
import { EMAIL_FONTS, renderEmailButton, renderEmailShell } from "./email-template";
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
				text: renderCompletionEmailText(links),
				html: renderCompletionEmailHtml(links, origin),
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

function renderCompletionEmailText(links: CompletionLink[]): string {
	return (
		`ClearMic\n\n` +
		`Your file is ready.\n\n` +
		links.map((link) => `${link.label}:\n${link.url}`).join("\n\n") +
		`\n\nLinks expire 24 hours after upload. If you didn't request this, you can ignore this email.`
	);
}

function renderCompletionEmailHtml(links: CompletionLink[], origin: string): string {
	const { sans } = EMAIL_FONTS;
	const linkHtml = links
		.map((link, i) =>
			renderEmailButton({
				url: link.url,
				label: link.label,
				variant: i === 0 ? "primary" : "ghost",
			}),
		)
		.join("");

	const body = `<tr><td style="padding:24px 28px 4px;">
<h1 style="font-family:${sans};font-size:19px;font-weight:600;letter-spacing:-0.015em;color:#0a0a0a;margin:0 0 6px;">Your file is ready</h1>
<p style="font-family:${sans};font-size:13px;color:#525252;line-height:1.5;margin:0;">Download links expire 24 hours after upload.</p>
</td></tr>
${linkHtml}
<tr><td style="padding:22px 28px 28px;">
<p style="font-family:${sans};font-size:12px;color:#a3a3a3;line-height:1.5;margin:0;">If you didn't request this, you can ignore this email.</p>
</td></tr>`;

	return renderEmailShell({
		origin: origin || null,
		title: "Your ClearMic file is ready",
		preheader: "Your ClearMic file is ready. Download links expire in 24h.",
		body,
	});
}
