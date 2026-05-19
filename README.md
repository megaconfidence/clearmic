# ClearMic MVP

Cloudflare Worker MVP for uploading voice recordings, denoising them with Replicate, and storing the cleaned output in R2.

## Stack

- Worker Static Assets for the UI in `public/`
- R2 for raw and cleaned audio files
- D1 for job metadata
- Queues for async job kickoff
- Cloudflare Email Service for email OTP login
- Replicate `resemble-ai/resemble-enhance` for audio cleanup

## Setup

Create the Cloudflare resources:

```sh
npx wrangler r2 bucket create clearmic-audio
npx wrangler queues create clearmic-audio-jobs
npx wrangler d1 create clearmic-db
npx wrangler r2 bucket lifecycle add clearmic-audio delete-after-1-day --expire-days 1
npx wrangler r2 bucket cors set clearmic-audio --file r2-cors.json
```

Paste the D1 `database_id` from `wrangler d1 create` into `wrangler.jsonc`.

Set the Replicate token for deployed Workers:

```sh
npx wrangler secret put REPLICATE_API_TOKEN
npx wrangler secret put EMAIL_FROM
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

`EMAIL_FROM` must be a sender on a domain configured for Cloudflare Email Service, for example `noreply@yourdomain.com`.
The R2 credentials should be scoped to the `clearmic-audio` bucket with object read/write access so the Worker can create presigned browser upload URLs.
`APP_ORIGINS` is a comma-separated list of app origins allowed to request direct upload URLs. Keep it in sync with `r2-cors.json`.

For local development, set the same secrets in `.env`. Replicate must fetch uploaded audio from a public HTTPS URL, so end-to-end local denoising needs `npm run dev:tunnel` and the public tunnel URL, not `localhost`. Do not create `.dev.vars` if you want Wrangler to load `.env`, because `.dev.vars` takes precedence.

Apply the D1 migration:

```sh
npm run db:migrate:local
npm run db:migrate:remote
```

Run locally:

```sh
npm run dev
```

Deploy:

```sh
npm run deploy
```

## API

- `POST /api/auth/request-otp` sends an email login code.
- `POST /api/auth/verify` verifies the code and sets an HttpOnly session cookie.
- `GET /api/me` returns the current session user.
- `POST /api/logout` clears the session.
- `POST /api/uploads` creates a short-lived presigned R2 upload URL.
- `POST /api/uploads/:id/complete` verifies the direct R2 upload and queues processing.
- `GET /api/jobs` returns the current user's active jobs.
- Upload options: `preset` as `light`, `balanced`, or `aggressive`; `output_choice` as `enhanced` or `denoised`.
- `GET /api/jobs/:id` returns status and opportunistically syncs Replicate completion.
- `GET /api/jobs/:id/download?token=...` downloads the cleaned audio when complete.
- R2 lifecycle deletes audio objects after 1 day. D1 `expires_at` hides and blocks expired jobs immediately at 24 hours.

## Project Layout

- `src/index.ts` routes API and Queue events.
- `src/uploads.ts` creates and completes direct R2 upload intents.
- `src/jobs.ts` handles job status, input, webhook, and download routes.
- `src/auth.ts` handles email OTP auth and session cookies.
- `src/turnstile.ts` validates Turnstile tokens for OTP requests.
- `src/r2.ts` creates presigned R2 upload URLs.
- `src/replicate.ts` creates predictions and persists completed outputs.
- `src/db.ts` contains D1 helpers and the public job response shape.
- `src/audio.ts`, `src/model.ts`, and `src/http.ts` contain small shared helpers.
- `public/index.html`, `public/styles.css`, and `public/app.js` contain the static UI.

## Abuse Protection

- Email OTP requests require Cloudflare Turnstile server-side validation.
- Processing is limited to 10 queued jobs per email per rolling 24-hour window.
- Browser uploads go directly to R2 via 15-minute presigned PUT URLs, so the Worker does not buffer large upload bodies.
- Direct upload URLs are signed to the declared `Content-Type`, exact `Content-Length`, and ClearMic metadata, then `/complete` verifies the stored R2 object before queueing processing.
- Replicate callback/input/download routes remain protected by per-job random tokens.
