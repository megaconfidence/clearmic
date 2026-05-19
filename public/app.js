const meter = document.querySelector(".meter");
const heights = [18, 46, 27, 82, 34, 66, 23, 95, 58, 28, 72, 41, 88, 36, 51, 79, 31, 63, 22, 93, 44, 68, 38, 84, 26, 56, 74, 35, 91, 47, 62, 29, 76, 52, 40, 86];
meter.innerHTML = heights.map((height) => `<span style="--h:${height}"></span>`).join("");

const form = document.getElementById("upload-form");
const audioInput = document.getElementById("audio");
const submit = document.getElementById("submit");
const statusBox = document.getElementById("status");
const terminalStatuses = new Set(["completed", "failed", "canceled"]);
const fields = {
	status: document.getElementById("job-status"),
	file: document.getElementById("job-file"),
	preset: document.getElementById("job-preset"),
	output: document.getElementById("job-output"),
	error: document.getElementById("error"),
	result: document.getElementById("result"),
	player: document.getElementById("player"),
	download: document.getElementById("download"),
};

let pollTimer;
let isBusy = false;

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	clearTimeout(pollTimer);
	setBusy(true);
	showError("");

	try {
		const selectedOptions = new FormData(form);
		const body = new FormData();
		body.set("audio", audioInput.files[0]);
		body.set("preset", selectedOptions.get("preset") || "balanced");
		body.set("output_choice", selectedOptions.get("output_choice") || "enhanced");

		const response = await fetch("/api/jobs", {
			method: "POST",
			body,
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error || "Upload failed.");
		}

		renderJob(payload.job);
		poll(payload.job.id);
	} catch (error) {
		showError(error.message || String(error));
		setBusy(false);
	}
});

async function poll(jobId) {
	try {
		const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error || "Status check failed.");
		}

		renderJob(payload.job);

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

function renderJob(job) {
	statusBox.hidden = false;
	fields.status.textContent = job.status;
	fields.file.textContent = `${job.inputName} (${formatBytes(job.inputSize)})`;
	fields.preset.textContent = titleCase(job.preset || "balanced");
	fields.output.textContent = titleCase(job.outputChoice || "enhanced");
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

function showError(message) {
	fields.error.textContent = message;
	fields.error.hidden = !message;
}

function setBusy(nextIsBusy) {
	isBusy = nextIsBusy;
	submit.disabled = isBusy;
	submit.textContent = isBusy ? "Cleaning..." : "Clean this recording";
}

function formatBytes(bytes) {
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function titleCase(value) {
	return `${value}`.slice(0, 1).toUpperCase() + `${value}`.slice(1);
}
