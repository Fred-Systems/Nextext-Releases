# NexText Status Video Transcoding Pipeline

Async HLS pipeline for Status videos. Keeps originals private, generates adaptive HLS (360p/540p/720p), fallback MP4, poster, preview, and card-preview (240p muted 2.5s).

## Architecture

```
Client → upload original to Supabase private path → create Firestore status doc (state=queued)
   ↓
Worker (Node + FFmpeg) polls `status` where state=queued
   → validates (magic bytes, ffprobe)
   → normalizes orientation, caps 720p/30fps, yuv420p, H264/AAC
   → generates HLS fMP4 segments (2s, keyframes at boundaries) + master playlist (no upscale)
   → fallback progressive MP4 + poster + preview + card-preview
   → uploads derived assets to Supabase
   → marks status ready (or failed) idempotently
   ↓
Client feed shows HLS master (or fallback) only when ready; shows poster immediately; card previews are 240p muted 2.5s MP4s.
Expiry/deletion removes original + all derived assets.
```

## Why private, signed URLs

Originals are stored at `status/{uid}/{statusId}/original.*` with no public URL. All playback uses short-lived signed URLs (`createSignedUrl`) with max TTL = min(1h, time-to-expiry). HLS segments are immutable and cached with `Cache-Control: public, max-age=<ttl>, immutable` but never beyond `expiresAt`.

## Status lifecycle

`uploading → queued → processing → ready → (expired/deleted)`
`queued|processing|ready|failed` are visible; `failed` shows safe `errorCode` (e.g. `UNSUPPORTED_CODEC`, `DURATION_TOO_LONG`, `CORRUPT_FILE`) without FFmpeg internals.

Idempotency: worker uses transaction `if state != ready then set processing`; duplicate completions check `assetVersion` and skip if already ready with same version.

## Local setup

```bash
# 1. Install FFmpeg + ffprobe (required)
ffmpeg -version   # >=6.0, with libx264 + aac
ffprobe -version

# 2. Configure env (see .env.example)
cp workers/videoTranscode/.env.example .env
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_* , STATUS_BUCKET=chat-media

# 3. Install worker deps
npm --prefix workers/videoTranscode install

# 4. Run worker (polls every 5s)
npm --prefix workers/videoTranscode run start

# 5. Or run once for a queued status
node workers/videoTranscode/worker.js --once --statusId=abc123
```

## FFmpeg deployment

- **Local / Cloud Run**: Dockerfile `FROM jrottenberg/ffmpeg:6-alpine` + Node 20. Push to Cloud Run, set `SUPABASE_*` and `FIREBASE_SERVICE_ACCOUNT` env.
- **Firebase Blaze**: Deploy as Cloud Function v2 `onDocumentCreated("status/{id}")` with `memory: 1GiB, timeout: 300s, concurrency: 10`, FFmpeg layer.
- Spark plan cannot run Functions/Cloud Run; pipeline is scaffolded and docs show upgrade path.

## Storage / CDN

- Bucket: `chat-media` (private, RLS denies anon). All status assets under `status/{uid}/{statusId}/...`.
- CDN: Supabase Storage CDN or CloudFront in front of bucket, with signed cookies/URLs. HLS segments use `immutable` cache; master playlist `max-age=60`.
- Cleanup: `deleteStatusWithAssets(statusId)` deletes Firestore doc + `status/{uid}/{statusId}/` prefix via `deleteChatFile` loop.

## Cost

720p 1.6 Mbps, 10s video ≈ 2 MB input → ~6 MB HLS (3 renditions + fallback) + 0.5 MB poster/preview. Transcoding ~0.05 vCPU-sec per second of video. At 10k statuses/day, ~$20–40/mo FFmpeg + storage/egress dominated by HLS (3× vs single file) but saves 60% cellular egress via ABR vs serving 1080p originals.

## Tests

```bash
npm run test:video   # Vitest suite: vertical/horizontal/rotated/silent/high-fps/short/corrupt/unsupported, no-upscale, manifest, idempotency, auth, cleanup
```

Rollback: set `STATUS_VIDEO_PIPELINE_ENABLED=false` in system_config, clients fall back to original direct URL path.

## Observability

Worker logs JSON with `statusId, durationMs, sourceBytes, outputBytes, renditions, errorCode`. Client reports `time_to_first_frame`, `rebufferCount`, `renditionSwitches` via `src/media/metrics.js` (not PII).

## Environment

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
FIREBASE_PROJECT_ID=nextext-ddf38
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=...
STATUS_BUCKET=chat-media
HLS_SEGMENT_SECONDS=2
ENABLE_CARD_PREVIEW=true
```
