const meter = document.querySelector(".meter");
const heights = [18, 46, 27, 82, 34, 66, 23, 95, 58, 28, 72, 41, 88, 36, 51, 79, 31, 63, 22, 93, 44, 68, 38, 84, 26, 56, 74, 35, 91, 47, 62, 29, 76, 52, 40, 86];
meter.replaceChildren(...heights.map((height) => {
	const bar = document.createElement("span");
	bar.style.setProperty("--h", String(height));
	return bar;
}));

const steps = Array.from(document.querySelectorAll("[data-step]"));
const terminalStatuses = new Set(["completed", "failed", "canceled"]);
const fields = {
	audio: document.getElementById("audio"),
	email: document.getElementById("email"),
	code: document.getElementById("code"),
	codeBlock: document.getElementById("code-block"),
	turnstileStatus: document.getElementById("turnstile-status"),
	accountLabel: document.getElementById("account-label"),
	logout: document.getElementById("logout"),
	error: document.getElementById("error"),
	status: document.getElementById("job-status"),
	file: document.getElementById("job-file"),
	preset: document.getElementById("job-preset"),
	output: document.getElementById("job-output"),
	expiry: document.getElementById("job-expiry"),
	result: document.getElementById("result"),
	player: document.getElementById("player"),
	download: document.getElementById("download"),
	jobList: document.getElementById("job-list"),
	previousCount: document.getElementById("previous-count"),
};

let currentUser = null;
let pollTimer;
let turnstileToken = "";
let turnstileWidgetId;

document.getElementById("file-next").addEventListener("click", () => {
	showError("");
	if (!fields.audio.files[0]) {
		showError("Choose an audio file first.");
		return;
	}
	showStep("options");
});

document.getElementById("options-next").addEventListener("click", () => {
	showError("");
	if (currentUser) {
		uploadSelectedFile();
		return;
	}
	showStep("auth");
});

document.getElementById("send-code").addEventListener("click", requestOtp);
document.getElementById("verify-code").addEventListener("click", verifyOtpAndUpload);
document.getElementById("new-file").addEventListener("click", resetFlow);
fields.logout.addEventListener("click", logout);

for (const button of document.querySelectorAll("[data-back]")) {
	button.addEventListener("click", () => showStep(button.dataset.back));
}

init();

async function init() {
	await loadMe();
	await initTurnstile();
	await loadJobs();
	showStep("file");
}

async function requestOtp() {
	showError("");
	if (!turnstileToken) {
		showError("Complete the verification challenge before requesting a code.");
		return;
	}

	setBusy(true);
	try {
		await api("/api/auth/request-otp", {
			method: "POST",
			body: JSON.stringify({ email: fields.email.value, turnstileToken }),
		});
		resetTurnstile();
		fields.codeBlock.hidden = false;
		fields.code.focus();
	} catch (error) {
		resetTurnstile();
		showError(error.message || String(error));
	} finally {
		setBusy(false);
	}
}

async function verifyOtpAndUpload() {
	showError("");
	setBusy(true);
	try {
		const payload = await api("/api/auth/verify", {
			method: "POST",
			body: JSON.stringify({ email: fields.email.value, code: fields.code.value }),
		});
		currentUser = payload.user;
		renderAccount();
		await uploadSelectedFile();
	} catch (error) {
		showError(error.message || String(error));
		setBusy(false);
	}
}

async function uploadSelectedFile() {
	showError("");
	setBusy(true);
	clearTimeout(pollTimer);

	try {
		const file = fields.audio.files[0];
		const preset = selectedRadio("preset", "balanced");
		const outputChoice = selectedRadio("output_choice", "enhanced");

		const uploadPayload = await api("/api/uploads", {
			method: "POST",
			body: JSON.stringify({
				fileName: file.name,
				fileType: file.type,
				fileSize: file.size,
				preset,
				output_choice: outputChoice,
			}),
		});

		const upload = uploadPayload.upload;
		const putResponse = await fetch(upload.url, {
			method: "PUT",
			headers: upload.headers,
			body: file,
		});
		if (!putResponse.ok) {
			throw new Error("Direct upload to storage failed.");
		}

		const payload = await api(`/api/uploads/${encodeURIComponent(upload.id)}/complete`, {
			method: "POST",
		});

		renderJob(payload.job);
		showStep("processing");
		await loadJobs();
		poll(payload.job.id);
	} catch (error) {
		showError(error.message || String(error));
		setBusy(false);
	}
}

async function initTurnstile() {
	try {
		const config = await api("/api/config");
		await waitForTurnstile();
		turnstileWidgetId = window.turnstile.render("#turnstile-widget", {
			sitekey: config.turnstileSiteKey,
			theme: "dark",
			callback(token) {
				turnstileToken = token;
				fields.turnstileStatus.textContent = "Verification ready.";
			},
			"expired-callback"() {
				turnstileToken = "";
				fields.turnstileStatus.textContent = "Verification expired. Complete it again.";
			},
			"timeout-callback"() {
				turnstileToken = "";
				fields.turnstileStatus.textContent = "Verification timed out. Complete it again.";
			},
			"error-callback"() {
				turnstileToken = "";
				fields.turnstileStatus.textContent = "Verification error. Refresh or try again.";
				return true;
			},
		});
		fields.turnstileStatus.textContent = "Complete verification to request a code.";
	} catch (error) {
		fields.turnstileStatus.textContent = "Verification unavailable.";
		showError(error.message || String(error));
	}
}

function waitForTurnstile() {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const timer = setInterval(() => {
			if (window.turnstile) {
				clearInterval(timer);
				resolve();
				return;
			}

			if (Date.now() - startedAt > 10000) {
				clearInterval(timer);
				reject(new Error("Verification widget failed to load."));
			}
		}, 100);
	});
}

function resetTurnstile() {
	turnstileToken = "";
	if (window.turnstile && turnstileWidgetId !== undefined) {
		window.turnstile.reset(turnstileWidgetId);
		fields.turnstileStatus.textContent = "Complete verification to request a code.";
	}
}

async function poll(jobId) {
	try {
		const payload = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
		renderJob(payload.job);
		await loadJobs();

		if (terminalStatuses.has(payload.job.status)) {
			setBusy(false);
			return;
		}

		pollTimer = setTimeout(() => poll(jobId), 2500);
	} catch (error) {
		showError(error.message || String(error));
		setBusy(false);
	}
}

async function loadMe() {
	const payload = await api("/api/me");
	currentUser = payload.user;
	renderAccount();
}

async function loadJobs() {
	if (!currentUser) {
		renderJobList([]);
		return;
	}

	const payload = await api("/api/jobs");
	renderJobList(payload.jobs || []);
}

async function logout() {
	await api("/api/logout", { method: "POST" });
	currentUser = null;
	renderAccount();
	renderJobList([]);
	resetFlow();
}

function renderJob(job) {
	fields.status.textContent = job.status;
	fields.file.textContent = `${job.inputName} (${formatBytes(job.inputSize)})`;
	fields.preset.textContent = titleCase(job.preset || "balanced");
	fields.output.textContent = titleCase(job.outputChoice || "enhanced");
	fields.expiry.textContent = timeRemaining(job.expiresAt);
	showError(job.error || "");

	if (job.downloadUrl) {
		fields.result.hidden = false;
		fields.player.src = job.downloadUrl;
		fields.download.href = job.downloadUrl;
		fields.download.download = "clearmic-cleaned.wav";
	} else {
		fields.result.hidden = true;
	}
}

function renderJobList(jobs) {
	fields.previousCount.textContent = jobs.length;
	fields.jobList.replaceChildren();

	if (!jobs.length) {
		const empty = document.createElement("p");
		empty.className = "empty";
		empty.textContent = currentUser ? "No active files yet." : "Sign in to see files that have not expired.";
		fields.jobList.append(empty);
		return;
	}

	fields.jobList.append(...jobs.map(createJobCard));
}

function createJobCard(job) {
	const card = document.createElement("article");
	card.className = "job-card";

	const title = document.createElement("div");
	title.className = "job-card-title";
	title.textContent = job.inputName;
	card.append(title);

	const meta = document.createElement("p");
	meta.className = "job-card-meta";
	meta.textContent = `${job.status} · ${titleCase(job.preset)} · ${titleCase(job.outputChoice)} · deletes in ${timeRemaining(job.expiresAt)}`;
	card.append(meta);

	if (job.downloadUrl) {
		const download = document.createElement("a");
		download.className = "download";
		download.href = job.downloadUrl;
		download.download = "clearmic-cleaned.wav";
		download.textContent = "Download";
		card.append(download);
	}

	return card;
}

function renderAccount() {
	fields.accountLabel.textContent = currentUser ? currentUser.email : "Not signed in";
	fields.logout.hidden = !currentUser;
}

function resetFlow() {
	clearTimeout(pollTimer);
	setBusy(false);
	showError("");
	fields.audio.value = "";
	fields.result.hidden = true;
	showStep("file");
}

async function api(path, options = {}) {
	const headers = new Headers(options.headers || {});
	if (options.body && typeof options.body === "string") {
		headers.set("content-type", "application/json");
	}

	const response = await fetch(path, { ...options, headers });
	const payload = await response.json();
	if (!response.ok) {
		throw new Error(payload.error || "Request failed.");
	}
	return payload;
}

function showStep(name) {
	for (const step of steps) {
		step.hidden = step.dataset.step !== name;
	}
}

function showError(message) {
	fields.error.textContent = message;
	fields.error.hidden = !message;
}

function setBusy(nextIsBusy) {
	for (const button of document.querySelectorAll("button")) {
		button.disabled = nextIsBusy;
	}
}

function selectedRadio(name, fallback) {
	return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function formatBytes(bytes) {
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function titleCase(value) {
	return `${value}`.slice(0, 1).toUpperCase() + `${value}`.slice(1);
}

function timeRemaining(expiresAt) {
	const ms = new Date(expiresAt).getTime() - Date.now();
	if (!Number.isFinite(ms) || ms <= 0) return "expired";
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
	return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
