const STEPS = ["file", "options", "auth", "processing"];
const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);
const ACTIVE_JOB_POLL_MS = 2500;
const SLOW_JOB_POLL_MS = 7500;
const POLL_BACKOFF_AFTER_MS = 60_000;
const JOB_LIST_REFRESH_MS = 30_000;
const THEME_STORAGE_KEY = "clearmic-theme";

const steps = Array.from(document.querySelectorAll("[data-step]"));
const stepDots = Object.fromEntries(STEPS.map((name) => [name, document.querySelector(`[data-dot="${name}"]`)]));

const fields = {
	audio: document.getElementById("audio"),
	email: document.getElementById("email"),
	codeBlock: document.getElementById("code-block"),
	codeCells: Array.from(document.querySelectorAll(".code-cell")),
	turnstileStatus: document.getElementById("turnstile-status"),
	accountLabel: document.getElementById("account-label"),
	logout: document.getElementById("logout"),
	error: document.getElementById("error"),
	status: document.getElementById("job-status"),
	processingTitle: document.getElementById("processing-title"),
	processingSub: document.getElementById("processing-sub"),
	file: document.getElementById("job-file"),
	expiry: document.getElementById("job-expiry"),
	result: document.getElementById("result"),
	player: document.getElementById("player"),
	noiseRemoval: document.getElementById("noise-removal"),
	enhance: document.getElementById("enhance"),
	enhancementControls: document.getElementById("enhancement-controls"),
	emailOnCompletion: document.getElementById("email-on-completion"),
	transcribe: document.getElementById("transcribe"),
	transcript: document.getElementById("transcript"),
	transcriptText: document.getElementById("transcript-text"),
	transcriptMore: document.getElementById("transcript-more"),
	transcriptDownload: document.getElementById("transcript-download"),
	download: document.getElementById("download"),
	library: document.getElementById("library"),
	jobList: document.getElementById("job-list"),
	previousCount: document.getElementById("previous-count"),
	dropzone: document.getElementById("dropzone"),
	dropzoneEmpty: document.querySelector(".dropzone-empty"),
	dropzoneFilled: document.querySelector(".dropzone-filled"),
	fileName: document.getElementById("file-name"),
	fileSize: document.getElementById("file-size"),
	fileType: document.getElementById("file-type"),
	fileClear: document.getElementById("file-clear"),
	quota: document.getElementById("quota"),
	quotaNum: document.getElementById("quota-num"),
	signIn: document.getElementById("sign-in"),
	authTitle: document.getElementById("auth-title"),
	authSub: document.getElementById("auth-sub"),
	authBack: document.querySelector('[data-step="auth"] [data-back]'),
	verifyCode: document.getElementById("verify-code"),
	sendCode: document.getElementById("send-code"),
	resendCode: document.getElementById("resend-code"),
	themeToggle: document.getElementById("theme-toggle"),
};

let currentUser = null;
let pollTimer;
let activePollJobId = "";
let activePollStartedAt = 0;
let lastJobListRefreshAt = 0;
let turnstileToken = "";
let turnstileWidgetId;

// ============ wiring ============

const fileNext = document.getElementById("file-next");
const optionsNext = document.getElementById("options-next");

fileNext.addEventListener("click", () => {
	showError("");
	if (!fields.audio.files[0]) {
		showError("Choose an audio file first.");
		return;
	}
	showStep("options");
});

optionsNext.addEventListener("click", () => {
	showError("");
	if (!hasSelectedProcessingStep()) {
		showError("Select at least one processing step.");
		return;
	}
	if (currentUser) {
		uploadSelectedFile();
		return;
	}
	showStep("auth");
});

function updateFileNextEnabled() {
	fileNext.disabled = !fields.audio.files[0];
}

function updateOptionsNextEnabled() {
	optionsNext.disabled = !hasSelectedProcessingStep();
}

document.querySelectorAll('[name="noise_removal"], [name="enhance"], [name="transcribe"]').forEach((input) => {
	input.addEventListener("change", updateOptionsNextEnabled);
});

fields.sendCode.addEventListener("click", () => requestOtp());
fields.resendCode.addEventListener("click", () => requestOtp({ resend: true }));
fields.verifyCode.addEventListener("click", verifyAndContinue);
document.getElementById("new-file").addEventListener("click", resetFlow);
fields.logout.addEventListener("click", logout);
fields.signIn.addEventListener("click", () => {
	showError("");
	showStep("auth");
	requestAnimationFrame(() => fields.email.focus());
});



fields.enhance.addEventListener("change", renderEnhancementControls);
document.addEventListener("visibilitychange", handleVisibilityChange);
fields.themeToggle.addEventListener("click", toggleTheme);

// Follow system theme changes only if the user hasn't picked one explicitly.
// Once they click the toggle, their choice is sticky across system changes.
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
systemThemeQuery?.addEventListener?.("change", (event) => {
	if (storedTheme()) return;
	applyTheme(event.matches ? "dark" : "light");
});

for (const button of document.querySelectorAll("[data-back]")) {
	button.addEventListener("click", () => showStep(button.dataset.back));
}

// dropzone: drag-and-drop + filename preview
["dragenter", "dragover"].forEach((event) => {
	fields.dropzone.addEventListener(event, (e) => {
		e.preventDefault();
		if (!fields.dropzone.classList.contains("has-file")) {
			fields.dropzone.classList.add("is-drag");
		}
	});
});

["dragleave", "drop"].forEach((event) => {
	fields.dropzone.addEventListener(event, (e) => {
		e.preventDefault();
		fields.dropzone.classList.remove("is-drag");
	});
});

fields.dropzone.addEventListener("drop", (e) => {
	const file = e.dataTransfer?.files?.[0];
	if (!file) return;
	const dt = new DataTransfer();
	dt.items.add(file);
	fields.audio.files = dt.files;
	fields.audio.dispatchEvent(new Event("change", { bubbles: true }));
});

fields.audio.addEventListener("change", () => {
	const file = fields.audio.files[0];
	if (file) {
		fields.dropzone.classList.add("has-file");
		fields.dropzoneEmpty.hidden = true;
		fields.dropzoneFilled.hidden = false;
		fields.fileName.textContent = file.name;
		fields.fileSize.textContent = formatBytes(file.size);
		fields.fileType.textContent = labelForType(file.type, file.name);
	} else {
		clearFileSelection();
	}
	updateFileNextEnabled();
});

fields.fileClear.addEventListener("click", (e) => {
	e.preventDefault();
	e.stopPropagation();
	fields.audio.value = "";
	clearFileSelection();
});

// OTP code cells: auto-advance, backspace, paste
fields.codeCells.forEach((cell, idx) => {
	cell.addEventListener("input", () => {
		const digit = cell.value.replace(/\D/g, "").slice(-1);
		cell.value = digit;
		const wasFilled = cell.classList.contains("is-filled");
		cell.classList.toggle("is-filled", Boolean(digit));
		if (digit && !wasFilled) {
			cell.classList.remove("just-filled");
			void cell.offsetWidth;
			cell.classList.add("just-filled");
		}
		if (digit) {
			const next = fields.codeCells[idx + 1];
			if (next) {
				next.focus();
				next.select();
			} else if (getCodeValue().length === 6) {
				verifyAndContinue();
			}
		}
	});

	cell.addEventListener("keydown", (event) => {
		if (event.key === "Backspace" && !cell.value && idx > 0) {
			const prev = fields.codeCells[idx - 1];
			prev.focus();
			prev.select();
		} else if (event.key === "ArrowLeft" && idx > 0) {
			event.preventDefault();
			fields.codeCells[idx - 1].focus();
		} else if (event.key === "ArrowRight" && idx < fields.codeCells.length - 1) {
			event.preventDefault();
			fields.codeCells[idx + 1].focus();
		}
	});

	cell.addEventListener("paste", (event) => {
		const text = (event.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
		if (!text) return;
		event.preventDefault();
		for (let i = 0; i < fields.codeCells.length; i++) {
			const digit = text[i] || "";
			fields.codeCells[i].value = digit;
			fields.codeCells[i].classList.toggle("is-filled", Boolean(digit));
		}
		const targetIdx = Math.min(text.length, fields.codeCells.length - 1);
		fields.codeCells[targetIdx].focus();
		if (text.length === 6) verifyAndContinue();
	});

	cell.addEventListener("focus", () => cell.select());
});

init();

// ============ init ============

async function init() {
	await loadMe();
	await initTurnstile();
	await loadJobs();
	renderEnhancementControls();
	updateFileNextEnabled();
	updateOptionsNextEnabled();
	showStep("file");
}

async function loadMe() {
	const payload = await api("/api/me");
	currentUser = payload.user;
	renderAccount();
	renderQuota(payload.quota);
}

async function loadJobs() {
	if (!currentUser) {
		renderJobList([]);
		renderQuota(null);
		lastJobListRefreshAt = 0;
		return;
	}
	const payload = await api("/api/jobs");
	renderJobList(payload.jobs || []);
	renderQuota(payload.quota);
	lastJobListRefreshAt = Date.now();
}

// ============ auth ============

async function requestOtp({ resend = false } = {}) {
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
		fields.sendCode.hidden = true;
		clearCodeCells();
		fields.codeCells[0]?.focus();
		if (resend) {
			flashResend();
		}
	} catch (error) {
		resetTurnstile();
		showError(error.message || String(error));
	} finally {
		setBusy(false);
	}
}

function flashResend() {
	fields.resendCode.textContent = "Sent";
	fields.resendCode.disabled = true;
	setTimeout(() => {
		fields.resendCode.textContent = "Resend";
		fields.resendCode.disabled = false;
	}, 2500);
}

async function verifyAndContinue() {
	showError("");
	setBusy(true);
	try {
		const payload = await api("/api/auth/verify", {
			method: "POST",
			body: JSON.stringify({ email: fields.email.value, code: getCodeValue() }),
		});
		currentUser = payload.user;
		renderAccount();

		if (fields.audio.files[0]) {
			await uploadSelectedFile();
		} else {
			await loadJobs();
			fields.codeBlock.hidden = true;
			fields.sendCode.hidden = false;
			clearCodeCells();
			showStep("file");
			setBusy(false);
		}
	} catch (error) {
		showError(error.message || String(error));
		setBusy(false);
	}
}

async function logout() {
	stopJobPolling();
	await api("/api/logout", { method: "POST" });
	currentUser = null;
	lastJobListRefreshAt = 0;
	fields.email.value = "";
	// Order matters: resetFlow() ends with setBusy(false), which force-enables
	// every <button>. Anything that touches button.disabled (clearOptionsForm,
	// updateFileNextEnabled) has to run after resetFlow or it gets clobbered.
	resetFlow();
	clearOptionsForm();
	updateFileNextEnabled();
	renderAccount();
	renderQuota(null);
	renderJobList([]);
	resetTurnstile();
}

function clearOptionsForm() {
	// Reset processing pipeline selections so the next signed-in user starts fresh.
	// Kept out of resetFlow() because "Process another file" should preserve the
	// user's previous choices.
	fields.noiseRemoval.checked = false;
	fields.enhance.checked = false;
	fields.transcribe.checked = false;
	fields.emailOnCompletion.checked = false;
	const defaultPreset = document.querySelector('input[name="enhancement_preset"][value="medium"]');
	if (defaultPreset) defaultPreset.checked = true;
	fields.enhancementControls.hidden = true;
	updateOptionsNextEnabled();
}

// ============ upload ============

async function uploadSelectedFile() {
	showError("");
	setBusy(true);
	stopJobPolling();

	try {
		const file = fields.audio.files[0];
		const noiseRemoval = Boolean(fields.noiseRemoval.checked);
		const enhance = Boolean(fields.enhance.checked);
		const transcribe = Boolean(fields.transcribe.checked);
		if (!noiseRemoval && !enhance && !transcribe) {
			throw new Error("Select at least one processing step.");
		}

		const uploadPayload = await api("/api/uploads", {
			method: "POST",
			body: JSON.stringify({
				fileName: file.name,
				fileType: file.type,
				fileSize: file.size,
				noise_removal: noiseRemoval,
				enhance,
				enhancement_preset: selectedRadio("enhancement_preset", "medium"),
				output_choice: "enhanced",
				transcribe,
				email_on_completion: Boolean(fields.emailOnCompletion.checked),
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
		startJobPolling(payload.job.id);
	} catch (error) {
		showError(error.message || String(error));
		setBusy(false);
	}
}

// ============ polling ============

function startJobPolling(jobId) {
	stopJobPolling();
	activePollJobId = jobId;
	activePollStartedAt = Date.now();
	poll(jobId);
}

function stopJobPolling() {
	clearTimeout(pollTimer);
	pollTimer = undefined;
	activePollJobId = "";
	activePollStartedAt = 0;
}

async function poll(jobId) {
	if (document.hidden || jobId !== activePollJobId) {
		return;
	}

	try {
		const payload = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
		if (jobId !== activePollJobId) {
			return;
		}

		renderJob(payload.job);

		if (TERMINAL_STATUSES.has(payload.job.status)) {
			stopJobPolling();
			setBusy(false);
			await refreshJobListIfStale(true);
			return;
		}

		await refreshJobListIfStale();
		scheduleNextPoll(jobId);
	} catch (error) {
		stopJobPolling();
		showError(error.message || String(error));
		setBusy(false);
	}
}

function scheduleNextPoll(jobId) {
	clearTimeout(pollTimer);
	if (document.hidden || jobId !== activePollJobId) {
		return;
	}

	const elapsed = Date.now() - activePollStartedAt;
	const delay = elapsed >= POLL_BACKOFF_AFTER_MS ? SLOW_JOB_POLL_MS : ACTIVE_JOB_POLL_MS;
	pollTimer = setTimeout(() => poll(jobId), delay);
}

async function refreshJobListIfStale(force = false) {
	if (force || Date.now() - lastJobListRefreshAt >= JOB_LIST_REFRESH_MS) {
		try {
			await loadJobs();
		} catch (error) {
			console.error("Recent jobs refresh failed", error);
		}
	}
}

function handleVisibilityChange() {
	if (!activePollJobId) {
		return;
	}

	clearTimeout(pollTimer);
	if (!document.hidden) {
		poll(activePollJobId);
	}
}

// ============ turnstile ============

async function initTurnstile() {
	try {
		const config = await api("/api/config");
		await waitForTurnstile();
		turnstileWidgetId = window.turnstile.render("#turnstile-widget", {
			sitekey: config.turnstileSiteKey,
			// Match Turnstile to the resolved app theme at render time. The widget
			// itself doesn't support a runtime theme swap, so subsequent toggles
			// keep its initial palette — acceptable for the brief OTP window.
			theme: currentTheme(),
			callback(token) {
				turnstileToken = token;
				setTurnstileStatus("Verification ready.", "ready");
			},
			"expired-callback"() {
				turnstileToken = "";
				setTurnstileStatus("Verification expired. Complete it again.", "error");
			},
			"timeout-callback"() {
				turnstileToken = "";
				setTurnstileStatus("Verification timed out. Complete it again.", "error");
			},
			"error-callback"() {
				turnstileToken = "";
				setTurnstileStatus("Verification error. Refresh or try again.", "error");
				return true;
			},
		});
		setTurnstileStatus("Complete verification to request a code.", "idle");
	} catch (error) {
		setTurnstileStatus("Verification unavailable.", "error");
		showError(error.message || String(error));
	}
}

function setTurnstileStatus(message, state) {
	fields.turnstileStatus.textContent = message;
	if (state && state !== "idle") {
		fields.turnstileStatus.dataset.state = state;
	} else {
		delete fields.turnstileStatus.dataset.state;
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
		setTurnstileStatus("Complete verification to request a code.", "idle");
	}
}

// ============ rendering ============

function renderJob(job) {
	const status = String(job.status || "pending").toLowerCase();
	fields.status.textContent = status;
	fields.status.dataset.state = status;

	fields.processingTitle.textContent = titleForStatus(status);
	fields.processingSub.textContent = subForJob(job, status);

	fields.file.textContent = job.inputName;
	fields.file.title = job.inputName;
	fields.expiry.textContent = timeRemaining(job.expiresAt);
	showError(job.error || "");

	if (job.downloadUrl || job.transcript || job.transcriptUrl) {
		fields.result.hidden = false;
		fields.player.hidden = !job.downloadUrl;
		if (job.downloadUrl) {
			if (fields.player.src !== job.downloadUrl) {
				fields.player.src = job.downloadUrl;
			}
		} else {
			fields.player.removeAttribute("src");
		}
		renderTranscript(job.transcript || "");
		fields.transcriptDownload.hidden = !job.transcriptUrl;
		if (job.transcriptUrl) {
			fields.transcriptDownload.href = job.transcriptUrl;
			fields.transcriptDownload.download = transcriptNameForJob(job);
		} else {
			fields.transcriptDownload.removeAttribute("href");
		}
		fields.download.hidden = !job.downloadUrl;
		if (job.downloadUrl) {
			fields.download.href = job.downloadUrl;
			fields.download.download = downloadNameForJob(job);
		} else {
			fields.download.removeAttribute("href");
		}
		// Promote the transcript link to primary styling when it's the only download.
		const transcriptIsPrimary = Boolean(job.transcriptUrl) && !job.downloadUrl;
		fields.transcriptDownload.classList.toggle("primary", transcriptIsPrimary);
		fields.transcriptDownload.classList.toggle("ghost", !transcriptIsPrimary);
	} else {
		fields.result.hidden = true;
		fields.player.hidden = true;
		fields.player.removeAttribute("src");
		fields.transcriptDownload.hidden = true;
		fields.transcriptDownload.removeAttribute("href");
		fields.download.hidden = true;
		fields.download.removeAttribute("href");
		renderTranscript("");
	}
}

function renderJobList(jobs) {
	fields.previousCount.textContent = jobs.length;
	fields.jobList.replaceChildren();

	if (!currentUser) {
		fields.library.hidden = true;
		return;
	}

	fields.library.hidden = false;

	if (!jobs.length) {
		const empty = document.createElement("p");
		empty.className = "empty";
		empty.textContent = "No files yet.";
		fields.jobList.append(empty);
		return;
	}

	fields.jobList.append(...jobs.map((job, index) => createJobCard(job, index)));
}

function createJobCard(job, index = 0) {
	const status = String(job.status || "pending").toLowerCase();
	const card = document.createElement("article");
	card.className = "job-card";
	card.dataset.state = status;
	card.style.setProperty("--i", String(index));

	const main = document.createElement("div");
	main.className = "job-card-main";

	const titleRow = document.createElement("div");
	titleRow.className = "job-card-title-row";

	const title = document.createElement("div");
	title.className = "job-card-title";
	title.textContent = job.inputName;
	title.title = job.inputName;
	titleRow.append(title);

	const badge = document.createElement("span");
	badge.className = "status-badge";
	badge.dataset.state = status;
	badge.textContent = status;
	titleRow.append(badge);

	main.append(titleRow);

	const meta = document.createElement("div");
	meta.className = "job-card-meta";

	const labels = pipelineLabels(job);
	if (labels.length) {
		const pipeline = document.createElement("span");
		pipeline.className = "job-card-pipeline";
		labels.forEach((label, i) => {
			if (i > 0) {
				const sep = document.createElement("span");
				sep.className = "dot-sep";
				sep.textContent = "→";
				pipeline.append(sep);
			}
			const step = document.createElement("span");
			step.textContent = label;
			pipeline.append(step);
		});
		meta.append(pipeline);

		const sep = document.createElement("span");
		sep.className = "dot-sep";
		sep.textContent = "·";
		meta.append(sep);
	}

	const expiry = document.createElement("span");
	expiry.textContent = `${timeRemaining(job.expiresAt)} left`;
	meta.append(expiry);

	main.append(meta);
	card.append(main);

	if (job.downloadUrl || job.transcriptUrl) {
		const actions = document.createElement("div");
		actions.className = "job-card-actions";

		if (job.downloadUrl) {
			const download = document.createElement("a");
			download.className = "download";
			download.href = job.downloadUrl;
			download.download = downloadNameForJob(job);
			download.textContent = "Audio";
			actions.append(download);
		}

		if (job.transcriptUrl) {
			const transcript = document.createElement("a");
			transcript.className = "download";
			transcript.href = job.transcriptUrl;
			transcript.download = transcriptNameForJob(job);
			transcript.textContent = "Transcript";
			actions.append(transcript);
		}

		card.append(actions);
	}

	return card;
}

function renderAccount() {
	if (currentUser) {
		fields.signIn.hidden = true;
		fields.accountLabel.textContent = currentUser.email;
		fields.accountLabel.hidden = false;
		fields.logout.hidden = false;
	} else {
		fields.signIn.hidden = false;
		fields.accountLabel.textContent = "";
		fields.accountLabel.hidden = true;
		fields.logout.hidden = true;
	}
}

function renderQuota(quota) {
	if (!quota || !currentUser) {
		fields.quota.hidden = true;
		return;
	}
	const remaining = Math.max(0, quota.limit - quota.used);
	fields.quota.hidden = false;
	fields.quotaNum.textContent = remaining;
	fields.quota.dataset.state = remaining === 0 ? "empty" : remaining <= 2 ? "low" : "ok";
}

function renderTranscript(transcript) {
	fields.transcript.hidden = !transcript;
	if (!transcript) {
		fields.transcriptText.textContent = "";
		fields.transcriptMore.hidden = true;
		return;
	}
	const { preview, truncated } = previewTranscript(transcript, 3);
	fields.transcriptText.textContent = preview;
	fields.transcriptMore.hidden = !truncated;
}

function previewTranscript(text, maxSentences) {
	const trimmed = String(text).trim();
	if (!trimmed) {
		return { preview: "", truncated: false };
	}
	// Greedy match: non-terminator chars, followed by one or more terminators (.!?…) then whitespace or end.
	const matches = trimmed.match(/[^.!?…]+[.!?…]+(?:["'”’)]+)?(?=\s|$)/g);
	if (!matches || matches.length <= maxSentences) {
		return { preview: trimmed, truncated: false };
	}
	const preview = matches
		.slice(0, maxSentences)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	return { preview: `${preview} …`, truncated: true };
}

function renderEnhancementControls() {
	fields.enhancementControls.hidden = !fields.enhance.checked;
}

// ============ step ============

function showStep(name) {
	for (const step of steps) {
		step.hidden = step.dataset.step !== name;
	}
	if (name === "auth") {
		applyAuthCopy();
	}
	updateStepDots(name);
}

function applyAuthCopy() {
	const hasFile = Boolean(fields.audio.files[0]);
	fields.authTitle.textContent = hasFile ? "Verify email" : "Sign in";
	fields.authSub.textContent = hasFile
		? "We'll save your file to your account."
		: "Pick up where you left off.";
	fields.verifyCode.textContent = hasFile ? "Verify and upload" : "Sign in";
	fields.authBack.dataset.back = hasFile ? "options" : "file";
}

function updateStepDots(current) {
	const hasFile = Boolean(fields.audio.files[0]);
	const isPastOptions = STEPS.indexOf(current) > STEPS.indexOf("options");

	for (const name of STEPS) {
		const dot = stepDots[name];
		if (!dot) continue;
		const isActive = name === current;
		let isDone = false;
		if (name === "file") isDone = hasFile;
		else if (name === "options") isDone = hasFile && isPastOptions;
		else if (name === "auth") isDone = Boolean(currentUser);
		dot.classList.toggle("active", isActive);
		dot.classList.toggle("done", isDone && !isActive);
	}
}

function titleForStatus(status) {
	if (status === "completed") return "Ready";
	if (status === "failed") return "Failed";
	if (status === "canceled") return "Canceled";
	if (status === "queued") return "Queued";
	return "Processing";
}

function subForJob(job, status) {
	if (status === "completed") return job.downloadUrl ? "Preview below, then download." : "Transcript below.";
	if (status === "failed") return "Try again or pick a different file.";
	if (status === "canceled") return "Nothing was processed.";
	if (status === "queued") return "Lining up the engine.";
	if (job.processingStep === "noise_removal") return "Removing noise with Speech Enhancer.";
	if (job.processingStep === "enhancement") return "Enhancing voice detail with Resemble.";
	if (job.processingStep === "transcription") return "Transcribing the latest audio.";
	return "Usually under a minute.";
}

function clearFileSelection() {
	fields.dropzone.classList.remove("has-file");
	fields.dropzoneEmpty.hidden = false;
	fields.dropzoneFilled.hidden = true;
}

function clearCodeCells() {
	for (const cell of fields.codeCells) {
		cell.value = "";
		cell.classList.remove("is-filled");
	}
}

function getCodeValue() {
	return fields.codeCells.map((cell) => cell.value).join("");
}

function resetFlow() {
	stopJobPolling();
	setBusy(false);
	showError("");
	fields.audio.value = "";
	clearFileSelection();
	clearCodeCells();
	fields.codeBlock.hidden = true;
	fields.sendCode.hidden = false;
	fields.result.hidden = true;
	fields.player.hidden = true;
	fields.player.removeAttribute("src");
	fields.transcriptDownload.hidden = true;
	fields.download.hidden = true;
	renderTranscript("");
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

// ============ theme ============

function currentTheme() {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
	document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

function storedTheme() {
	try {
		const value = localStorage.getItem(THEME_STORAGE_KEY);
		return value === "light" || value === "dark" ? value : null;
	} catch {
		return null;
	}
}

function persistTheme(theme) {
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// localStorage unavailable (privacy mode, quota) — the toggle still works for
		// the current session, just doesn't survive reloads.
	}
}

function toggleTheme() {
	const next = currentTheme() === "dark" ? "light" : "dark";
	applyTheme(next);
	persistTheme(next);
}

// ============ small helpers ============

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

function hasSelectedProcessingStep() {
	return Boolean(fields.noiseRemoval.checked || fields.enhance.checked || fields.transcribe.checked);
}

function pipelineLabels(job) {
	const labels = [];
	if (job.noiseRemovalRequested) labels.push("Noise");
	if (job.enhancementRequested) labels.push("Enhance");
	if (job.transcriptionRequested) labels.push("Transcript");
	return labels;
}

function downloadNameForJob(job) {
	return `${safeBaseNameForJob(job)}-cleaned.wav`;
}

function transcriptNameForJob(job) {
	return `${safeBaseNameForJob(job)}-transcript.txt`;
}

function safeBaseNameForJob(job) {
	const base = String(job.inputName || "audio").replace(/\.[^.]+$/, "") || "audio";
	const safeBase = base
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 90);
	return safeBase || "audio";
}

function formatBytes(bytes) {
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeRemaining(expiresAt) {
	const ms = new Date(expiresAt).getTime() - Date.now();
	if (!Number.isFinite(ms) || ms <= 0) return "expired";
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
	return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function labelForType(mime, name) {
	const lower = String(mime || "").toLowerCase();
	if (lower.includes("wav")) return "WAV";
	if (lower.includes("mp3") || lower.includes("mpeg")) return "MP3";
	if (lower.includes("m4a") || lower.includes("mp4")) return "M4A";
	if (lower.includes("flac")) return "FLAC";
	if (lower.includes("ogg")) return "OGG";
	if (lower.includes("webm")) return "WEBM";
	const ext = String(name || "")
		.split(".")
		.pop()
		?.toUpperCase();
	return ext || "audio";
}


