<div align="center">

<img src="public/icon.svg" alt="ClearMic" width="84" height="84" />

# ClearMic

**Studio-grade voice cleanup, in your browser.**

[Try it →](https://clearmic.conflare.dev)

</div>

---

## Noise out. Voice forward.

Background hum, room reverb, street bleed, fan whine — they ruin recordings. ClearMic can trim silence, remove noise, enhance speech, transcribe, or chain those steps together. No desktop apps, no plugin chains, no learning curve.

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
| Cost | Free, 30/day | Hundreds of dollars | Often paywalled |
| Setup | None, no sign-up | Hours of plugins | Sign-up funnels |
| Speed | Under a minute | Manual editing | Long queues |
| Privacy | Files purge in 24h | Local-only | Stored indefinitely |
| Access | Any browser | macOS / Windows only | Varies |

## How it works

1. **Drop in audio** — WAV, MP3, M4A, FLAC, OGG. Up to 200 MB. No sign-up.
2. **Clean it up** — Pick silence removal, noise removal, enhancement (Low, Medium, or High strength), transcription (as plain text, SRT, or VTT), or any combination. Steps apply in order, top to bottom.
3. **(Optional) add your email** — and we'll send the 24-hour download links to your inbox. It's used only to send those links, then discarded — your email is never stored.
4. **Wait under a minute** — keep the tab open to watch progress.
5. **Download, or come back later** — Grab the cleaned audio and transcript right from the page. Your recent files stay in the **Recent** list (on this device) for one-click re-download until they expire.

## Privacy by default

- **No accounts, no sign-in** — nothing to create, nothing to remember
- All audio is **automatically purged 24 hours** after upload
- Optional email is used **only to send your download links, then discarded** — never stored
- Only anonymous aggregate usage counts are kept long-term — never audio, filenames, or personal data
- No tracking, no analytics, no third-party ads
- 30 processing jobs per day per IP — keeps costs sustainable and abuse contained

## The engine

ClearMic runs a selectable Replicate pipeline. The audio-cleaning steps apply in order:

- **Silence removal** — [`nikitalokhmachev-ai/silero-vad`](https://replicate.com/nikitalokhmachev-ai/silero-vad), trims silent gaps out of the audio (outputs 16 kHz speech-quality audio)
- **Noise removal** — [`playmore/speech-enhancer`](https://replicate.com/playmore/speech-enhancer)
- **Enhancement** — [`resemble-ai/resemble-enhance`](https://replicate.com/resemble-ai/resemble-enhance), with Low, Medium, and High presets
- **Transcription** — [`openai/whisper`](https://replicate.com/openai/whisper) (large-v3), with a selectable output format: plain text (`.txt`), SubRip (`.srt`), or WebVTT (`.vtt`)

Each audio step receives the output of the prior one, producing a single cleaned download. **Transcription runs as a parallel branch** alongside the audio chain (so it doesn't add to the wait); it reads the silence-removed audio when silence removal is on, otherwise the original upload, so subtitle timestamps line up with the download.

To avoid multi-minute cold starts, the three community models run behind always-warm Replicate **deployments** (`min_instances ≥ 1`), configured via the `*_DEPLOYMENT` secrets (`.env` in dev, `wrangler secret put` in prod). Whisper is an official always-warm model, so it has no deployment. Step advancement is idempotent (a compare-and-swap on the active prediction id), so the webhook and the status poll can never start the same step twice.

---

<details>
<summary><strong>Technical overview</strong></summary>

<br>

Built on the Cloudflare edge — single Worker, no backend servers.

| Layer | What |
| --- | --- |
| Frontend | React + Vite SPA (Tailwind CSS), built with the Cloudflare Vite plugin and served as static assets |
| Runtime | Cloudflare Workers |
| Storage | R2 (audio), D1 (job metadata + permanent usage rollup) |
| Queue | Cloudflare Queues for async job kickoff |
| Email | Cloudflare Email Service |
| Bot check | Cloudflare Turnstile |
| Rate limit | Durable Object — per-IP sliding window |
| AI | Replicate (`nikitalokhmachev-ai/silero-vad`, `playmore/speech-enhancer`, `resemble-ai/resemble-enhance`, `openai/whisper`) |

There are **no user accounts**. The expensive job-start call is gated by Turnstile (bot check, fails closed) plus a per-IP sliding-window rate limit (a Durable Object, fails open); the status polls and downloads that follow stay open and are keyed by unguessable per-job ids and tokens. Browser uploads go **directly to R2** via 15-minute presigned PUT URLs, so the Worker never buffers large upload bodies. The presigned URLs sign exact `Content-Type`, `Content-Length`, and custom metadata; the completion endpoint verifies the stored object before queueing. Replicate output URLs are validated against an allowlist of `replicate.delivery` hosts before fetching.

</details>

<details>
<summary><strong>Project layout</strong></summary>

<br>

| Path | What |
| --- | --- |
| `worker/index.ts` | API router + Queue handler + cron scheduler |
| `worker/gate.ts` | Turnstile + per-IP rate-limit gate for the job-start call |
| `worker/rate-limiter.ts` | Per-IP sliding-window rate limiter (Durable Object) |
| `worker/uploads.ts` | Direct-to-R2 upload intents; optional notify email |
| `worker/jobs.ts` | Job status, input, webhook, download |
| `worker/replicate.ts` | Prediction lifecycle, output persistence |
| `worker/pipeline.ts` | Multi-step processing selection + sequencing |
| `worker/notifications.ts` | Completion-email rendering, dispatch, and address scrub |
| `worker/email-template.ts` | Shared email shell, brand mark, button helpers |
| `worker/cleanup.ts` | Scheduled deletion of expired R2 objects + D1 rows; archives anonymous job stats first |
| `worker/admin.ts` | Usage stats (passphrase-gated) — persistent rollup (`usage_daily`) combined with live jobs |
| `worker/r2.ts` | Presigned R2 PUT URL signing (`aws4fetch`) |
| `worker/turnstile.ts` | Turnstile siteverify + site-key config |
| `worker/db.ts` | D1 helpers, public job shape |
| `worker/audio.ts`, `worker/model.ts`, `worker/http.ts`, `worker/types.ts` | Shared helpers + types |
| `index.html`, `src/main.tsx` | Vite HTML entry + React mount |
| `src/App.tsx`, `src/components/`, `src/hooks/` | React UI — wizard steps, nav, device-local recent files |
| `src/pages/Admin.tsx` | `/admin` usage dashboard (passphrase) |
| `src/lib/` | API client, formatting helpers, shared Turnstile provider |
| `src/styles.css` | Tailwind v4 + ClearMic theme tokens (light/dark) |
| `vite.config.ts` | Vite config (React + Cloudflare + Tailwind plugins) |
| `public/icon.svg` | App icon (favicon + apple-touch-icon + email brand mark) |
| `migrations/` | D1 schema |

</details>

<details>
<summary><strong>API</strong></summary>

<br>

| Method | Path | What |
| --- | --- | --- |
| `GET` | `/api/config` | Public Turnstile site key |
| `POST` | `/api/uploads` | Create upload — gated by Turnstile (`cf-turnstile-response` header) + per-IP rate limit |
| `POST` | `/api/uploads/:id/complete` | Verify upload, queue job |
| `GET` | `/api/jobs/:id` | Job status (keyed by the opaque job id) |
| `POST` | `/api/jobs/:id/email` | Attach a completion email after processing has started (scrubbed after sending) |
| `GET` | `/api/jobs/:id/download?token=…` | Download clean output with job token |
| `GET` | `/api/jobs/:id/transcript?token=…` | Download the transcript (`.txt`/`.srt`/`.vtt`) with job token |
| `GET` | `/api/admin/stats` | Usage statistics — requires `X-Admin-Passphrase` |

Upload body: `{ fileName, fileType, fileSize, silence_removal, noise_removal, enhance, transcribe, enhancement_preset, transcript_format, email }`

- Select at least one of `silence_removal`, `noise_removal`, `enhance`, or `transcribe`
- `enhancement_preset` — `low` (32 evaluations, default) · `medium` (64) · `high` (128), used when `enhance` is selected
- Enhancement always uses `solver: "Midpoint"` and `prior_temperature: 0.5`; only `number_function_evaluations` changes by preset
- `transcript_format` — `txt` (default) · `srt` · `vtt`, used when `transcribe` is selected; controls the downloadable transcript file
- `email` — optional; when set, 24-hour download links are emailed there and the address is **scrubbed after sending** (never stored)

</details>

<details>
<summary><strong>Local development</strong></summary>

<br>

```bash
npm install
cp .env.example .env   # fill in secrets
npm run db:migrate:local
npm run dev            # Vite dev server: React HMR + the Worker (via @cloudflare/vite-plugin)
```

`npm run dev` serves the React client and the `/api/*` Worker together on `localhost` with local bindings (D1, R2, Queues) and Turnstile test keys. `npm run build` produces the client + Worker bundles, and `npm run deploy` runs the build before `wrangler deploy`.

Replicate fetches uploaded audio from a **public HTTPS URL**, so end-to-end processing against `localhost` won't complete. For a full end-to-end run, expose the dev server with a tunnel — e.g. `cloudflared tunnel --url http://localhost:5173` — and open that URL, or deploy to a `*.workers.dev` preview.

During local development, browser uploads go through the Worker into Wrangler's local R2 simulation instead of using presigned R2 URLs. This avoids the local-R2 versus remote-R2 mismatch while still giving Replicate a public URL to fetch `/api/jobs/:id/input`. Deployed production traffic still uses direct-to-R2 uploads.

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
npx wrangler secret put ADMIN_PASSPHRASE
# Always-warm model deployments ("owner/name"); see below
npx wrangler secret put SILENCE_REMOVAL_DEPLOYMENT
npx wrangler secret put NOISE_REMOVAL_DEPLOYMENT
npx wrangler secret put ENHANCEMENT_DEPLOYMENT
```

- `EMAIL_FROM` must be a verified sender on a Cloudflare Email Service domain
- `ADMIN_PASSPHRASE` gates the `/admin` usage dashboard — use a long random string
- `R2_*` should be scoped to the `clearmic-audio` bucket with object read/write
- `R2_CORS_ORIGINS` in `.env` must include every deployed frontend origin that uploads directly to R2

Create the always-warm model deployments once (keeps the cold-booting community models hot), then set each `*_DEPLOYMENT` secret to the resulting `owner/name` (leave blank to fall back to the public model):

```bash
# repeat for speech-enhancer (gpu-t4) and resemble-enhance (gpu-t4)
curl -s -X POST https://api.replicate.com/v1/deployments \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"silero-vad","model":"nikitalokhmachev-ai/silero-vad","version":"<version>","hardware":"cpu","min_instances":1,"max_instances":3}'
```

Migrate D1 and deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

</details>

<details>
<summary><strong>Abuse protection</strong></summary>

<br>

- Turnstile validates the job-start call (**fails closed**) before any work begins
- 30 processing jobs per IP per rolling 24h window — a Durable Object sliding window that **fails open** if the limiter is unavailable
- The bot check runs **before** the rate limit, so a bot flood can't burn a real user's quota
- Direct R2 uploads via 15-minute presigned URLs — Worker never buffers upload bodies
- Upload URLs sign exact `Content-Type`, `Content-Length`, and ClearMic metadata; `/complete` re-verifies the stored object
- Per-job random tokens guard Replicate input, webhook, and download routes
- Completion emails only include tokenized links that expire with the job; the address is scrubbed after sending
- R2 lifecycle hard-deletes after 1 day; D1 `expires_at` blocks access at exactly 24h
- R2 CORS pins browser upload origins
- `/admin` is gated by a shared passphrase (constant-time compare, throttled 401s)

</details>

---

<div align="center">
<sub>Built on Cloudflare Workers · Powered by Replicate</sub>
</div>
