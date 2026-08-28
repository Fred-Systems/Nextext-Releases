#!/usr/bin/env node
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createClient } from "@supabase/supabase-js";
import { tmpdir } from "os";
import { join } from "path";
import { promises as fs, createWriteStream } from "fs";
import { probe, validateFile, renditionParams, generateHlsRendition, generatePoster, generateCardPreview } from "./ffmpeg.js";

// Idempotent worker: polls `status` where state=queued, transcodes, uploads assets, marks ready/failed.
// Safe args only, no shell interpolation.

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let db;
function initFirebase() {
  if (db) return db;
  const sa = process.env.FIREBASE_PRIVATE_KEY ? {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  } : null;
  if (sa) initializeApp({ credential: cert(sa) });
  else initializeApp();
  db = getFirestore();
  return db;
}

const BUCKET = process.env.STATUS_BUCKET || "chat-media";

async function downloadOriginal(statusDoc, tmpPath) {
  const data = statusDoc.data();
  const origPath = data.originalPath || data.mediaPath || data.originalFilePath;
  if (!origPath) throw Object.assign(new Error("MISSING_ORIGINAL"), { code: "MISSING_ORIGINAL" });
  // Try Supabase download via service role (private)
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(origPath);
  if (error) throw Object.assign(new Error("DOWNLOAD_FAILED"), { code: "DOWNLOAD_FAILED" });
  const buf = await blob.arrayBuffer();
  await fs.writeFile(tmpPath, Buffer.from(buf));
}

async function uploadAsset(localPath, remotePath, contentType, cacheControl) {
  const buf = await fs.readFile(localPath);
  const { error } = await supabase.storage.from(BUCKET).upload(remotePath, buf, { contentType, upsert: true, cacheControl });
  if (error) throw error;
}

async function processOne(statusRef) {
  const snap = await statusRef.get();
  if (!snap.exists) return;
  const data = snap.data();
  if (data.state !== "queued") return;
  const statusId = snap.id;
  const uid = data.ownerId;
  console.log(JSON.stringify({ msg: "processing_start", statusId, uid, durationMs: data.durationMs }));
  const t0 = Date.now();
  // Mark processing transactionally (idempotent)
  await db.runTransaction(async (tx) => {
    const s = await tx.get(statusRef);
    if (!s.exists || s.data().state !== "queued") throw new Error("ABORT_NOT_QUEUED");
    tx.update(statusRef, { state: "processing", processingStartedAt: FieldValue.serverTimestamp(), attempts: FieldValue.increment(1) });
  }).catch((e) => { if (e.message === "ABORT_NOT_QUEUED") throw e; });

  const tmpIn = join(tmpdir(), `nextext-in-${statusId}.mp4`);
  const tmpDir = join(tmpdir(), `nextext-${statusId}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await downloadOriginal(snap, tmpIn);
    const p = await validateFile(tmpIn);
    // Normalize caps
    const isVertical = p.h > p.w;
    const rends = renditionParams(p.w, p.h);
    // Fallback to at least 360p if source smaller than 360 but still need one rendition
    const effectiveRends = rends.length ? rends : [{ h: 360, bv: "450k", maxrate: "675k", bufsize: "900k" }];
    const variantDirs = [];
    for (const r of effectiveRends) {
      const dir = join(tmpDir, `hls_${r.h}p`);
      await fs.mkdir(dir, { recursive: true });
      await generateHlsRendition(tmpIn, dir, r.h, r.bv, r.maxrate, r.bufsize, isVertical, 2);
      variantDirs.push({ h: r.h, dir, ...r });
    }
    // Master playlist: include only renditions that didn't upscale (already filtered)
    // ffmpeg already generated per-variant master? We'll generate a combined master by merging.
    // For simplicity, let first variant's master be the combined if single; else create manual master
    const posterPath = join(tmpDir, "poster.jpg");
    const previewPath = join(tmpDir, "preview.jpg");
    const cardPreviewPath = join(tmpDir, "card_preview.mp4");
    const fallbackPath = join(tmpDir, "fallback.mp4");
    await generatePoster(tmpIn, posterPath, 640);
    await fs.copyFile(posterPath, previewPath);
    await generateCardPreview(tmpIn, cardPreviewPath);
    // Fallback progressive 720p
    const { spawn } = await import("child_process");
    const fallbackVf = isVertical ? "scale=w='min(iw,720)':h=-2" : "scale=w=-2:h='min(ih,720)'";
    await new Promise((res, rej) => {
      const args = ["-y", "-i", tmpIn, "-vf", `${fallbackVf},setsar=1`, "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30", "-b:v", "1600k", "-maxrate", "2400k", "-bufsize", "3200k", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", fallbackPath];
      import("child_process").then(({ spawn }) => {
        const p = spawn("ffmpeg", args);
        let er = "";
        p.stderr.on("data", d => er += d);
        p.on("close", c => c === 0 ? res() : rej(new Error(er.slice(0, 400))));
      });
    });

    // Upload derived assets
    const base = `status/${uid}/${statusId}`;
    for (const v of variantDirs) {
      const files = await fs.readdir(v.dir);
      for (const f of files) {
        const local = join(v.dir, f);
        const remote = `${base}/hls/${v.h}p/${f}`;
        const ct = f.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/iso.segment";
        await uploadAsset(local, remote, ct, "public, max-age=31536000, immutable");
      }
    }
    // Combined master: concat variant masters (simple: pick first variant's master if only one, else generate)
    // Generate a simple master.m3u8
    let masterContent = "#EXTM3U\n";
    for (const v of variantDirs) {
      const bw = parseInt(v.bv, 10) * 1000;
      masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${isVertical ? `${v.h}x${Math.round(v.h * (p.w / p.h))}` : `${Math.round(v.h * (p.w / p.h))}x${v.h}`}\n`;
      masterContent += `${v.h}p/index.m3u8\n`;
    }
    const masterTmp = join(tmpDir, "master.m3u8");
    await fs.writeFile(masterTmp, masterContent);
    await uploadAsset(masterTmp, `${base}/hls/master.m3u8`, "application/vnd.apple.mpegurl", "public, max-age=60");

    await uploadAsset(fallbackPath, `${base}/fallback.mp4`, "video/mp4", "public, max-age=31536000, immutable");
    await uploadAsset(posterPath, `${base}/poster.jpg`, "image/jpeg", "public, max-age=31536000, immutable");
    await uploadAsset(previewPath, `${base}/preview.jpg`, "image/jpeg", "public, max-age=31536000, immutable");
    await uploadAsset(cardPreviewPath, `${base}/card_preview.mp4`, "video/mp4", "public, max-age=31536000, immutable");

    const outBytes = variantDirs.length * 1024 * 1024; // placeholder
    const processingMs = Date.now() - t0;
    console.log(JSON.stringify({ msg: "processing_done", statusId, renditions: effectiveRends.map((r) => r.h), processingMs, isVertical, duration: p.duration }));

    await statusRef.update({
      state: "ready",
      assetVersion: "1",
      hlsMasterPath: `${base}/hls/master.m3u8`,
      fallbackPath: `${base}/fallback.mp4`,
      posterPath: `${base}/poster.jpg`,
      previewPath: `${base}/preview.jpg`,
      cardPreviewPath: `${base}/card_preview.mp4`,
      renditions: effectiveRends.map((r) => ({ h: r.h, bitrate: r.bv, path: `${base}/hls/${r.h}p/index.m3u8` })),
      processedAt: FieldValue.serverTimestamp(),
      errorCode: FieldValue.delete(),
      errorMessage: FieldValue.delete(),
    });
  } catch (e) {
    const code = e.code || "PROCESSING_FAILED";
    const safe = code.replace(/[^A-Z0-9_]/g, "_").slice(0, 32);
    console.error(JSON.stringify({ msg: "processing_failed", statusId: snap.id, code: safe, error: e.message?.slice(0, 200) }));
    await statusRef.update({
      state: "failed",
      errorCode: safe,
      errorMessage: safe === "DURATION_TOO_LONG" ? "Video too long (max 60s)." : safe === "CORRUPT_FILE" ? "Can't read video file." : "Video processing failed. Try a different file.",
      failedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
  } finally {
    // Cleanup tmp
    try { await fs.rm(tmpIn, { force: true }); } catch {}
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function poll() {
  initFirebase();
  const snap = await db.collection("status").where("state", "==", "queued").orderBy("createdAt").limit(5).get();
  for (const doc of snap.docs) {
    try { await processOne(doc.ref); } catch (e) { if (e.message !== "ABORT_NOT_QUEUED") console.error(e); }
  }
}

if (process.argv.includes("--once")) {
  const idx = process.argv.indexOf("--statusId");
  const statusId = idx !== -1 ? process.argv[idx + 1] : null;
  initFirebase();
  if (statusId) {
    const ref = db.collection("status").doc(statusId);
    processOne(ref).then(() => process.exit(0));
  } else {
    poll().then(() => process.exit(0));
  }
} else {
  initFirebase();
  console.log("Worker polling every 5s...");
  setInterval(poll, 5000);
  poll();
}
