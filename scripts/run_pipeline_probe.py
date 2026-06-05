#!/usr/bin/env python3
"""One-off diagnostic: drive the full ClearMic pipeline through the tunnel and
time every step. Not part of the app. Safe to delete."""
import json
import ssl
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE = sys.argv[1].rstrip("/")
FILE = sys.argv[2]
TOKEN = "1x00000000000000000000AA"
T0 = time.time()
# Local diagnostic only: skip TLS verification (py3.14 is strict about the quick-tunnel cert).
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def log(event):
    el = time.time() - T0
    now = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"{el:8.1f}s | {now} | {event}", flush=True)


def req(method, path, data=None, headers=None, raw=False):
    url = path if path.startswith("http") else BASE + path
    h = {"origin": BASE}
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=300, context=CTX) as resp:
        body = resp.read()
        return body if raw else json.loads(body)


def main():
    import os
    size = os.path.getsize(FILE)
    log(f"START file={FILE} size={size/1e6:.1f}MB base={BASE}")

    # 1) createUpload (all four steps)
    payload = json.dumps({
        "fileName": "audio_raw.wav", "fileType": "audio/wav", "fileSize": size,
        "silence_removal": True, "noise_removal": True, "enhance": True,
        "transcribe": True, "transcript_format": "srt", "enhancement_preset": "medium",
    }).encode()
    up = req("POST", "/api/uploads", payload,
             {"content-type": "application/json", "cf-turnstile-response": TOKEN})["upload"]
    log(f"createUpload OK id={up['id']} strategy={up['strategy']}")

    # 2) upload file bytes to the worker (-> local R2)
    with open(FILE, "rb") as f:
        body = f.read()
    t = time.time()
    req("PUT", up["url"], body, up.get("headers") or {}, raw=True)
    log(f"PUT content OK ({len(body)/1e6:.1f}MB in {time.time()-t:.1f}s)")

    # 3) complete -> creates job, enqueues
    job = req("POST", f"/api/uploads/{up['id']}/complete", b"", {"content-type": "application/json"})["job"]
    jid = job["id"]
    log(f"complete OK job={jid} status={job['status']}")

    # 4) poll, logging every status/step transition
    last = None
    step_started = time.time()
    deadline = time.time() + 30 * 60
    while time.time() < deadline:
        time.sleep(2)
        try:
            job = req("GET", f"/api/jobs/{jid}")["job"]
        except urllib.error.HTTPError as e:
            log(f"poll HTTP {e.code}")
            continue
        key = (job["status"], job.get("processingStep"))
        if key != last:
            if last is not None:
                log(f"  ^ previous phase took {time.time()-step_started:.1f}s")
            step_started = time.time()
            log(f"PHASE status={job['status']} step={job.get('processingStep')}")
            last = key
        if job["status"] in ("completed", "failed", "canceled"):
            log(f"DONE status={job['status']} error={job.get('error')}")
            tr = job.get("transcript")
            log(f"transcript_len={len(tr) if tr else 0} downloadUrl={'yes' if job.get('downloadUrl') else 'no'} transcriptUrl={'yes' if job.get('transcriptUrl') else 'no'}")
            log(f"TOTAL wall time = {time.time()-T0:.1f}s")
            return
    log("TIMEOUT after 30 min")


if __name__ == "__main__":
    main()
