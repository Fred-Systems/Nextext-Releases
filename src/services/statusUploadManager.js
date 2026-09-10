// ─────────────────────────────────────────────────────────────────────────────
// App-level Status upload/posting job manager.
//
// A status post must survive the Status Builder / Status Screen unmounting. If the
// user selects media, edits it, presses Post, then leaves the Status page, the
// upload + Firestore write must continue to completion and must NOT be cancelled
// by React unmounting the composer.
//
// This module owns that lifecycle at the application level (it is a plain module,
// not a React component, so it persists across navigation). Each post is a job
// with a stable id, a status, progress text, retry, and cancellation.
//
// Idempotency: a job that already reached "posted" will not re-post on retry.
// Cloudinary upload is the ONLY media backend (no Supabase fallback for ordinary
// NexText media).
// ─────────────────────────────────────────────────────────────────────────────

const jobs = new Map(); // jobId -> job
const listeners = new Set();

function emit() {
  for (const l of listeners) {
    try { l(); } catch {}
  }
}

export function subscribeStatusJobs(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getStatusJobs() {
  return [...jobs.values()];
}

export function getActiveStatusJobCount() {
  let n = 0;
  for (const j of jobs.values()) {
    if (j.status === "uploading" || j.status === "posting" || j.status === "queued") n++;
  }
  return n;
}

// Run an asynchronous post task under a job id. `task` receives an `update`
// callback for progress text and must return when the post is complete. The task
// should perform the Cloudinary upload(s) + postStatus write. The job lives here,
// so even if the React tree that called `runStatusJob` unmounts mid-flight, the
// upload/persist continue (they live on this module's promise chain).
export async function runStatusJob({ jobId, label, task, onDone }) {
  const id = jobId || `status-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const existing = jobs.get(id);
  if (existing && (existing.status === "posted" || existing.status === "posting" || existing.status === "uploading")) {
    // Already done or in flight under this id — do not duplicate.
    return existing.promise;
  }
  const job = {
    id,
    label: label || "Status",
    status: "queued",
    progress: "Preparing…",
    error: null,
    createdAt: Date.now(),
    promise: null,
    controller: new AbortController(),
  };
  jobs.set(id, job);
  emit();

  const update = (progress) => {
    job.progress = progress || job.progress;
    emit();
  };

  job.promise = (async () => {
    try {
      job.status = "uploading";
      emit();
      const result = await task({ update, signal: job.controller.signal });
      // task is expected to have performed postStatus; mark posted.
      job.status = "posted";
      job.progress = "Posted";
      emit();
      try { onDone?.(result); } catch {}
      return result;
    } catch (err) {
      job.status = "error";
      job.error = err?.message || String(err);
      job.progress = "Failed";
      emit();
      throw err;
    }
  })();

  return job.promise;
}

// Retry a failed job. `rebuildTask` must return a fresh task closure (capturing
// the same inputs) so we can re-run it. Idempotent: if already posted, no-op.
export function retryStatusJob(id, rebuildTask) {
  const job = jobs.get(id);
  if (!job) return Promise.resolve();
  if (job.status === "posted") return Promise.resolve();
  job.status = "queued";
  job.error = null;
  job.controller = new AbortController();
  emit();
  job.promise = (async () => {
    try {
      job.status = "uploading";
      emit();
      const result = await rebuildTask({ update: (p) => { job.progress = p; emit(); }, signal: job.controller.signal });
      job.status = "posted";
      job.progress = "Posted";
      emit();
      return result;
    } catch (err) {
      job.status = "error";
      job.error = err?.message || String(err);
      emit();
      throw err;
    }
  })();
  return job.promise;
}

export function cancelStatusJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  job.controller?.abort?.();
  job.status = "cancelled";
  emit();
}

export function clearFinishedStatusJobs() {
  for (const [id, j] of jobs) {
    if (j.status === "posted" || j.status === "cancelled" || j.status === "error") jobs.delete(id);
  }
  emit();
}
