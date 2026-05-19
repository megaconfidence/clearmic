# ClearMic MVP

Cloudflare Worker MVP for uploading voice recordings, denoising them with Replicate, and storing the cleaned output in R2.

## Stack

- Worker Static Assets for the UI in `public/`
- R2 for raw and cleaned audio files
- D1 for job metadata
- Queues for async job kickoff
- Replicate `resemble-ai/resemble-enhance` for audio cleanup

## Setup

Create the Cloudflare resources:

```sh
npx wrangler r2 bucket create clearmic-audio
npx wrangler queues create clearmic-audio-jobs
npx wrangler d1 create clearmic-db
```

Paste the D1 `database_id` from `wrangler d1 create` into `wrangler.jsonc`.

Set the Replicate token for deployed Workers:

```sh
npx wrangler secret put REPLICATE_API_TOKEN
```

For local development, set `REPLICATE_API_TOKEN` in `.env`. Replicate must fetch uploaded audio from a public HTTPS URL, so end-to-end local denoising needs `npm run dev:tunnel` and the public tunnel URL, not `localhost`. Do not create `.dev.vars` if you want Wrangler to load `.env`, because `.dev.vars` takes precedence.

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

- `POST /api/jobs` with multipart field `audio` creates and queues a job.
- Optional `POST /api/jobs` fields: `preset` as `light`, `balanced`, or `aggressive`; `output_choice` as `enhanced` or `denoised`.
- `GET /api/jobs/:id` returns status and opportunistically syncs Replicate completion.
- `GET /api/jobs/:id/download?token=...` downloads the cleaned audio when complete.

## Project Layout

- `src/index.ts` routes API and Queue events.
- `src/jobs.ts` handles upload, status, input, webhook, and download routes.
- `src/replicate.ts` creates predictions and persists completed outputs.
- `src/db.ts` contains D1 helpers and the public job response shape.
- `src/audio.ts`, `src/model.ts`, and `src/http.ts` contain small shared helpers.
- `public/index.html`, `public/styles.css`, and `public/app.js` contain the static UI.

## Abuse Protection

- `POST /api/jobs` is rate limited to 5 requests per minute per client IP per Cloudflare location using the Workers Rate Limiting binding.
- Replicate callback/input/download routes remain protected by per-job random tokens.
