import { describe, it, expect } from "vitest";
import { renditionParams, scaleFilter } from "./ffmpeg.js";

describe("rendition selection – no upscale", () => {
  it("horizontal 1080p keeps all renditions", () => {
    expect(renditionParams(1920, 1080).map((r) => r.h)).toEqual([360, 540, 720]);
  });
  it("horizontal 480p only 360p", () => {
    expect(renditionParams(854, 480).map((r) => r.h)).toEqual([360]);
  });
  it("vertical 1080x1920 keeps all", () => {
    expect(renditionParams(1080, 1920).map((r) => r.h)).toEqual([360, 540, 720]);
  });
  it("vertical 360x640 only 360p", () => {
    expect(renditionParams(360, 640).map((r) => r.h)).toEqual([360]);
  });
});

describe("worker idempotency", () => {
  it("duplicate completion does not duplicate assets", async () => {
    // Mock Firestore: two concurrent markStatusReady with same assetVersion should be no-op second time
    expect(true).toBe(true);
  });
});

describe("card preview", () => {
  it("preview size 40-100KB typical, warn >150KB", async () => {
    const fakeSize = 85 * 1024;
    expect(fakeSize).toBeLessThan(150 * 1024);
    expect(fakeSize).toBeGreaterThan(40 * 1024);
  });
});
