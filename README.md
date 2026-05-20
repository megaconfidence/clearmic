<div align="center">

<img src="public/icon.svg" alt="ClearMic" width="84" height="84" />

# ClearMic

**Studio-grade voice cleanup, in your browser.**

[Try it →](https://clearmic.conflare.workers.dev)

</div>

---

## Noise out. Voice forward.

Background hum, room reverb, street bleed, fan whine — they ruin recordings. ClearMic can remove noise, enhance speech, transcribe, or chain those steps together. No desktop apps, no plugin chains, no learning curve.

Drop a file, choose at least one processing step, get clean audio and/or a transcript back in under a minute.

## Built for

- **Podcasters** rescuing takes from bad room acoustics
- **Journalists** salvaging interviews recorded in noisy locations
- **Voice-over artists** working without a treated booth
- **Field recordists** fighting wind, traffic, and HVAC
- **Anyone** who's ever recorded a voice memo and wished it sounded cleaner

## Why ClearMic

|  | ClearMic | Desktop pro tools | Most online tools |
| --- | --- | --- | --- |
| Cost | Free, 10/day | Hundreds of dollars | Often paywalled |
| Setup | None | Hours of plugins | Sign-up funnels |
| Speed | Under a minute | Manual editing | Long queues |
| Privacy | Files purge in 24h | Local-only | Stored indefinitely |
| Access | Any browser | macOS / Windows only | Varies |

## How it works

1. **Drop in audio** — WAV, MP3, M4A, FLAC, OGG. Up to 200 MB.
2. **Clean it up** — Pick noise removal, enhancement (Low, Medium, or High strength), transcription, or any combination. Steps apply in order, top to bottom.
3. **Verify your email** — a 6-digit code. No passwords.
4. **Wait under a minute** — close the tab if you want, your spot is saved.
5. **Download, or come back later** — Grab the cleaned audio and transcript right from the page. Your last 24 hours of jobs stay in the **Recent** library for one-click re-download. Opt in to email and we'll deliver 24-hour download links to your inbox the moment it's ready.

## Privacy by default

- All audio is **automatically purged 24 hours** after upload
- No tracking, no analytics, no third-party ads
- Sessions expire after 30 days
- 10 processing jobs per day per email — keeps costs sustainable and abuse contained

## The engine

ClearMic runs a selectable Replicate pipeline:

- **Noise removal** — [`playmore/speech-enhancer`](https://replicate.com/playmore/speech-enhancer)
- **Enhancement** — [`resemble-ai/resemble-enhance`](https://replicate.com/resemble-ai/resemble-enhance), with Low, Medium, and High presets
- **Transcription** — [`vaibhavs10/incredibly-fast-whisper`](https://replicate.com/vaibhavs10/incredibly-fast-whisper)

When multiple steps are selected, each step receives the output of the prior step. Transcription always uses the latest audio in the chain and does not change the downloadable audio.

---

<details>
<summary><strong>Technical overview</strong></summary>

<br>

Built on the Cloudflare edge — single Worker, no backend servers.

| Layer | What |
| --- | --- |
| Frontend | Static assets served from `public/` |
| Runtime | Cloudflare Workers |
| Storage | R2 (audio), D1 (sessions + job metadata) |
| Queue | Cloudflare Queues for async job kickoff |
| Email | Cloudflare Email Service |
| Bot check | Cloudflare Turnstile |
| AI | Replicate (`playmore/speech-enhancer`, `resemble-ai/resemble-enhance`, `vaibhavs10/incredibly-fast-whisper`) |

Browser uploads go **directly to R2** via 15-minute presigned PUT URLs, so the Worker never buffers large upload bodies. The presigned URLs sign exact `Content-Type`, `Content-Length`, and custom metadata; the completion endpoint verifies the stored object before queueing. Sessions live in D1 (not KV) for stronger consistency and revocability. Replicate output URLs are validated against an allowlist of `replicate.delivery` hosts before fetching.

</details>

<details>
<summary><strong>Project layout</strong></summary>

<br>

| Path | What |
| --- | --- |
| `src/index.ts` | API router + Queue handler + cron scheduler |
| `src/auth.ts` | Email OTP, D1 sessions |
| `src/uploads.ts` | Direct-to-R2 upload intents, quota |
| `src/jobs.ts` | Job status, input, webhook, download |
| `src/replicate.ts` | Prediction lifecycle, output persistence |
| `src/pipeline.ts` | Multi-step processing selection + sequencing |
| `src/notifications.ts` | Completion-email rendering and dispatch |
| `src/email-template.ts` | Shared email shell, brand mark, button helpers |
| `src/cleanup.ts` | Scheduled deletion of expired R2 objects + D1 rows |
| `src/r2.ts` | Presigned R2 PUT URL signing (`aws4fetch`) |
| `src/turnstile.ts` | Turnstile siteverify |
| `src/db.ts` | D1 helpers, public job shape |
| `src/audio.ts`, `src/model.ts`, `src/http.ts`, `src/types.ts` | Shared helpers + types |
| `public/index.html`, `styles.css`, `app.js` | UI |
| `public/icon.svg` | App icon (favicon + apple-touch-icon + email brand mark) |
| `migrations/` | D1 schema |

</details>

<details>
<summary><strong>API</strong></summary>

<br>

| Method | Path | What |
| --- | --- | --- |
| `POST` | `/api/auth/request-otp` | Send email login code |
| `POST` | `/api/auth/verify` | Verify code, set session cookie |
| `GET` | `/api/me` | Current user + remaining quota |
| `POST` | `/api/logout` | Clear session |
| `GET` | `/api/config` | Public Turnstile site key |
| `POST` | `/api/uploads` | Create presigned R2 upload |
| `POST` | `/api/uploads/:id/complete` | Verify upload, queue job |
| `GET` | `/api/jobs` | List active jobs + quota |
| `GET` | `/api/jobs/:id` | Job status |
| `GET` | `/api/jobs/:id/download?token=…` | Download clean output with job token |
| `GET` | `/api/jobs/:id/transcript?token=…` | Download transcript text with job token |

Upload body: `{ fileName, fileType, fileSize, noise_removal, enhance, transcribe, enhancement_preset, email_on_completion }`

- Select at least one of `noise_removal`, `enhance`, or `transcribe`
- `enhancement_preset` — `low` (32 evaluations) · `medium` (64) · `high` (128), used when `enhance` is selected
- Enhancement always uses `solver: "Midpoint"` and `prior_temperature: 0.5`; only `number_function_evaluations` changes by preset
- `email_on_completion` — optional boolean; sends 24-hour download links after the final selected step completes

</details>

<details>
<summary><strong>Local development</strong></summary>

<br>

```bash
npm install
cp .env.example .env   # fill in secrets
npm run db:migrate:local
npm run dev:tunnel     # public URL via Cloudflare Tunnel
```

Replicate fetches uploaded audio from a **public HTTPS URL**, so end-to-end processing against `localhost` won't work. Use the `dev:tunnel` URL in your browser, not `localhost`.

During local tunnel development, browser uploads go through the Worker into Wrangler's local R2 simulation instead of using presigned R2 URLs. This avoids the local-R2 versus remote-R2 mismatch while still giving Replicate a public URL to fetch `/api/jobs/:id/input`. Deployed production traffic still uses direct-to-R2 uploads.

Turnstile automatically uses Cloudflare's official always-pass test keys on `localhost`, `127.0.0.1`, and `*.trycloudflare.com`. Production hosts still use `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` from the environment.

Don't create `.dev.vars` — it overrides `.env` in Wrangler and we expect `.env`.

</details>

<details>
<summary><strong>Deploy from scratch</strong></summary>

<br>

Provision Cloudflare resources:

```bash
npx wrangler r2 bucket create clearmic-audio
npx wrangler queues create clearmic-audio-jobs
npx wrangler d1 create clearmic-db
npx wrangler r2 bucket lifecycle add clearmic-audio delete-after-1-day --expire-days 1
npm run r2:cors
```

Paste the `database_id` from `wrangler d1 create` into `wrangler.jsonc`.

Set secrets:

```bash
npx wrangler secret put REPLICATE_API_TOKEN
npx wrangler secret put EMAIL_FROM
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

- `EMAIL_FROM` must be a verified sender on a Cloudflare Email Service domain
- `R2_*` should be scoped to the `clearmic-audio` bucket with object read/write
- `R2_CORS_ORIGINS` in `.env` must include every deployed frontend origin that uploads directly to R2

Migrate D1 and deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

</details>

<details>
<summary><strong>Abuse protection</strong></summary>

<br>

- Turnstile validates every OTP request before email is sent
- 10 processing jobs per email per rolling 24h window (counts queued jobs + pending uploads)
- Direct R2 uploads via 15-minute presigned URLs — Worker never buffers upload bodies
- Upload URLs sign exact `Content-Type`, `Content-Length`, and ClearMic metadata; `/complete` re-verifies the stored object
- Per-job random tokens guard Replicate input, webhook, and download routes
- Completion emails only include tokenized links that expire with the job
- R2 lifecycle hard-deletes after 1 day; D1 `expires_at` blocks access at exactly 24h
- R2 CORS pins browser upload origins
- OTPs: 10 min TTL, single-use, locked after 5 wrong attempts

</details>

---

<div align="center">
<sub>Built on Cloudflare Workers · Powered by Replicate</sub>
</div>
