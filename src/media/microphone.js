// Shared microphone acquisition used by every surface that records audio
// (voice notes, status voice notes, Groq speech-to-text). Centralized so the
// Android WebView quirks are fixed in ONE place — previously only the chat
// voice-note path had the working logic, while the status builder and the STT
// mic used bare getUserMedia and failed with "Could not start audio source" /
// "Microphone access denied" even though the OS mic permission was granted.
//
// The fixes below mirror the chat voice-note path:
//   1. Request the OS-level mic permission through the native bridge first
//      (the WebView caches a "denied" for the page session otherwise).
//   2. A "priming" acquire+release frees the AudioRecord/input state so the
//      real capture succeeds (common Android NotReadableError fix).
//   3. Retry against the explicit physical audioinput deviceId (the virtual
//      "default" device is sometimes busy/blocked).
//   4. Generous delays so the media stack fully releases between tries.

export async function requestMicPermission() {
  // NOTE: Previously this called the native NextextNative.requestMicrophone()
  // bridge. On the device that call left the WebView mic in a "denied"/busy
  // state so the subsequent getUserMedia failed with NotReadableError
  // ("Could not start audio source") — even though the OS permission was
  // granted and the chat voice-note path (which does NOT call the bridge)
  // worked fine. We now rely on the priming + retry loop below (same as the
  // working voice-note path) and intentionally skip the native bridge so STT
  // capture succeeds.
  return;
}

export async function getMicrophoneStream(constraints) {
  const isMic = !constraints?.video;
  const base = constraints || { audio: true };
  const RETRYABLE = ["NotAllowedError", "PermissionDeniedError", "NotReadableError", "TrackStartError", "AbortError", "OverconstrainedError"];
  const attempts = [];
  const push = (delay, c) => attempts.push({ delay, constraints: c });

  // Settle so the WebView media stack registers any OS-level grant.
  if (isMic) {
    await new Promise((r) => setTimeout(r, 500));
  }

  // Prime with the raw-input variant and release immediately so the device
  // state is fresh for the real capture below.
  if (isMic) {
    try {
      const primeStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      primeStream.getTracks().forEach((tr) => tr.stop());
    } catch { /* best-effort */ }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Capture the physical input deviceId AFTER priming — ids are blank until the
  // origin has media permission.
  let physicalInputId = null;
  if (isMic) {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const input = devs.find((d) => d.kind === "audioinput" && d.deviceId);
      if (input?.deviceId) physicalInputId = input.deviceId;
    } catch { /* ignore */ }
  }

  push(0, isMic ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } } : base);
  push(800, base);
  if (physicalInputId) {
    push(1800, { audio: { deviceId: { exact: physicalInputId } } });
    push(2600, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: physicalInputId } } });
  } else {
    push(1800, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  }
  push(3200, base);

  let firstError = null;
  for (const attempt of attempts) {
    if (attempt.delay > 0) await new Promise((r) => setTimeout(r, attempt.delay));
    try {
      return await navigator.mediaDevices.getUserMedia(attempt.constraints);
    } catch (err) {
      firstError = firstError || err;
      if (!RETRYABLE.includes(err.name)) throw err;
    }
  }

  if (isMic) {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const input = devs.find((d) => d.kind === "audioinput" && d.deviceId);
      if (input?.deviceId) {
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: input.deviceId } } });
        } catch (err) {
          firstError = firstError || err;
          if (!RETRYABLE.includes(err.name)) throw err;
        }
      }
    } catch { /* ignore */ }
  }

  firstError.isDenied = firstError.name === "NotAllowedError" || firstError.name === "PermissionDeniedError";
  // Last-ditch: try the most permissive constraints one final time.
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // ignore, throw the original error
  }
  throw firstError;
}