import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildManifest } from "./build-journey-manifest.mjs";

test("buildManifest 汇总旅程状态并为截图生成 SHA-256", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "process-sentinel-manifest-"));
  try {
    await mkdir(path.join(root, "screenshots"));
    await writeFile(path.join(root, "screenshots", "UJ01_首屏.png"), "journey-evidence");
    await writeFile(path.join(root, "playwright-results.json"), JSON.stringify({
      stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0, duration: 1250 },
      errors: [],
      suites: [{
        title: "user-journeys.spec.ts",
        suites: [{
          title: "序安完整前后端用户旅程",
          specs: [{
            title: "UJ-01 演示回放",
            ok: true,
            tests: [{ results: [{ status: "passed", duration: 1200 }] }],
          }],
        }],
      }],
    }));

    const manifest = await buildManifest({
      target: "fixture",
      baseURL: "https://example.test",
      evidenceRoot: root,
      sourceCommit: "abc123",
      generatedAt: "2026-08-29T00:00:00.000Z",
    });

    assert.equal(manifest.summary.passed, 1);
    assert.equal(manifest.summary.failed, 0);
    assert.equal(manifest.journeys[0].title, "UJ-01 演示回放");
    assert.equal(manifest.screenshots.length, 1);
    assert.match(manifest.screenshots[0].sha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.screenshotPolicy, /1440、1024、768、390/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
