import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

type Scenario = { id: string; faultOnsetSample: number };
type Run = { id: string; state: string; currentSample: number };
type Event = { id: string; state: string; sampleIndex: number };
type EventDetail = Event & {
  candidates: Array<{ faultId: number; label: string; probability: number }>;
  evidence: Array<{ variableId: string; variableName: string }>;
  recommendation: {
    mode: "template" | "llm_enhanced" | "degraded";
    safetyBoundary: "Read-only advice. No automatic control write-back.";
  };
  modelVersion: string;
};
type AIAnswer = {
  answer: string;
  mode: "llm_enhanced" | "template" | "degraded";
  model: string;
  evidenceRefs: string[];
  latencyMs: number;
  traceId: string;
};
type AIInteractionPage = {
  items: Array<AIAnswer & { eventId: string; question: string }>;
  total: number;
};
type AIStatus = {
  inferenceMode: "online" | "template";
  worker: { status: string; version?: string | null; reason?: string | null };
  industrialModel: { status: string; version?: string | null; reason?: string | null };
  languageModel: { status: string; version?: string | null; reason?: string | null };
  dataBuildHash: string;
};
type AIConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  promptVersion: string;
  fallbackPolicy: "template" | "degraded";
  apiKeyConfigured: boolean;
  version: number;
};

type ControlProposal = {
  eventId: string;
  actionDraft: string;
  sourceTraceId: string | null;
  executionMode: "shadow";
  state: "blocked_demo_boundary";
  checks: Array<{ name: string; status: string }>;
  sent: false;
};

const target = process.env.PLAYWRIGHT_EVIDENCE_TARGET ?? "local";
const evidenceRoot = path.resolve(
  process.env.PLAYWRIGHT_EVIDENCE_DIR
    ?? `90_构建与分析缓存/用户旅程验收_v01/${target}`,
);
const screenshotRoot = path.join(evidenceRoot, "screenshots");
const journeyStamp = `pw-${Date.now()}`;

const accounts = {
  operator: { username: "operator-01", password: "demo-op-2026", displayName: "中控操作员 01" },
  lead: { username: "shift-lead", password: "demo-lead-2026", displayName: "当班班长" },
  engineer: { username: "process-engineer", password: "demo-eng-2026", displayName: "工艺工程师" },
  admin: { username: "system-admin", password: "demo-admin-2026", displayName: "系统管理员" },
} as const;

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(250);
  await mkdir(screenshotRoot, { recursive: true });
  const viewportPath = path.join(screenshotRoot, `${name}_首屏.png`);
  const fullPagePath = path.join(screenshotRoot, `${name}_全页.png`);
  await page.screenshot({ path: viewportPath, fullPage: false, animations: "disabled" });
  await page.screenshot({ path: fullPagePath, fullPage: true, animations: "disabled" });
  await testInfo.attach(`${name}-viewport`, { path: viewportPath, contentType: "image/png" });
  await testInfo.attach(`${name}-full-page`, { path: fullPagePath, contentType: "image/png" });
}

async function login(page: Page, account: (typeof accounts)[keyof typeof accounts], next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("操作员账号").fill(account.username);
  await page.getByLabel("口令").fill(account.password);
  await page.getByRole("button", { name: "登录中控工作台" }).click();
  await expect(page).toHaveURL(/\/events(?:$|\?)/);
  await expect(page.getByRole("banner").getByText(account.displayName)).toBeVisible();
  await expect(page.getByRole("button", { name: "退出" })).toBeVisible();
}

async function getScenario(request: APIRequestContext): Promise<Scenario> {
  const response = await request.get("/api/v1/scenarios");
  expect(response.ok()).toBeTruthy();
  const scenarios = await response.json() as Scenario[];
  expect(scenarios.length).toBeGreaterThanOrEqual(3);
  return scenarios.find((scenario) => scenario.id === "tep-f01-feed-ratio-step") ?? scenarios[0];
}

async function getAuthToken(
  request: APIRequestContext,
  account: (typeof accounts)[keyof typeof accounts],
): Promise<string> {
  const response = await request.post("/api/v1/auth/login", {
    data: { username: account.username, password: account.password },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { token: string };
  expect(payload.token).not.toBe("");
  return payload.token;
}

async function createEvent(
  request: APIRequestContext,
  suffix: string,
  inferenceMode: "online" | "template" = "template",
): Promise<{ run: Run; event: Event }> {
  const scenario = await getScenario(request);
  const key = `${journeyStamp}-${suffix}`;
  const createResponse = await request.post("/api/v1/runs", {
    headers: { "Idempotency-Key": `${key}-run` },
    data: { scenarioId: scenario.id, speed: 20, inferenceMode },
  });
  expect(createResponse.ok()).toBeTruthy();
  let run = await createResponse.json() as Run;
  if (run.state !== "playing") {
    const playResponse = await request.post(`/api/v1/runs/${run.id}/control`, {
      headers: { "Idempotency-Key": `${key}-play` },
      data: { action: "play", speed: 20 },
    });
    expect(playResponse.ok()).toBeTruthy();
    run = await playResponse.json() as Run;
  }

  let event: Event | undefined;
  await expect.poll(async () => {
    const eventsResponse = await request.get(`/api/v1/runs/${run.id}/events`);
    expect(eventsResponse.ok()).toBeTruthy();
    const events = await eventsResponse.json() as Event[];
    event = events.find((candidate) => candidate.state === "open") ?? events[0];
    return event?.id ?? "";
  }, { timeout: inferenceMode === "online" ? 90_000 : 20_000, intervals: [500, 1_000, 2_000] }).not.toBe("");
  return { run, event: event! };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
}

test.describe.serial("序安完整前后端用户旅程", () => {
  let onlineEvent: Event;
  let leadEvent: Event;
  let engineerEvent: Event;
  const operatorQuestion = `E2E 用户旅程 ${journeyStamp}：为什么不是传感器故障？`;
  const adminAuditQuestion = `E2E 后台审计 ${journeyStamp}：当前证据链是否完整？`;
  const aiTraceQuestion = `E2E AI 证据链 ${journeyStamp}：请说明最关键的三项过程变量及原因。`;

  test.beforeAll(async ({ request }) => {
    ({ event: onlineEvent } = await createEvent(request, "operator-online", "online"));
    ({ event: leadEvent } = await createEvent(request, "lead-confirm"));
    ({ event: engineerEvent } = await createEvent(request, "engineer-reject"));
  });

  test("UJ-01 访客从演示入口创建回放，样本推进、暂停、恢复并捕获事件", async ({ page }, testInfo) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "选择场景并创建真实回放" })).toBeVisible();
    await capture(page, testInfo, "UJ01-01_演示入口");

    await page.goto("/replay");
    await expect(page.getByRole("heading", { name: "52 路过程数据回放" })).toBeVisible();
    await page.getByLabel("回放场景").selectOption("tep-f01-feed-ratio-step");
    await page.getByRole("button", { name: "开始回放" }).click();
    await expect(page.getByText("回放进行中")).toBeVisible();
    await page.getByLabel("回放倍速").selectOption("20");

    const sample = page.getByTestId("current-sample");
    await expect.poll(async () => Number(await sample.textContent()), { timeout: 30_000 }).toBeGreaterThan(0);
    await capture(page, testInfo, "UJ01-02_在线回放推进");

    await page.getByRole("button", { name: "暂停回放" }).click();
    await expect(page.getByText("回放已暂停")).toBeVisible();
    const paused = Number(await sample.textContent());
    await page.waitForTimeout(1_200);
    expect(Number(await sample.textContent())).toBe(paused);
    await page.getByRole("button", { name: "开始回放" }).click();
    await expect.poll(async () => Number(await sample.textContent()), { timeout: 20_000 }).toBeGreaterThan(paused);

    await expect(page.getByRole("link", { name: /进入事件研判/ })).toBeVisible({ timeout: 90_000 });
    await capture(page, testInfo, "UJ01-03_偏移捕获");
    await expectNoHorizontalOverflow(page);
  });

  test("UJ-02 未登录用户看见完整 AI 依据、登录门和只读写回预演", async ({ page }, testInfo) => {
    await page.goto(`/events/${onlineEvent.id}`);
    await expect(page.getByRole("heading", { name: "AI 研判结论" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top-3 关键变量证据" })).toBeVisible();
    await expect(page.getByText("未登录：请先登录后使用在线 AI")).toBeVisible();
    await expect(page.getByRole("heading", { name: "由人决定是否采纳" })).toBeVisible();
    await capture(page, testInfo, "UJ02-01_未登录事件研判");

    await page.getByRole("button", { name: /预演写回/ }).click();
    await expect(page.getByText("草案已生成，未校验、未发送")).toBeVisible();
    await capture(page, testInfo, "UJ02-02_受控写回仅预演");
  });

  test("UJ-03 中控操作员在线追问 AI，只能升级并形成可追溯记录", async ({ page }, testInfo) => {
    await login(page, accounts.operator);
    await page.goto(`/events/${onlineEvent.id}`);
    await page.getByLabel("向序安追问").fill(operatorQuestion);
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(page.locator(".assistant-message")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".copilot-answer-meta")).toContainText(/模型|证据|Trace/);
    await capture(page, testInfo, "UJ03-01_操作员AI追问");

    const decision = page.locator('select[name="decision"]');
    await expect(decision.locator("option")).toHaveCount(1);
    await expect(decision).toHaveValue("escalate");
    await page.getByLabel("研判说明").fill(`操作员升级验证 ${journeyStamp}`);
    await page.getByRole("button", { name: "确认并形成记录" }).click();
    const recordLink = page.getByRole("link", { name: "打开审计记录" });
    await expect(recordLink).toBeVisible();
    await recordLink.click();
    await expect(page.getByText("升级处理")).toBeVisible();
    await expect(page.getByText("中控操作员 01 (operator-01)", { exact: true })).toBeVisible();
    await expect(page.getByText("Trace ID")).toBeVisible();
    await capture(page, testInfo, "UJ03-02_操作员升级记录");
  });

  test("UJ-04 当班班长可以确认偏移并留下身份、模型与 Trace", async ({ page }, testInfo) => {
    await login(page, accounts.lead);
    await page.goto(`/events/${leadEvent.id}`);
    const decision = page.locator('select[name="decision"]');
    await expect(decision.locator("option")).toHaveCount(3);
    await decision.selectOption("confirm");
    await page.getByLabel("研判说明").fill(`班长确认偏移 ${journeyStamp}`);
    await page.getByRole("button", { name: "确认并形成记录" }).click();
    await page.getByRole("link", { name: "打开审计记录" }).click();
    await expect(page.getByText("确认偏移", { exact: true })).toBeVisible();
    await expect(page.getByText("当班班长 (shift-lead)", { exact: true })).toBeVisible();
    await capture(page, testInfo, "UJ04-01_班长确认记录");
  });

  test("UJ-05 工艺工程师可以驳回偏移并留下独立审计记录", async ({ page }, testInfo) => {
    await login(page, accounts.engineer);
    await page.goto(`/events/${engineerEvent.id}`);
    await page.locator('select[name="decision"]').selectOption("reject");
    await page.getByLabel("建议采纳情况").selectOption("overridden");
    await page.getByLabel("研判说明").fill(`工程师驳回偏移 ${journeyStamp}`);
    await page.getByRole("button", { name: "确认并形成记录" }).click();
    await page.getByRole("link", { name: "打开审计记录" }).click();
    await expect(page.getByText("驳回偏移", { exact: true })).toBeVisible();
    await expect(page.getByText("工艺工程师 (process-engineer)", { exact: true })).toBeVisible();
    await capture(page, testInfo, "UJ05-01_工程师驳回记录");
  });

  test("UJ-06 管理后台执行 RBAC、运行概览、只读 AI 配置、调用与配置审计", async ({ page }, testInfo) => {
    await login(page, accounts.operator);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "无权访问管理后台" })).toBeVisible();
    await capture(page, testInfo, "UJ06-01_普通账号拒绝后台");

    await page.goto(`/events/${onlineEvent.id}`);
    await page.getByLabel("向序安追问").fill(adminAuditQuestion);
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(page.locator(".assistant-message")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /退出/ }).click();
    await login(page, accounts.admin);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "AI 运行概览" })).toBeVisible();
    await expect(page.getByLabel("服务状态摘要")).toContainText(/Worker|工业模型|语言模型/);
    await capture(page, testInfo, "UJ06-02_管理运行概览");

    await page.getByRole("link", { name: "AI 配置" }).click();
    await expect(page.getByRole("heading", { name: "AI 运行配置" })).toBeVisible();
    const onlineEnhancement = page.getByRole("checkbox", { name: "启用在线语言模型增强" });
    if (await onlineEnhancement.isChecked()) {
      await expect(page.locator("span").filter({ hasText: /语言模型：/ }).first()).toBeVisible();
      await expect(page.getByLabel("API 密钥（只写）")).toHaveValue("");
    } else {
      await expect(page.getByRole("status").filter({ hasText: "在线增强当前已禁用" })).toBeVisible();
    }
    await page.getByRole("button", { name: "保存配置" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /公开演示环境的 AI 配置为只读|read-only/i }))
      .toBeVisible();
    await capture(page, testInfo, "UJ06-03_AI配置只读边界");

    await page.getByRole("link", { name: "调用记录" }).click();
    await expect(page.getByRole("heading", { name: "AI 调用记录" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: adminAuditQuestion })).toBeVisible({ timeout: 20_000 });
    await capture(page, testInfo, "UJ06-04_AI调用记录");

    await page.getByRole("link", { name: "配置审计" }).click();
    await expect(page.getByRole("heading", { name: "配置审计" })).toBeVisible();
    await expect(page.getByText(/暂无配置审计|变更字段/)).toBeVisible();
    await capture(page, testInfo, "UJ06-05_配置审计");
  });

  test("UJ-07 系统状态同时验证前端可见健康信息与后端 health/readiness", async ({ page, request }, testInfo) => {
    const health = await request.get("/healthz");
    const readiness = await request.get("/readyz");
    expect(health.ok()).toBeTruthy();
    expect(readiness.ok()).toBeTruthy();
    expect((await health.json()).status).toBe("ok");
    expect((await readiness.json()).checks).toMatchObject({ database: "available", industrial_model: "available" });

    await page.goto("/system");
    await expect(page.getByRole("heading", { name: "数据与模型健康" })).toBeVisible();
    await expect(page.getByRole("table", { name: "系统依赖检查" })).toContainText(/database|industrial_model/);
    await expect(page.getByRole("main").getByText("当前 Demo 只读", { exact: true })).toBeVisible();
    await capture(page, testInfo, "UJ07-01_系统健康与只读边界");
  });

  test("UJ-08 核心页面在桌面、平板与手机均无水平溢出", async ({ page }, testInfo) => {
    await login(page, accounts.admin);
    const viewports = [
      { name: "桌面1440", width: 1440, height: 900 },
      { name: "平板1024", width: 1024, height: 768 },
      { name: "手机390", width: 390, height: 844 },
    ];
    const routes = [
      { name: "演示", path: "/demo" },
      { name: "回放", path: "/replay" },
      { name: "事件", path: `/events/${onlineEvent.id}` },
      { name: "后台", path: "/admin" },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of routes) {
        await page.goto(route.path);
        await expect(page.locator("main")).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
      await page.goto(`/events/${onlineEvent.id}`);
      await capture(page, testInfo, `UJ08-${viewport.name}_事件页`);
    }
  });

  test("UJ-09 AI 从工业模型研判、证据解释到调用审计保持同一条可追溯链路", async ({ page, request }, testInfo) => {
    const detailResponse = await request.get(`/api/v1/events/${onlineEvent.id}`);
    expect(detailResponse.ok()).toBeTruthy();
    const detail = await detailResponse.json() as EventDetail;
    expect(detail.modelVersion).toMatch(/^tep-pca-hgb-/);
    expect(detail.candidates.length).toBeGreaterThanOrEqual(1);
    expect(detail.evidence).toHaveLength(3);
    expect(detail.recommendation.safetyBoundary)
      .toBe("Read-only advice. No automatic control write-back.");

    const operatorToken = await getAuthToken(request, accounts.operator);
    const answerResponse = await request.post(`/api/v1/events/${onlineEvent.id}/ask`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
      data: { question: aiTraceQuestion },
    });
    expect(answerResponse.ok()).toBeTruthy();
    const answer = await answerResponse.json() as AIAnswer;
    expect(answer.answer.trim()).not.toBe("");
    expect(["llm_enhanced", "template", "degraded"]).toContain(answer.mode);
    expect(answer.model.trim()).not.toBe("");
    expect(answer.evidenceRefs.length).toBeGreaterThanOrEqual(1);
    expect(answer.latencyMs).toBeGreaterThanOrEqual(0);
    expect(answer.traceId.trim()).not.toBe("");
    const evidenceIds = new Set(detail.evidence.map((item) => item.variableId));
    for (const ref of answer.evidenceRefs) expect(evidenceIds.has(ref), ref).toBeTruthy();

    await login(page, accounts.operator);
    await page.goto(`/events/${onlineEvent.id}`);
    await expect(page.getByRole("heading", { name: "AI 研判结论" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top-3 关键变量证据" })).toBeVisible();
    await page.getByLabel("向序安追问").fill(`页面核验 ${aiTraceQuestion}`);
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(page.locator(".assistant-message")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".copilot-answer-meta")).toContainText(/在线 AI|模板降级/);
    await expect(page.locator(".copilot-answer-meta")).toContainText(/模型：.+证据：.+Trace：/);
    await capture(page, testInfo, "UJ09-01_AI研判与证据解释");

    const adminToken = await getAuthToken(request, accounts.admin);
    const interactionsResponse = await request.get("/api/v1/admin/ai/interactions?limit=100&offset=0", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(interactionsResponse.ok()).toBeTruthy();
    const interactions = await interactionsResponse.json() as AIInteractionPage;
    const audited = interactions.items.find((item) => item.question === aiTraceQuestion);
    expect(audited).toBeDefined();
    expect(audited).toMatchObject({
      eventId: onlineEvent.id,
      answer: answer.answer,
      mode: answer.mode,
      model: answer.model,
      evidenceRefs: answer.evidenceRefs,
      traceId: answer.traceId,
    });

    await page.getByRole("button", { name: /退出/ }).click();
    await login(page, accounts.admin);
    await page.goto("/admin/interactions");
    const auditedRow = page.getByRole("row").filter({ hasText: answer.traceId });
    await expect(auditedRow).toHaveCount(1, { timeout: 20_000 });
    await expect(auditedRow).toContainText(aiTraceQuestion);
    await capture(page, testInfo, "UJ09-02_AI调用同链审计");
  });

  test("UJ-10 AI 运行模式、降级原因、密钥不回显和公网只读边界全部透明", async ({ page, request }, testInfo) => {
    const adminToken = await getAuthToken(request, accounts.admin);
    const headers = { Authorization: `Bearer ${adminToken}` };

    const statusResponse = await request.get("/api/v1/admin/ai/status", { headers });
    expect(statusResponse.ok()).toBeTruthy();
    const status = await statusResponse.json() as AIStatus;
    expect(status.inferenceMode).toBe("online");
    expect(status.worker.status).toBe("ready");
    expect(status.industrialModel.status).toBe("ready");
    expect(status.industrialModel.version).toMatch(/^tep-pca-hgb-/);
    expect(["ready", "degraded", "offline", "unknown"]).toContain(status.languageModel.status);
    if (status.languageModel.status !== "ready") expect(status.languageModel.reason?.trim()).not.toBe("");
    expect(status.dataBuildHash.trim()).not.toBe("");

    const configResponse = await request.get("/api/v1/admin/ai/config", { headers });
    expect(configResponse.ok()).toBeTruthy();
    const configText = await configResponse.text();
    const config = JSON.parse(configText) as AIConfig & Record<string, unknown>;
    expect(config).toMatchObject({
      provider: expect.any(String),
      baseUrl: expect.any(String),
      model: expect.any(String),
      enabled: expect.any(Boolean),
      timeoutMs: expect.any(Number),
      maxTokens: expect.any(Number),
      temperature: expect.any(Number),
      promptVersion: expect.any(String),
      fallbackPolicy: expect.stringMatching(/^(template|degraded)$/),
      apiKeyConfigured: expect.any(Boolean),
      version: expect.any(Number),
    });
    expect(Object.prototype.hasOwnProperty.call(config, "apiKey")).toBeFalsy();
    expect(configText).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]{12,}/);

    const updateResponse = await request.put("/api/v1/admin/ai/config", {
      headers: { ...headers, "Idempotency-Key": `${journeyStamp}-ai-config-write-boundary` },
      data: { expectedVersion: config.version, enabled: config.enabled },
    });
    expect(updateResponse.status()).toBe(403);
    expect(await updateResponse.json()).toMatchObject({ code: "admin_ai_read_only" });
    const connectionResponse = await request.post("/api/v1/admin/ai/test", {
      headers: { ...headers, "Idempotency-Key": `${journeyStamp}-ai-test-boundary` },
      data: { question: "E2E 公网只读边界检查" },
    });
    expect(connectionResponse.status()).toBe(403);
    expect(await connectionResponse.json()).toMatchObject({ code: "admin_ai_read_only" });

    await login(page, accounts.admin);
    await page.goto("/admin");
    await expect(page.getByLabel("服务状态摘要")).toContainText("在线增强路径");
    await expect(page.getByLabel("服务状态摘要")).toContainText("工业模型");
    await expect(page.getByLabel("服务状态摘要")).toContainText("语言模型");
    await capture(page, testInfo, "UJ10-01_AI运行与降级状态透明");

    await page.goto("/admin/ai");
    const secretInput = page.getByLabel("API 密钥（只写）");
    await expect(secretInput).toHaveValue("");
    await expect(page.getByText("密钥值不会出现在配置响应、调用记录或审计详情中。")).toBeVisible();
    if (!config.enabled) await expect(page.getByRole("button", { name: "测试连接" })).toBeDisabled();
    await capture(page, testInfo, "UJ10-02_AI配置密钥与只读边界");
  });

  test("UJ-11 操作员以 AI Trace 编辑拟议动作并完成只读影子门禁核验", async ({ page, request }, testInfo) => {
    const shadowQuestion = `E2E 影子门禁 ${journeyStamp}：请给出安全的现场检查与监视建议。`;
    const editedDraft = "保持当前控制策略，提高关键变量监视频率，并由班长复核现场检查结果。";

    await login(page, accounts.operator);
    await page.goto(`/events/${onlineEvent.id}`);
    const answerMessages = page.locator(".assistant-message");
    const previousAnswerCount = await answerMessages.count();
    await page.getByLabel("向序安追问").fill(shadowQuestion);
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(answerMessages).toHaveCount(previousAnswerCount + 1, { timeout: 30_000 });
    const answerMeta = page.locator(".copilot-answer-meta").last();
    await expect(answerMeta).toContainText(/Trace：.+/);
    const traceId = (await answerMeta.textContent())?.match(/Trace：([^\s]+)/)?.[1];
    expect(traceId).toBeTruthy();

    const draft = page.getByRole("textbox", { name: "拟议处置动作" });
    await draft.fill(editedDraft);
    await page.getByRole("button", { name: "运行影子门禁" }).click();
    await expect(page.getByRole("status").filter({ hasText: "影子评估已记录，控制网关保持关闭" }))
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("影子门禁结果").getByRole("listitem")).toHaveCount(5);
    await expect(page.getByText("5 项门禁中 2 项通过，3 项阻断；从未向 PLC/DCS 发送。"))
      .toBeVisible();
    await capture(page, testInfo, "UJ11-01_AI人工编辑影子门禁");

    const operatorToken = await getAuthToken(request, accounts.operator);
    const proposalsResponse = await request.get(`/api/v1/events/${onlineEvent.id}/control-proposals`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    expect(proposalsResponse.ok()).toBeTruthy();
    const proposals = await proposalsResponse.json() as ControlProposal[];
    const proposal = proposals.find((candidate) => candidate.sourceTraceId === traceId);
    expect(proposal).toBeDefined();
    expect(proposal).toMatchObject({
      eventId: onlineEvent.id,
      actionDraft: editedDraft,
      sourceTraceId: traceId,
      executionMode: "shadow",
      state: "blocked_demo_boundary",
      sent: false,
    });
    expect(proposal?.checks).toHaveLength(5);
    expect(proposal?.checks.filter((check) => check.status === "passed")).toHaveLength(2);
    expect(proposal?.checks.filter((check) => check.status !== "passed")).toHaveLength(3);
  });
});
