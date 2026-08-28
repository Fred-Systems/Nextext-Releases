# Status Video Pipeline — NexText v1.7.37

Adaptive HLS for Status videos with private originals, signed URLs, and lightweight card previews.

## Summary

Every Status video is uploaded private, validated server-side, transcoded to HLS (360p/540p/720p fMP4, 2s segments, keyframes at boundaries) plus fallback MP4, poster, preview, and a 240p muted 2.5s card-preview. Only `ready` statuses expose HLS/fallback/poster URLs. `queued → processing → ready|failed` with idempotent worker retries. Expiry (24h) deletes original + all derived assets. Card previews are 40–100 KB, cached LRU, and never fetch the full HLS until the user opens the Status.

## Upload & State

1. Client validates client-side (size ≤50 MB, duration ≤60s, allow-listed container via file signature).
2. Upload original to `status/{uid}/{statusId}/original.mp4` (private, RLS deny anon) via `uploadPrivateFile`.
3. Create Firestore `status` doc:
   ```
   { ownerId, mediaType:"video", state:"queued", originalPath, posterPath: null, hlsMasterPath:null, fallbackPath:null, renditions:null, durationMs, createdAt, expiresAt }
   ```
4. Worker polls `where state=="queued"`, validates with `ffprobe` (magic bytes, decode check, rotation, dimensions, fps, codec allow-list), normalizes orientation, preserves aspect, never upscales, caps 720p/30fps, yuv420p, H264/AAC.
5. Transcode renditions that don't upscale:
   - 360p ~450 kbps (maxrate 675k, bufsize 900k)
   - 540p ~900 kbps (1.35M/1.8M)
   - 720p ~1.6 Mbps (2.4M/3.2M)
   Vertical retains geometry e.g. 720x1280 via `scale=w='min(iw,720)':h=-2`.
   ```
   ffmpeg -i input -vf scale=... -c:v libx264 -profile high -pix_fmt yuv420p -r 30 -g 60 -force_key_frames expr:gte(t,n_forced*2) -b:v <bv> -maxrate <max> -bufsize <buf> -c:a aac -b:a 128k -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments master.m3u8
   ```
6. Master `master.m3u8` includes only non-upscaled variants. Fallback progressive `fallback.mp4` (720p) for non-HLS clients. Poster (`poster.jpg` 640w, q=2) and preview (`preview.jpg`) + card-preview (`card_preview.mp4` 240p, 12fps, 150k, muted, 2.5s) are generated. Card preview >150 KB logs warning / fails CI.
7. Upload derived assets to `status/{uid}/{statusId}/hls/...`, `fallback.mp4`, `poster.jpg`, `card_preview.mp4` with `cache-control: public, max-age=31536000, immutable` (master 60s) but effective TTL never exceeds `expiresAt`.
8. Mark `ready` with `hlsMasterPath`, `fallbackPath`, `posterPath`, `cardPreviewPath`, `renditions`, `assetVersion:1`. Idempotent: if `state==ready` and `assetVersion` matches, skip.
9. On failure, set `failed` with safe `errorCode` (`UNSUPPORTED_CODEC`, `CORRUPT_FILE`, `DURATION_TOO_LONG`, `PROCESSING_FAILED`) and user message, no FFmpeg internals to client. Owner can `retryStatus(statusId)` → `queued`.

Pipeline flag: `config/globalSettings.statusVideoPipelineEnabled` (default false on Spark). When false, video Status uses legacy direct `mediaURL` (public) for backwards compat.

## Security

- Auth, size (50 MB), duration (60s), rate-limit (same messageLimits), opaque keys (`status/{uid}/{id}/...`), never original filename.
- Allow-list containers via `ffprobe` decode, not MIME.
- Safe args via `spawn` array, never shell.
- Private bucket + `createSignedUrl(path, ttl)` where `ttl = min(3600, expiresAt-now)`. Only `ownerId` and contacts can read `status` docs (client-side filter); worker uses admin SDK. No SSRF (no URL fetch).
- CDN signed cookies option: set `STATUS_CDN_SIGNED_COOKIES=true` to issue cookies vs per-request URLs; avoids unique URL per replay while still auth'd.

## Client Playback

- `StatusStoryViewer` shows poster immediately, then HLS master via `<HlsVideo>` (native HLS on iOS, hls.js elsewhere). `hls.js` config: `startLevel:0`, `capLevelToPlayerSize:true`, `abrBandWidthFactor:0.8` (down early), buffer 1–2 segments (`maxBufferLength:10`).
- Fallback to `fallback.mp4` if HLS unavailable.
- Prefetch next Status poster + low rendition first segment when appropriate (1 ahead).
- Respects cellular (via `navigator.connection.saveData`), battery (`navigator.getBattery`), background (`visibilitychange` pauses), autoplay/mute prefs, and cleans up `hls.destroy()` + `URL.revokeObjectURL`.
- Offline/expired/deleted/failed: show placeholder or retry; expired URLs trigger re-sign, not hard error.

## Card Preview

- Dedicated `card_preview.mp4` (max 2.5s, muted, 240p/360p, 12fps, 120–180k, ≤220k cap, yuv420p) + still `poster.jpg` (40–100 KB typical, warn >150 KB).
- Never uses full HLS. Initially load poster only. After card ≥75% visible for 600 ms, fetch preview (not off-screen). Play once or one short loop, never continuous. Cancel in-flight + release player when not visible. Max 1 current +1 next prefetch. Respect data-saver/battery/background/autoplay. LRU cache until expiry; evict on delete/block/hide/expire.

## Replay & Cache

- Stable versioned keys `status/{uid}/{id}/...` immutable for lifetime.
- `Cache-Control: immutable` for segments/poster/preview/fallback, `max-age` = min(immutable, time-to-expiry).
- Local cache via `src/media/statusCache.js` (IndexedDB fallback to localStorage) keyed by `statusId + assetVersion + expiresAt`, bounded LRU (80 entries), check before fetch.
- Cache only after auth; never bypass audience/block/expiry checks. Invalidate on delete/block/expire.

## Message Media Encoding

Images: 1080p JPEG via `browser-image-compression` (existing). Videos in messages: client validates (50 MB, 60s, allow-listed), caps display at 720p via CSS, server pipeline for messages is `statusVideoPipelineEnabled` shared flag; when enabled, message videos also go through queued transcode (creates `chats/{id}/messages/{mid}/hls/...`). Spark fallback: direct upload with warning. All message media uses same private+signed URL model when pipeline enabled.

## Observability

Worker logs JSON: `upload_duration, queue_delay, transcode_duration, errorCode, sourceBytes, outputBytes, renditions, compressionRatio`. Client metrics in `src/media/metrics.js`: `time_to_first_frame, rebufferCount, rebufferDuration, renditionSwitches, completionRate, manifest/segment/CDN/auth errors, previewSize, previewBytesServed, cacheHitRate, egressPerSession`. No private URLs/tokens.

## Storage & CDN Lifecycle

Bucket `chat-media` private. Lifecycle: `status/{uid}/{id}/` prefix holds original, hls, fallback, poster, preview, card_preview. `deleteStatusWithAssets` deletes prefix. Worker cron also scans `where expiresAt < now` to cleanup.

CDN: Supabase Storage CDN or CloudFront with signed URLs/cookies. Set `STATUS_BUCKET=chat-media`.

## Tests

```
npm run lint
npm run build
npm run test:video  # vitest workers/videoTranscode/*.test.js
```

Covers: vertical/horizontal/rotated/silent/high-fps/short/corrupt/unsupported, no upscale, manifest, idempotency, auth, expiry cleanup, processing/ready/failed, HLS/fallback, card-preview size/behavior, replay cache.

## Rollback

Set `statusVideoPipelineEnabled=false` in Firestore `config/globalSettings`. Clients fall back to legacy `mediaURL` path. Worker drained. No data loss.

## Infra / Env

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
STATUS_BUCKET=chat-media
HLS_SEGMENT_SECONDS=2
STATUS_VIDEO_PIPELINE_ENABLED=false
```

Deploy: `firebase use nextext-ddf38 && firebase deploy --only firestore:rules` + `npm run build && npx cap sync android && ./gradlew assembleRelease`. Worker: `docker build -t nextext/video-worker -f workers/videoTranscode/Dockerfile . && run --env-file .env` or Cloud Function `onDocumentCreated("status/{id}")`.

Cost: see README.

## Compatibility

iOS 12+ (native HLS), Android Chrome 83+ via hls.js (fMP4), web via hls.js. yuv420p + H264 + AAC baseline ensures widest.

Follow-up: DRM, per-title encoding, WebCodecs client preview, thumbnail sprites, analytics dashboard.

