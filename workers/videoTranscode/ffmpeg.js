import { spawn } from "child_process";
import { promises as fs } from "fs";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "", err = "";
    p.stdout.on("data", (d) => out += d);
    p.stderr.on("data", (d) => err += d);
    p.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 400)}`)));
    p.on("error", reject);
  });
}

export async function probe(filePath) {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,rotation,codec_name,duration,avg_frame_rate", "-show_entries", "format=duration", "-of", "json", filePath]);
  const j = JSON.parse(out);
  const s = j.streams?.[0] || {};
  const fmt = j.format || {};
  let w = parseInt(s.width, 10) || 0;
  let h = parseInt(s.height, 10) || 0;
  const rot = parseInt(s.rotation, 10) || 0;
  // Normalize rotated dimensions: 90/270 swaps w/h
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  const fps = (() => {
    const r = s.avg_frame_rate || s.r_frame_rate || "0/1";
    const [n, d] = r.split("/").map(Number);
    return d ? n / d : 0;
  })();
  const dur = parseFloat(s.duration || fmt.duration || "0");
  return { w, h, fps, rotation: rot, duration: dur, codec: s.codec_name };
}

export function renditionParams(sourceW, sourceH) {
  const isVertical = sourceH > sourceW;
  // Do not upscale: only include renditions <= source
  const candidates = [
    { h: 360, bv: "450k", maxrate: "675k", bufsize: "900k" },
    { h: 540, bv: "900k", maxrate: "1350k", bufsize: "1800k" },
    { h: 720, bv: "1600k", maxrate: "2400k", bufsize: "3200k" },
  ];
  return candidates.filter((c) => {
    if (isVertical) {
      // For vertical, cap width at 720 (short side) → height 1280 for 720p. Use width as proxy: sourceW
      const capW = c.h; // 360->360w, 720->720w
      return sourceW >= capW;
    } else {
      return sourceH >= c.h;
    }
  }).map((c) => {
    // If none meet threshold and source is e.g. 480p, include at least lowest that doesn't upscale too much? Keep no-upscale strict.
    return c;
  });
}

export function scaleFilter(sourceW, sourceH, targetH) {
  const isVertical = sourceH > sourceW;
  if (isVertical) {
    return `scale=w='min(iw,${targetH})':h=-2:flags=lanczos:eval=frame`;
  } else {
    return `scale=w=-2:h='min(ih,${targetH})':flags=lanczos:eval=frame`;
  }
}

export async function transcodeRendition(input, output, targetH, bv, maxrate, bufsize, isVertical) {
  const vf = [
    // Normalize orientation (auto-rotate) + preserve aspect, no upscale, no stretch
    scaleFilter(0, 0, targetH), // placeholder; actual dimensions injected by caller if needed; keep generic for now
    "setsar=1",
  ].join(",");
  // Use actual source-aware scale: caller will override vf if needed
  const args = [
    "-y",
    "-i", input,
    "-vf", `scale=w=-2:h='min(ih,${targetH})':flags=lanczos:eval=frame,setsar=1`,
    "-c:v", "libx264",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-g", "60", // 2s at 30fps
    "-keyint_min", "60",
    "-sc_threshold", "0",
    "-force_key_frames", "expr:gte(t,n_forced*2)",
    "-b:v", bv, "-maxrate", maxrate, "-bufsize", bufsize,
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
    "-movflags", "+faststart",
    output,
  ];
  // For vertical, switch scale to cap width
  if (isVertical) {
    const idx = args.indexOf("-vf");
    if (idx !== -1) args[idx + 1] = `scale=w='min(iw,${targetH})':h=-2:flags=lanczos:eval=frame,setsar=1`;
  }
  await run("ffmpeg", args);
}

export async function generateHlsRendition(input, variantDir, targetH, bv, maxrate, bufsize, isVertical, segSec = 2) {
  const vf = isVertical ? `scale=w='min(iw,${targetH})':h=-2:flags=lanczos` : `scale=w=-2:h='min(ih,${targetH})':flags=lanczos`;
  const args = [
    "-y", "-i", input,
    "-vf", vf,
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-r", "30", "-g", String(30 * segSec), "-keyint_min", String(30 * segSec), "-sc_threshold", "0",
    "-force_key_frames", `expr:gte(t,n_forced*${segSec})`,
    "-b:v", bv, "-maxrate", maxrate, "-bufsize", bufsize,
    "-c:a", "aac", "-b:a", "128k",
    "-hls_time", String(segSec),
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_flags", "independent_segments",
    "-hls_segment_filename", `${variantDir}/seg_%04d.m4s`,
    "-master_pl_name", "master.m3u8",
    `${variantDir}/index.m3u8`,
  ];
  await run("ffmpeg", args);
}

export async function generatePoster(input, output, w = 640) {
  // First visually useful frame ~0.5s
  await run("ffmpeg", ["-y", "-ss", "0.5", "-i", input, "-vframes", "1", "-vf", `scale=w=${w}:h=-2:flags=lanczos`, "-q:v", "2", output]);
}

export async function generateCardPreview(input, output) {
  // 2.5s, muted, 240p, 12fps, 120-180k, cap 220k
  await run("ffmpeg", [
    "-y", "-ss", "0", "-t", "2.5", "-i", input,
    "-vf", "scale=w=-2:h='min(ih,240)':flags=lanczos,fps=12,setsar=1",
    "-an",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-b:v", "150k", "-maxrate", "220k", "-bufsize", "300k",
    "-movflags", "+faststart",
    output,
  ]);
  const stat = await fs.stat(output);
  if (stat.size > 150 * 1024) console.warn(`[card-preview] oversize ${stat.size} >150KB`);
}

export async function validateFile(filePath) {
  // Check magic bytes via ffprobe can decode; also probe for codecs
  const p = await probe(filePath);
  if (!p.w || !p.h) throw Object.assign(new Error("CORRUPT_FILE"), { code: "CORRUPT_FILE" });
  // Allow-list codecs: h264, hevc, vp8/9, av1 for input; reject non-video if we expected video
  // Also check duration limits (e.g. 60s)
  if (p.duration > 60) throw Object.assign(new Error("DURATION_TOO_LONG"), { code: "DURATION_TOO_LONG" });
  return p;
}
