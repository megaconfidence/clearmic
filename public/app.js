const STEPS = ["file", "options", "auth", "processing"];
const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);

const steps = Array.from(document.querySelectorAll("[data-step]"));
const stepDots = Object.fromEntries(STEPS.map((name) => [name, document.querySelector(`[data-dot="${name}"]`)]));

const fields = {
	audio: document.getElementById("audio"),
	email: document.getElementById("email"),
	codeHidden: document.getElementById("code"),
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
};

let currentUser = null;
let pollTimer;
let turnstileToken = "";
let turnstileWidgetId;

// ============ wiring ============

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
		cell.classList.toggle("is-filled", Boolean(digit));
		syncHiddenCode();
		if (digit) {
			const next = fields.codeCells[idx + 1];
			if (next) {
				next.focus();
				next.select();
			} else if (getCodeValue().length === 6) {
				verifyOtpAndUpload();
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
		syncHiddenCode();
		const targetIdx = Math.min(text.length, fields.codeCells.length - 1);
		fields.codeCells[targetIdx].focus();
		if (text.length === 6) verifyOtpAndUpload();
	});

	cell.addEventListener("focus", () => cell.select());
});

init();

// ============ init ============

async function init() {
	await loadMe();
	await initTurnstile();
	await loadJobs();
	showStep("file");
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

// ============ auth ============

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
		clearCodeCells();
		fields.codeCells[0]?.focus();
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
			body: JSON.stringify({ email: fields.email.value, code: getCodeValue() }),
		});
		currentUser = payload.user;
		renderAccount();
		await uploadSelectedFile();
	} catch (error) {
		showError(error.message || String(error));
		setBusy(false);
	}
}

async function logout() {
	await api("/api/logout", { method: "POST" });
	currentUser = null;
	renderAccount();
	renderJobList([]);
	resetFlow();
}

// ============ upload ============

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

// ============ polling ============

async function poll(jobId) {
	try {
		const payload = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
		renderJob(payload.job);
		await loadJobs();

		if (TERMINAL_STATUSES.has(payload.job.status)) {
			setBusy(false);
			return;
		}

		pollTimer = setTimeout(() => poll(jobId), 2500);
	} catch (error) {
		showError(error.message || String(error));
		setBusy(false);
	}
}

// ============ turnstile ============

async function initTurnstile() {
	try {
		const config = await api("/api/config");
		await waitForTurnstile();
		turnstileWidgetId = window.turnstile.render("#turnstile-widget", {
			sitekey: config.turnstileSiteKey,
			theme: "light",
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

// ============ rendering ============

function renderJob(job) {
	const status = String(job.status || "pending").toLowerCase();
	fields.status.textContent = status;
	fields.status.dataset.state = status;

	fields.processingTitle.textContent = titleForStatus(status);
	fields.processingSub.textContent = subForStatus(status);

	fields.file.textContent = job.inputName;
	fields.file.title = job.inputName;
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

	fields.jobList.append(...jobs.map(createJobCard));
}

function createJobCard(job) {
	const status = String(job.status || "pending").toLowerCase();
	const card = document.createElement("article");
	card.className = "job-card";
	card.dataset.state = status;

	const main = document.createElement("div");
	main.className = "job-card-main";

	const title = document.createElement("div");
	title.className = "job-card-title";
	title.textContent = job.inputName;
	title.title = job.inputName;
	main.append(title);

	const meta = document.createElement("div");
	meta.className = "job-card-meta";

	const badge = document.createElement("span");
	badge.className = "status-badge";
	badge.dataset.state = status;
	badge.textContent = status;
	meta.append(badge);

	const dotSep = document.createElement("span");
	dotSep.className = "dot-sep";
	dotSep.textContent = "·";
	meta.append(dotSep);

	const expiry = document.createElement("span");
	expiry.textContent = `${timeRemaining(job.expiresAt)} left`;
	meta.append(expiry);

	main.append(meta);
	card.append(main);

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
	fields.accountLabel.textContent = currentUser ? currentUser.email : "Guest";
	fields.logout.hidden = !currentUser;
}

// ============ step ============

function showStep(name) {
	for (const step of steps) {
		step.hidden = step.dataset.step !== name;
	}
	updateStepDots(name);
}

function updateStepDots(current) {
	const stepIdx = STEPS.indexOf(current);
	const visited = new Set();
	for (let i = 0; i < stepIdx; i++) visited.add(STEPS[i]);
	if (current === "processing" && currentUser) visited.add("auth");

	for (const name of STEPS) {
		const dot = stepDots[name];
		if (!dot) continue;
		dot.classList.toggle("active", name === current);
		dot.classList.toggle("done", visited.has(name));
	}
}

function titleForStatus(status) {
	if (status === "completed") return "Ready";
	if (status === "failed") return "Failed";
	if (status === "canceled") return "Canceled";
	if (status === "queued") return "Queued";
	return "Processing";
}

function subForStatus(status) {
	if (status === "completed") return "Preview below, then download.";
	if (status === "failed") return "Try again or pick a different file.";
	if (status === "canceled") return "Nothing was processed.";
	if (status === "queued") return "Lining up the engine.";
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
	syncHiddenCode();
}

function getCodeValue() {
	return fields.codeCells.map((cell) => cell.value).join("");
}

function syncHiddenCode() {
	fields.codeHidden.value = getCodeValue();
}

function resetFlow() {
	clearTimeout(pollTimer);
	setBusy(false);
	showError("");
	fields.audio.value = "";
	clearFileSelection();
	clearCodeCells();
	fields.codeBlock.hidden = true;
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
