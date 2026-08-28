import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:18092";
const target = process.env.PLAYWRIGHT_EVIDENCE_TARGET ?? "local";
const evidenceRoot = path.resolve(
  process.env.PLAYWRIGHT_EVIDENCE_DIR
    ?? `90_构建与分析缓存/用户旅程验收_v01/${target}`,
);

export default defineConfig({
  testDir: "./playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: path.join(evidenceRoot, "test-results"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidenceRoot, "playwright-results.json") }],
    ["html", { outputFolder: path.join(evidenceRoot, "html-report"), open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
