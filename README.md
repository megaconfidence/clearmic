<div align="center">

<img src="public/icon.svg" alt="ClearMic" width="84" height="84" />

# ClearMic

**Studio-grade voice cleanup, in your browser.**

[Try it →](https://clearmic.conflare.workers.dev)

</div>

---

## Noise out. Voice forward.

Background hum, room reverb, street bleed, fan whine — they ruin recordings. ClearMic strips them out and hands you back a clean WAV. No desktop apps, no plugin chains, no learning curve.

Drop a file, pick a strength, get clean audio back in under a minute.

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
2. **Pick a strength** — Light, Balanced, or Aggressive. Choose Enhanced (polished) or Denoised (natural).
3. **Verify your email** — a 6-digit code. No passwords.
4. **Wait under a minute** — close the tab if you want, your spot is saved.
5. **Download the clean WAV** — yours for 24 hours, then it's gone.

## Privacy by default

- All audio is **automatically purged 24 hours** after upload
- No tracking, no analytics, no third-party ads
- Sessions expire after 30 days
- 10 cleanups per day per email — keeps costs sustainable and abuse contained

## The engine

ClearMic runs on [`resemble-ai/resemble-enhance`](https://replicate.com/resemble-ai/resemble-enhance), a state-of-the-art speech enhancement model. Two operating modes:

- **Denoise** — strips background noise without coloring the voice
- **Enhance** — denoises *and* applies subtle voice enhancement for a more finished sound

You pick. The model never alters output behind your back.

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
| AI | Replicate (`resemble-ai/resemble-enhance`) |

Browser uploads go **directly to R2** via 15-minute presigned PUT URLs, so the Worker never buffers large upload bodies. The presigned URLs sign exact `Content-Type`, `Content-Length`, and custom metadata; the completion endpoint verifies the stored object before queueing. Sessions live in D1 (not KV) for stronger consistency and revocability. Replicate output URLs are validated against an allowlist of `replicate.delivery` hosts before fetching.

</details>

<details>
<summary><strong>Project layout</strong></summary>

<br>

| Path | What |
| --- | --- |
| `src/index.ts` | API router + Queue handler |
| `src/auth.ts` | Email OTP, D1 sessions |
| `src/uploads.ts` | Direct-to-R2 upload intents, quota |
| `src/jobs.ts` | Job status, input, webhook, download |
| `src/replicate.ts` | Prediction lifecycle, output persistence |
| `src/r2.ts` | Presigned R2 PUT URL signing (`aws4fetch`) |
| `src/turnstile.ts` | Turnstile siteverify |
| `src/db.ts` | D1 helpers, public job shape |
| `src/audio.ts`, `src/model.ts`, `src/http.ts` | Shared helpers |
| `public/index.html`, `styles.css`, `app.js` | UI |
| `public/icon.svg` | App icon (favicon + apple-touch-icon) |
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
| `GET` | `/api/jobs/:id/download?token=…` | Download clean output |

Upload body: `{ fileName, fileType, fileSize, preset, output_choice }`

- `preset` — `light` · `balanced` · `aggressive`
- `output_choice` — `enhanced` · `denoised`

</details>

<details>
<summary><strong>Local development</strong></summary>

<br>

```bash
npm install
cp .env.example .env   # fill in secrets
npm run db:migrate:local
npm run dev            # localhost only
# or
npm run dev:tunnel     # public URL via Cloudflare Tunnel
```

Replicate fetches uploaded audio from a **public HTTPS URL**, so end-to-end denoising against `localhost` won't work. Use `dev:tunnel` to get a public URL Replicate can reach.

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
npx wrangler r2 bucket cors set clearmic-audio --file r2-cors.json
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
- `APP_ORIGINS` in `wrangler.jsonc` must match the origins in `r2-cors.json`

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
- 10 cleanups per email per rolling 24h window (counts queued jobs + pending uploads)
- Direct R2 uploads via 15-minute presigned URLs — Worker never buffers upload bodies
- Upload URLs sign exact `Content-Type`, `Content-Length`, and ClearMic metadata; `/complete` re-verifies the stored object
- Per-job random tokens guard Replicate input, webhook, and download routes
- R2 lifecycle hard-deletes after 1 day; D1 `expires_at` blocks access at exactly 24h
- R2 CORS and app origins pinned via `APP_ORIGINS`
- OTPs: 10 min TTL, single-use, locked after 5 wrong attempts

</details>

---

<div align="center">
<sub>Built on Cloudflare Workers · Powered by Replicate</sub>
</div>
