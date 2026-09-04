// NexText Cloudflare Worker — serves the SPA and proxies AI voice generation.
//
// /api/generate-voice (POST): forwards a text prompt to Fish Audio's TTS
// endpoint using a server-side API key (never exposed to the frontend). The
// key is read from Firestore (config/fishAudioKey) if an admin has set one via
// the dashboard, otherwise it falls back to the FISH_AUDIO_API_KEY env var.
// The raw MP3 is returned with permissive CORS headers so the Android WebView
// (origin https://localhost) and the web build (same origin) can both use it.

const FIREBASE_PROJECT = "nextext-ddf38";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (url.pathname === "/api/generate-voice") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      return generateVoice(request, env);
    }

    if (url.pathname === "/api/convert-voice") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      return convertVoice(request, env);
    }

    // YidStatus global feed proxy. The upstream /functions/v1/feed endpoint
    // requires `Origin: https://yidstatus.com`, which a browser/WebView fetch
    // cannot set (forbidden header). This Worker adds it server-side. The anon
    // JWT is the public, read-only key shipped in the YidStatus web bundle.
    if (url.pathname === "/api/yidstatus-feed") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      return yidStatusFeed(request, env);
    }

    // Everything else falls through to the static SPA assets.
    return env.ASSETS.fetch(request);
  },
};

async function generateVoice(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const text = String(body.text || "").slice(0, 800).trim();
  if (!text) return json({ error: "No text provided" }, 400);

  const referenceId = body.referenceId || "9cc36d13d091468fa9c4cab838a6ecdf";
  const model = body.model || "s2.1-pro-free";

  // The Fish Audio key is NEVER hardcoded here — it is managed entirely from the
  // Admin Dashboard (stored in Firestore config/fishAudioKey) so it stays secret
  // and rotatable without a deploy. The Worker reads it server-side.
  const apiKey = (await getFishKeyFromFirestore(env)) || env.FISH_AUDIO_API_KEY;
  if (!apiKey) {
    return json({ error: "Voice service is not configured. Set the Fish Audio API key in the Admin Dashboard." }, 503);
  }

  let upstream;
  try {
    upstream = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model,
      },
      body: JSON.stringify({ text, reference_id: referenceId, model, format: "mp3" }),
    });
  } catch (e) {
    return json({ error: "Could not reach the voice service." }, 502);
  }

  if (!upstream.ok) {
    const detail = await safeText(upstream);
    return json({ error: `Voice service error (${upstream.status}). ${detail}` }, 502);
  }

  const audio = await upstream.arrayBuffer();
  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

// Voice conversion: the user records their own voice, we forward it (plus the
// target reference_id) to Fish Audio's /v1/convert endpoint and stream the
// converted audio back. Nothing is persisted — it's a pass-through proxy.
async function convertVoice(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid form data" }, 400);
  }
  const file = form.get("file");
  const referenceId = String(form.get("reference_id") || "").trim() ||
    "9cc36d13d091468fa9c4cab838a6ecdf";
  if (!file || typeof file === "string") {
    return json({ error: "No audio file provided" }, 400);
  }

  const apiKey = (await getFishKeyFromFirestore(env)) || env.FISH_AUDIO_API_KEY;
  if (!apiKey) {
    return json({ error: "Voice service is not configured. Set the Fish Audio API key in the Admin Dashboard." }, 503);
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("reference_id", referenceId);

  let upstream;
  try {
    upstream = await fetch("https://api.fish.audio/v1/convert", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
  } catch {
    return json({ error: "Could not reach the voice service." }, 502);
  }

  if (!upstream.ok) {
    const detail = await safeText(upstream);
    return json({ error: `Voice conversion error (${upstream.status}). ${detail}` }, 502);
  }

  const audio = await upstream.arrayBuffer();
  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

// Read the admin-managed Fish Audio key from Firestore (config/fishAudioKey).
// Uses the public web API key so this works from the edge without a service
// account. That document is intentionally world-readable so the Worker can read
// it, but the frontend never fetches it (getSystemConfig reads config/system).
//
// The key is cached in-memory for 10 minutes so we don't hammer the Firestore
// public REST API on every voice request (it is rate-limited and would otherwise
// return 429 and break voice generation).
let _fishKeyCache = null;
let _fishKeyCacheAt = 0;
const FISH_KEY_TTL = 10 * 60 * 1000;
// Proxy the YidStatus global feed. Adds the required Origin header server-side.
const YID_STATUS_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzaW53YWxxaGd3YXBldndpYm1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2ODEyODUsImV4cCI6MjA5ODI1NzI4NX0.ZwrXgeUknPSDAWsOzdI8jdj7wCO9xOe7glLSj3OB_vA";

async function yidStatusFeed(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const payload = { days: Number(body.days) || 1, since: body.since || null };
  try {
    const upstream = await fetch("https://api.yidstatus.com/functions/v1/feed", {
      method: "POST",
      headers: {
        apikey: YID_STATUS_KEY,
        "Content-Type": "application/json",
        Origin: "https://yidstatus.com",
      },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      return json({ error: "Upstream YidStatus error", status: upstream.status }, 502);
    }
    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return json({ error: "Could not reach YidStatus." }, 502);
  }
}

async function getFishKeyFromFirestore(env) {
  const now = Date.now();
  if (_fishKeyCache && now - _fishKeyCacheAt < FISH_KEY_TTL) return _fishKeyCache;
  const webApiKey = env.FIREBASE_WEB_API_KEY;
  if (!webApiKey) return null;
  const docUrl =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}` +
    `/databases/(default)/documents/config/fishAudioKey?key=` +
    encodeURIComponent(webApiKey);
  try {
    const res = await fetch(docUrl);
    if (!res.ok) return _fishKeyCache || null;
    const data = await res.json();
    const key = data?.fields?.key?.stringValue;
    if (key) {
      _fishKeyCache = key;
      _fishKeyCacheAt = now;
    }
    return key || null;
  } catch {
    return _fishKeyCache || null;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
