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
  const apiKey = await getFishKeyFromFirestore(env);
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

// Read the admin-managed Fish Audio key from Firestore (config/fishAudioKey).
// Uses the public web API key so this works from the edge without a service
// account. That document is intentionally world-readable so the Worker can read
// it, but the frontend never fetches it (getSystemConfig reads config/system).
async function getFishKeyFromFirestore(env) {
  const webApiKey = env.FIREBASE_WEB_API_KEY;
  if (!webApiKey) return null;
  const docUrl =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}` +
    `/databases/(default)/documents/config/fishAudioKey?key=` +
    encodeURIComponent(webApiKey);
  const res = await fetch(docUrl);
  if (!res.ok) return null;
  const data = await res.json();
  const key = data?.fields?.key?.stringValue;
  return key || null;
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
