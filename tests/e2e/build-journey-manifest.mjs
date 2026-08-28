import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function collectSpecs(node, specs = []) {
  if (Array.isArray(node?.specs)) specs.push(...node.specs);
  for (const suite of node?.suites ?? []) collectSpecs(suite, specs);
  return specs;
}

async function screenshotEntries(screenshotRoot) {
  const names = (await readdir(screenshotRoot))
    .filter((name) => name.endsWith(".png"))
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  return Promise.all(names.map(async (name) => {
    const absolutePath = path.join(screenshotRoot, name);
    const [buffer, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    return {
      file: `screenshots/${name}`,
      kind: name.includes("_全页") ? "full_page" : "viewport",
      bytes: metadata.size,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    };
  }));
}

export async function buildManifest({ target, baseURL, evidenceRoot, sourceCommit, generatedAt }) {
  const report = JSON.parse(await readFile(path.join(evidenceRoot, "playwright-results.json"), "utf8"));
  const specs = report.suites.flatMap((suite) => collectSpecs(suite));
  const journeys = specs.map((spec) => {
    const result = spec.tests?.[0]?.results?.at(-1) ?? {};
    return {
      id: spec.title.split(" ", 1)[0],
      title: spec.title,
      status: result.status ?? (spec.ok ? "passed" : "unknown"),
      durationMs: result.duration ?? 0,
    };
  });
  const screenshots = await screenshotEntries(path.join(evidenceRoot, "screenshots"));
  const passed = journeys.filter((journey) => journey.status === "passed").length;

  return {
    schemaVersion: "process-sentinel.user-journey-evidence.v1",
    product: "序安 Process Sentinel（序安·过程哨兵）",
    target,
    baseURL,
    sourceCommit,
    generatedAt,
    summary: {
      expected: report.stats.expected,
      passed,
      failed: journeys.length - passed,
      skipped: report.stats.skipped,
      flaky: report.stats.flaky,
      durationMs: report.stats.duration,
      screenshotCount: screenshots.length,
      viewportScreenshotCount: screenshots.filter((item) => item.kind === "viewport").length,
      fullPageScreenshotCount: screenshots.filter((item) => item.kind === "full_page").length,
    },
    journeys,
    screenshotPolicy: "每个关键用户状态同时保存当前视口与完整页面，响应式旅程覆盖 1440、1024、390 像素宽度。",
    screenshots,
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const target = argumentValue("--target");
  const baseURL = argumentValue("--base-url");
  if (!target || !baseURL) {
    throw new Error("usage: node build-journey-manifest.mjs --target <name> --base-url <url>");
  }
  const evidenceRoot = path.resolve(
    argumentValue("--evidence-dir") ?? `90_构建与分析缓存/用户旅程验收_v01/${target}`,
  );
  const sourceCommit = argumentValue("--source-commit")
    ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const manifest = await buildManifest({
    target,
    baseURL,
    evidenceRoot,
    sourceCommit,
    generatedAt: new Date().toISOString(),
  });
  const outputPath = path.join(evidenceRoot, "journey-manifest.json");
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
