import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = process.cwd();
const BUILD_DIR = path.join(ROOT, "90_构建与分析缓存/序安黑客松路演_v01");
const ASSET_DIR = path.join(BUILD_DIR, "assets");
const QA_DIR = path.join(BUILD_DIR, "qa");
const FINAL_PPTX = path.join(ROOT, "04_交付成品/序安_Process_Sentinel_黑客松路演_v01_ZH_REVIEW.pptx");

const C = {
  canvas: "#F7FBFE",
  panel: "#FFFFFF",
  elevated: "#FDFEFF",
  primary700: "#24839B",
  primary500: "#3996AE",
  accent500: "#13C2C2",
  text: "#102A3A",
  muted: "#627987",
  border: "#DCEAF5",
  success: "#27AE84",
  warning: "#F2A93B",
  error: "#DE5B6D",
  deep: "#071024",
  deep2: "#0B1B36",
  blue: "#006BFF",
  paleBlue: "#EAF6FB",
  paleWarn: "#FFF5E2",
  paleError: "#FFF0F2",
};

const FONT = "Source Han Sans SC";
const MONO = "Courier New";
const W = 1280;
const H = 720;
const ASSET_BYTES = {};

function addText(slide, text, position, options = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name: options.name,
    position,
    fill: options.fill ?? "none",
    line: options.line ?? { style: "solid", fill: "none", width: 0 },
    borderRadius: options.borderRadius,
  });
  shape.text = text;
  shape.text.style = {
    typeface: options.typeface ?? FONT,
    fontSize: options.fontSize ?? 18,
    bold: options.bold ?? false,
    color: options.color ?? C.text,
    alignment: options.alignment ?? "left",
    verticalAlignment: options.verticalAlignment ?? "top",
    autoFit: options.autoFit ?? "none",
    wrap: "square",
    insets: options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return shape;
}

function addBox(slide, position, options = {}) {
  return slide.shapes.add({
    geometry: options.geometry ?? "roundRect",
    name: options.name,
    position,
    fill: options.fill ?? C.panel,
    line: options.line ?? { style: "solid", fill: C.border, width: 1 },
    borderRadius: options.borderRadius ?? 16,
    shadow: options.shadow ?? "shadow-none",
  });
}

function addCircle(slide, cx, cy, diameter, fill, lineFill = fill) {
  return slide.shapes.add({
    geometry: "ellipse",
    position: { left: cx, top: cy, width: diameter, height: diameter },
    fill,
    line: { style: "solid", fill: lineFill, width: 1 },
  });
}

function addLine(slide, x, y, w, h, color, width = 2, style = "solid") {
  return slide.shapes.add({
    geometry: "line",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style, fill: color, width },
  });
}

function addImage(slide, filename, position, alt, options = {}) {
  return slide.images.add({
    blob: ASSET_BYTES[filename],
    contentType: "image/png",
    alt,
    fit: options.fit ?? "cover",
    crop: options.crop,
    geometry: options.geometry ?? "roundRect",
    borderRadius: options.borderRadius ?? 16,
    position,
  });
}

function addPageChrome(slide, page, dark = false, section = "序安 · 过程哨兵") {
  addText(slide, section, { left: 64, top: 30, width: 340, height: 24 }, {
    fontSize: 13,
    bold: true,
    color: dark ? "#A8C9FF" : C.primary700,
  });
  addText(slide, String(page).padStart(2, "0"), { left: 1170, top: 30, width: 46, height: 24 }, {
    fontSize: 13,
    bold: true,
    color: dark ? "#9CB2D1" : C.muted,
    alignment: "right",
    typeface: MONO,
  });
  addText(slide, "Process Sentinel · HACKATHON REVIEW", { left: 64, top: 680, width: 430, height: 18 }, {
    fontSize: 10,
    color: dark ? "#6E87AC" : "#8EA2AF",
    typeface: MONO,
  });
}

function addTitle(slide, title, subtitle, page, options = {}) {
  const dark = options.dark ?? false;
  addPageChrome(slide, page, dark, options.section);
  addText(slide, title, { left: 64, top: 72, width: options.width ?? 1120, height: 58 }, {
    fontSize: options.fontSize ?? 38,
    bold: true,
    color: dark ? "#FFFFFF" : C.text,
    verticalAlignment: "middle",
    autoFit: "none",
  });
  if (subtitle) {
    addText(slide, subtitle, { left: 64, top: 134, width: options.subtitleWidth ?? 1080, height: 46 }, {
      fontSize: 18,
      color: dark ? "#B7C7DE" : C.muted,
      lineSpacing: 23,
    });
  }
}

function addSourceNotes(slide, lines) {
  slide.speakerNotes.textFrame.setText(`[Sources]\n${lines.map((line) => `- ${line}`).join("\n")}`);
  slide.speakerNotes.setVisible(true);
}

function addMetric(slide, x, y, value, label, color = C.primary700, width = 220) {
  addText(slide, value, { left: x, top: y, width, height: 62 }, {
    fontSize: 44,
    bold: true,
    color,
    typeface: MONO,
    verticalAlignment: "bottom",
  });
  addText(slide, label, { left: x, top: y + 65, width, height: 46 }, {
    fontSize: 16,
    color: C.muted,
    lineSpacing: 20,
  });
}

async function build() {
  await fs.mkdir(QA_DIR, { recursive: true });
  await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
  for (const filename of ["wuno-orb.png", "process-replay.png", "event-analysis.png", "audit-record.png"]) {
    ASSET_BYTES[filename] = await fs.readFile(path.join(ASSET_DIR, filename));
  }

  const deck = Presentation.create({ slideSize: { width: W, height: H } });

  // 01 Cover
  {
    const slide = deck.slides.add();
    slide.background.fill = C.deep;
    addCircle(slide, 810, 52, 390, "#0B1B36", "#18345E");
    addImage(slide, "wuno-orb.png", { left: 825, top: 78, width: 340, height: 304 }, "Wuno 蓝色球形主视觉", {
      fit: "contain",
      borderRadius: 0,
      geometry: "rect",
    });
    addText(slide, "序安", { left: 70, top: 70, width: 180, height: 42 }, {
      fontSize: 26,
      bold: true,
      color: "#FFFFFF",
    });
    addText(slide, "PROCESS SENTINEL", { left: 70, top: 112, width: 280, height: 24 }, {
      fontSize: 12,
      bold: true,
      color: "#8FCFFF",
      typeface: MONO,
    });
    addText(slide, "事故之前，\n过程先偏了一点", { left: 70, top: 198, width: 680, height: 190 }, {
      fontSize: 58,
      bold: true,
      color: "#FFFFFF",
      lineSpacing: 66,
      verticalAlignment: "middle",
    });
    addText(slide, "连续化工过程偏移副驾驶", { left: 70, top: 420, width: 620, height: 46 }, {
      fontSize: 25,
      color: "#C9DAEF",
    });
    addText(slide, "先发现偏移 · 再交付证据 · 最后由人确认", { left: 70, top: 486, width: 650, height: 36 }, {
      fontSize: 18,
      bold: true,
      color: "#58D6D6",
    });
    addText(slide, "黑客松路演 · 2026.08 · REVIEW", { left: 70, top: 642, width: 500, height: 26 }, {
      fontSize: 13,
      color: "#7891B4",
      typeface: MONO,
    });
    addSourceNotes(slide, [
      "内部事实源：README.md；docs/submission/作品说明_v01_DRAFT.md",
      "视觉资产：Wuno 设计系统 / WUWEI_Wuno_蓝色球形主视觉.png",
    ]);
  }

  // 02 Pain point
  {
    const slide = deck.slides.add();
    slide.background.fill = C.canvas;
    addTitle(slide, "现场堵点不是没有报警，而是 52 路变量同时在说不同的话", "单点红灯无法替工程师完成一次跨变量、跨时间、可追溯的判断。", 2, { fontSize: 35 });

    addText(slide, "52", { left: 64, top: 214, width: 235, height: 112 }, {
      fontSize: 90,
      bold: true,
      color: C.primary700,
      typeface: MONO,
    });
    addText(slide, "路过程变量\n41 测量 + 11 操纵", { left: 70, top: 326, width: 245, height: 80 }, {
      fontSize: 19,
      bold: true,
      color: C.text,
      lineSpacing: 24,
    });
    addText(slide, "进料组成、流量、压力、温度和阀位可能同时变化。异常不是一盏灯，而是一段关系正在失稳。", { left: 64, top: 438, width: 310, height: 112 }, {
      fontSize: 18,
      color: C.muted,
      lineSpacing: 26,
    });

    const questions = [
      ["01", "是不是真偏了？", "区分持续偏移与短时噪声"],
      ["02", "先看哪三个变量？", "把 52 路信号压缩成证据"],
      ["03", "下一步先查什么？", "给出可执行的检查顺序"],
      ["04", "谁确认过？", "交班、复盘与审计可追溯"],
    ];
    questions.forEach(([num, title, body], i) => {
      const y = 200 + i * 105;
      addCircle(slide, 445, y + 4, 62, i === 0 ? C.paleWarn : C.paleBlue, i === 0 ? C.warning : C.border);
      addText(slide, num, { left: 445, top: y + 20, width: 62, height: 24 }, {
        fontSize: 16,
        bold: true,
        color: i === 0 ? C.warning : C.primary700,
        typeface: MONO,
        alignment: "center",
      });
      addText(slide, title, { left: 535, top: y, width: 350, height: 34 }, {
        fontSize: 24,
        bold: true,
        color: C.text,
      });
      addText(slide, body, { left: 535, top: y + 42, width: 480, height: 32 }, {
        fontSize: 17,
        color: C.muted,
      });
    });
    addBox(slide, { left: 960, top: 226, width: 238, height: 274 }, { fill: C.deep2, line: { style: "solid", fill: "#173356", width: 1 }, borderRadius: 22 });
    addText(slide, "异常前的十分钟", { left: 986, top: 252, width: 190, height: 34 }, {
      fontSize: 22,
      bold: true,
      color: "#FFFFFF",
    });
    addText(slide, "报警还没替你解释\n变量关系已经变了\n交班记录仍是空白", { left: 986, top: 315, width: 190, height: 132 }, {
      fontSize: 18,
      color: "#C9DAEF",
      lineSpacing: 36,
    });
    addSourceNotes(slide, [
      "TEP 变量构成：docs/submission/数据说明_v01_DRAFT.md",
      "现场研判问题定义：docs/submission/作品说明_v01_DRAFT.md",
    ]);
  }

  // 03 Detection
  {
    const slide = deck.slides.add();
    slide.background.fill = C.canvas;
    addTitle(slide, "在事故形成前，把持续偏移从噪声里拎出来", "序安先回答“过程是否偏离正常基线”，再让工程师展开原始变量。", 3);
    addText(slide, "T² + Q/SPE", { left: 64, top: 210, width: 360, height: 62 }, {
      fontSize: 38,
      bold: true,
      color: C.primary700,
      typeface: MONO,
    });
    addText(slide, "连续越界形成事件", { left: 64, top: 283, width: 350, height: 34 }, {
      fontSize: 24,
      bold: true,
      color: C.text,
    });
    addText(slide, "不是单点越线就报警。事件需要持续性证据；坏数据不会送入 PCA，也不会开启工艺异常事件。", { left: 64, top: 336, width: 360, height: 108 }, {
      fontSize: 18,
      color: C.muted,
      lineSpacing: 26,
    });
    addBox(slide, { left: 64, top: 488, width: 360, height: 108 }, { fill: C.panel, borderRadius: 14 });
    addText(slide, "52 路热力格", { left: 86, top: 510, width: 130, height: 28 }, { fontSize: 19, bold: true, color: C.text });
    addText(slide, "先看异常集中在哪一组，再展开原始值与时间窗。", { left: 86, top: 546, width: 310, height: 44 }, { fontSize: 16, color: C.muted, lineSpacing: 21 });
    addBox(slide, { left: 470, top: 200, width: 744, height: 430 }, { fill: C.panel, line: { style: "solid", fill: C.border, width: 1 }, borderRadius: 20, shadow: "shadow-sm" });
    addImage(slide, "process-replay.png", { left: 486, top: 216, width: 712, height: 398 }, "序安过程回放首屏：52 路变量热力格与回放控制", { fit: "cover", crop: { left: 0, top: 0.01, right: 0, bottom: 0.03 }, borderRadius: 14 });
    addSourceNotes(slide, [
      "检测与热力格：docs/submission/作品说明_v01_DRAFT.md",
      "在线 PCA 不变量：services/ml/README.md",
      "产品截图：90_构建与分析缓存/序安黑客松路演_v01/assets/process-replay.png",
    ]);
  }

  // 04 Evidence
  {
    const slide = deck.slides.add();
    slide.background.fill = C.panel;
    addTitle(slide, "AI 不只给结论，还给候选、Top-3 变量和检查顺序", "每个判断都能回到事件时间、变量贡献和下一步动作。", 4);
    addBox(slide, { left: 64, top: 202, width: 700, height: 422 }, { fill: C.canvas, line: { style: "solid", fill: C.border, width: 1 }, borderRadius: 20 });
    addImage(slide, "event-analysis.png", { left: 78, top: 216, width: 672, height: 394 }, "序安事件研判首屏：候选故障、Top-3 变量证据和检查建议", { fit: "cover", crop: { left: 0, top: 0, right: 0, bottom: 0.03 }, borderRadius: 14 });

    addText(slide, "01", { left: 820, top: 210, width: 54, height: 30 }, { fontSize: 18, bold: true, color: C.primary700, typeface: MONO });
    addText(slide, "候选故障", { left: 884, top: 206, width: 270, height: 38 }, { fontSize: 25, bold: true });
    addText(slide, "排序告诉工程师先验证什么，不代替最终诊断。", { left: 820, top: 250, width: 370, height: 54 }, { fontSize: 17, color: C.muted });

    addText(slide, "02", { left: 820, top: 330, width: 54, height: 30 }, { fontSize: 18, bold: true, color: C.primary700, typeface: MONO });
    addText(slide, "Top-3 变量证据", { left: 884, top: 326, width: 300, height: 38 }, { fontSize: 25, bold: true });
    addText(slide, "SPE 贡献 + 共享横轴，解释偏移集中在哪。", { left: 820, top: 370, width: 370, height: 58 }, { fontSize: 17, color: C.muted });

    addText(slide, "03", { left: 820, top: 452, width: 54, height: 30 }, { fontSize: 18, bold: true, color: C.primary700, typeface: MONO });
    addText(slide, "固定检查顺序", { left: 884, top: 448, width: 280, height: 38 }, { fontSize: 25, bold: true });
    addText(slide, "没有大模型密钥也能运行；大模型只改写表达，不参与阈值或控制决策。", { left: 820, top: 492, width: 370, height: 78 }, { fontSize: 17, color: C.muted });

    addBox(slide, { left: 816, top: 586, width: 360, height: 50 }, { fill: C.paleWarn, line: { style: "solid", fill: "#F6D899", width: 1 }, borderRadius: 12 });
    addText(slide, "20 个样本 / 60 分钟后刷新；已更新 ≠ 已确认", { left: 834, top: 600, width: 330, height: 24 }, { fontSize: 15, bold: true, color: "#8B5D14" });
    addSourceNotes(slide, [
      "两阶段时间轴、20 样本窗口与建议边界：docs/submission/作品说明_v01_DRAFT.md；docs/submission/三分钟Demo脚本_v01_DRAFT.md",
      "产品截图：90_构建与分析缓存/序安黑客松路演_v01/assets/event-analysis.png",
    ]);
  }

  // 05 Human-in-the-loop
  {
    const slide = deck.slides.add();
    slide.background.fill = C.canvas;
    addTitle(slide, "主动交互不是聊天，而是推动一次可追溯的人机确认", "系统围绕事件主动组织证据；工程师保留判断权和接管权。", 5);

    const centerY = 344;
    addLine(slide, 185, centerY + 36, 840, 0, "#A7C6D7", 3);
    [220, 430, 640, 850].forEach((x) => addCircle(slide, x, centerY + 18, 36, C.panel, C.primary500));

    const steps = [
      { x: 86, n: "01", title: "事件出现", body: "锁定时间窗\n标记风险" },
      { x: 296, n: "02", title: "系统提证据", body: "候选故障\nTop-3 变量" },
      { x: 506, n: "03", title: "系统提动作", body: "检查顺序\n安全边界" },
      { x: 716, n: "04", title: "工程师确认", body: "选择结论\n补充备注" },
      { x: 926, n: "05", title: "形成审计", body: "人、证据、\n时间可追溯" },
    ];
    steps.forEach((s, i) => {
      addText(slide, s.n, { left: s.x, top: 236, width: 52, height: 26 }, { fontSize: 16, bold: true, color: i === 3 ? C.success : C.primary700, typeface: MONO });
      addText(slide, s.title, { left: s.x, top: 272, width: 180, height: 34 }, { fontSize: 23, bold: true });
      addText(slide, s.body, { left: s.x, top: 422, width: 175, height: 70 }, { fontSize: 17, color: C.muted, lineSpacing: 24, alignment: "center" });
    });
    addBox(slide, { left: 94, top: 532, width: 1080, height: 84 }, { fill: C.panel, line: { style: "solid", fill: C.border, width: 1 }, borderRadius: 16 });
    addText(slide, "人机分工", { left: 120, top: 552, width: 120, height: 28 }, { fontSize: 20, bold: true, color: C.primary700 });
    addText(slide, "AI 负责持续读取、组织证据和提示下一步；人负责结合工艺、现场与安全边界作最终判断。", { left: 260, top: 551, width: 860, height: 38 }, { fontSize: 20, color: C.text, verticalAlignment: "middle" });
    addSourceNotes(slide, [
      "人机确认与审计链路：README.md；docs/submission/作品说明_v01_DRAFT.md",
      "边界说明：当前产品不具备自由对话式现场控制，也不自动写回控制系统",
    ]);
  }

  // 06 Industry reference and boundary
  {
    const slide = deck.slides.add();
    slide.background.fill = C.deep;
    addTitle(slide, "产业已证明闭环优化有价值；序安补的是安全异常研判层", "贵州磷化集团“1468”官方公开案例是产业参照，不是序安客户或数据来源。", 6, { dark: true, fontSize: 35 });

    addText(slide, "贵州磷化集团“1468”公开案例", { left: 64, top: 204, width: 520, height: 38 }, { fontSize: 23, bold: true, color: "#FFFFFF" });
    addMetric(slide, 64, 250, "≥2%", "相关装置能耗降低", "#60A8FF", 160);
    addMetric(slide, 270, 250, "≥70%", "操作频次下降", "#58D6D6", 160);
    addMetric(slide, 476, 250, "≥30%", "稳定性提升", "#7BD6AF", 160);
    addText(slide, "官方案例：能耗 / 品质 / 设备预测 → APC + RTO 参数优化 → 边缘控制闭环", { left: 64, top: 390, width: 605, height: 58 }, { fontSize: 19, color: "#C9DAEF", lineSpacing: 25 });

    addBox(slide, { left: 720, top: 206, width: 496, height: 365 }, { fill: "#0F2445", line: { style: "solid", fill: "#244A76", width: 1 }, borderRadius: 22 });
    addText(slide, "序安的差异化位置", { left: 752, top: 236, width: 400, height: 38 }, { fontSize: 24, bold: true, color: "#FFFFFF" });
    const seq = ["偏移提前发现", "故障候选 + 变量证据", "人机接管与确认", "审计留痕"];
    seq.forEach((label, i) => {
      const y = 300 + i * 58;
      addCircle(slide, 754, y, 30, i === 2 ? C.success : C.primary500, i === 2 ? C.success : C.primary500);
      addText(slide, String(i + 1), { left: 754, top: y + 7, width: 30, height: 16 }, { fontSize: 12, bold: true, color: "#FFFFFF", typeface: MONO, alignment: "center" });
      addText(slide, label, { left: 804, top: y + 2, width: 340, height: 28 }, { fontSize: 19, bold: true, color: "#E9F3FF" });
    });
    addBox(slide, { left: 64, top: 500, width: 605, height: 115 }, { fill: "#0B1B36", line: { style: "solid", fill: "#27456B", width: 1 }, borderRadius: 16 });
    addText(slide, "当前只读", { left: 88, top: 524, width: 120, height: 30 }, { fontSize: 21, bold: true, color: "#58D6D6" });
    addText(slide, "未来接入 APC / PLC / DCS：人工授权 → 权限校验 → 联锁/安全边界校验 → 受控控制网关；任一失败即保持只读并留痕。", { left: 220, top: 520, width: 420, height: 72 }, { fontSize: 16, color: "#C9DAEF", lineSpacing: 22 });
    addText(slide, "公开产业参照｜不暗示合作｜不使用其真实生产数据", { left: 720, top: 600, width: 496, height: 24 }, { fontSize: 13, bold: true, color: "#8FA7C7", alignment: "right" });
    addSourceNotes(slide, [
      "贵州省大数据发展管理局，2026-01-20：https://dsj.guizhou.gov.cn/ztzl/rdzt/jdal/202601/t20260120_89316875.html",
      "官方案例公开口径：预测、APC、RTO、边缘控制；相关装置能耗降低 2% 以上、操作频次下降 70% 以上、稳定性提升 30% 以上",
      "边界：该案例仅作产业参照；序安与贵州磷化集团无已知合作或真实数据关系",
    ]);
  }

  // 07 Reproducibility
  {
    const slide = deck.slides.add();
    slide.background.fill = C.canvas;
    addTitle(slide, "公开数据、冻结构建、版本化模型，让每次判断可复现", "我们不把仿真结果包装成真实工厂效果，而是把来源、版本和边界一起交付。", 7);

    addBox(slide, { left: 64, top: 204, width: 450, height: 402 }, { fill: C.panel, line: { style: "solid", fill: C.border, width: 1 }, borderRadius: 20 });
    addText(slide, "Tennessee Eastman Process", { left: 92, top: 232, width: 370, height: 40 }, { fontSize: 25, bold: true, color: C.text });
    addText(slide, "公开仿真过程", { left: 92, top: 280, width: 190, height: 26 }, { fontSize: 16, bold: true, color: C.primary700 });
    addMetric(slide, 92, 320, "52", "变量：41 测量 + 11 操纵", C.primary700, 170);
    addMetric(slide, 290, 320, "21", "类公开过程扰动", C.accent500, 170);
    addText(slide, "不能推断", { left: 92, top: 455, width: 110, height: 26 }, { fontSize: 18, bold: true, color: C.error });
    addText(slide, "真实装置提前量、误报/漏报、经济收益或企业 SOP。", { left: 92, top: 492, width: 350, height: 72 }, { fontSize: 17, color: C.muted, lineSpacing: 23 });

    const facts = [
      ["ZIP SHA-256", "fe3a3b0f…24f4"],
      ["buildHash", "c8920c78…c83b"],
      ["modelVersion", "tep-pca-hgb-5bc36d3f4e6b"],
      ["冻结场景", "F01 · F06 · F13"],
      ["部署证据", "5 个健康服务 + E2E + SSE"],
      ["Web 验收基线", "39 passed + lint + production build"],
    ];
    facts.forEach(([label, value], i) => {
      const y = 208 + i * 66;
      addText(slide, label, { left: 570, top: y + 8, width: 180, height: 26 }, { fontSize: 16, bold: true, color: C.muted });
      addText(slide, value, { left: 772, top: y, width: 420, height: 40 }, { fontSize: 20, bold: true, color: i < 3 ? C.primary700 : C.text, typeface: i < 3 ? MONO : FONT, verticalAlignment: "middle" });
      if (i < facts.length - 1) addLine(slide, 570, y + 54, 620, 0, C.border, 1);
    });
    addSourceNotes(slide, [
      "TEP 上游：https://github.com/camaramm/tennessee-eastman-profBraatz",
      "数据 hash、变量、窗口与冻结场景：docs/submission/数据说明_v01_DRAFT.md",
      "测试与部署：README.md；docs/deployment.md；build/qa/playwright_截图与响应式验收.json",
    ]);
  }

  // 08 Demo path
  {
    const slide = deck.slides.add();
    slide.background.fill = C.panel;
    addTitle(slide, "三分钟现场 Demo：从回放走到一条可审计记录", "不切功能清单，只走完一次完整研判。", 8);
    const labels = ["选 F01", "开始回放", "看见偏移", "打开研判", "人工确认", "审计记录"];
    labels.forEach((label, i) => {
      const x = 64 + i * 188;
      if (i < labels.length - 1) addLine(slide, x + 64, 239, 125, 0, C.border, 3);
      addCircle(slide, x + 28, 221, 48, i === 5 ? C.success : C.primary500, i === 5 ? C.success : C.primary500);
      addText(slide, String(i + 1), { left: x + 28, top: 234, width: 48, height: 18 }, { fontSize: 14, bold: true, color: "#FFFFFF", typeface: MONO, alignment: "center" });
      addText(slide, label, { left: x, top: 282, width: 115, height: 34 }, { fontSize: 17, bold: true, color: C.text, alignment: "center" });
    });
    addBox(slide, { left: 64, top: 346, width: 730, height: 270 }, { fill: C.canvas, line: { style: "solid", fill: C.border, width: 1 }, borderRadius: 18 });
    addImage(slide, "audit-record.png", { left: 78, top: 360, width: 702, height: 242 }, "序安事件决策审计记录首屏", { fit: "cover", crop: { left: 0, top: 0, right: 0, bottom: 0.07 }, borderRadius: 12 });
    addText(slide, "现场兜底", { left: 846, top: 350, width: 280, height: 36 }, { fontSize: 25, bold: true });
    addText(slide, "网络不可达", { left: 846, top: 410, width: 150, height: 28 }, { fontSize: 18, bold: true, color: C.primary700 });
    addText(slide, "明确进入演示回退，不伪装成功", { left: 846, top: 442, width: 330, height: 44 }, { fontSize: 16, color: C.muted });
    addText(slide, "LLM 不可用", { left: 846, top: 500, width: 150, height: 28 }, { fontSize: 18, bold: true, color: C.primary700 });
    addText(slide, "确定性建议模板仍可跑完整链路", { left: 846, top: 532, width: 330, height: 44 }, { fontSize: 16, color: C.muted });
    addText(slide, "Demo：huagong.finlaw.cloud/demo", { left: 846, top: 592, width: 340, height: 24 }, { fontSize: 13, color: C.muted, typeface: MONO });
    addSourceNotes(slide, [
      "三分钟路径与兜底：docs/submission/三分钟Demo脚本_v01_DRAFT.md",
      "部署入口与 E2E：README.md；docs/deployment.md",
      "产品截图：90_构建与分析缓存/序安黑客松路演_v01/assets/audit-record.png",
    ]);
  }

  // 09 PoC
  {
    const slide = deck.slides.add();
    slide.background.fill = C.canvas;
    addTitle(slide, "落地从一套装置的 4–8 周只读影子模式开始", "先证明判断质量，再讨论任何控制写回。", 9);
    addText(slide, "4–8 周", { left: 64, top: 220, width: 280, height: 80 }, { fontSize: 56, bold: true, color: C.primary700, typeface: MONO });
    addText(slide, "只读影子模式", { left: 64, top: 306, width: 280, height: 38 }, { fontSize: 24, bold: true });
    addText(slide, "一套装置 · 一条历史数据链路 · 一个班组", { left: 64, top: 360, width: 300, height: 82 }, { fontSize: 19, color: C.muted, lineSpacing: 26 });
    addBox(slide, { left: 64, top: 482, width: 300, height: 108 }, { fill: C.paleWarn, line: { style: "solid", fill: "#F6D899", width: 1 }, borderRadius: 15 });
    addText(slide, "PoC 期间不做自动写回", { left: 86, top: 505, width: 255, height: 28 }, { fontSize: 18, bold: true, color: "#8B5D14" });
    addText(slide, "只评估提前量、误报、漏报和处置时间。", { left: 86, top: 544, width: 255, height: 38 }, { fontSize: 16, color: "#8B5D14" });

    const phases = [
      ["01", "数据对齐", "变量字典\n采样时间\n数据质量"],
      ["02", "建立基线", "历史正常工况\n工况分层\n阈值版本"],
      ["03", "专家校验", "故障标签\n检查顺序\n安全边界"],
      ["04", "影子运行", "持续监测\n人工确认\n审计留痕"],
      ["05", "验收决策", "指标复盘\n边界评审\n下一阶段"],
    ];
    phases.forEach(([num, title, body], i) => {
      const x = 422 + i * 158;
      if (i < phases.length - 1) addLine(slide, x + 114, 354, 60, 0, C.border, 3);
      addText(slide, num, { left: x, top: 224, width: 60, height: 28 }, { fontSize: 16, bold: true, color: C.primary700, typeface: MONO });
      addText(slide, title, { left: x, top: 266, width: 135, height: 34 }, { fontSize: 22, bold: true });
      addCircle(slide, x + 41, 328, 52, i === 4 ? C.success : C.panel, i === 4 ? C.success : C.primary500);
      addText(slide, body, { left: x, top: 410, width: 135, height: 108 }, { fontSize: 16, color: C.muted, lineSpacing: 24, alignment: "center" });
    });
    addText(slide, "交付基座：数据 manifest · 模型版本 · API 契约 · 前后端 · 容器部署 · 备份与回滚", { left: 422, top: 566, width: 770, height: 32 }, { fontSize: 17, bold: true, color: C.text, alignment: "center" });
    addSourceNotes(slide, [
      "PoC 路径：docs/submission/作品说明_v01_DRAFT.md；README.md",
      "部署、备份与回滚：docs/deployment.md",
      "影子模式期间的真实指标必须由现场数据重新定义，不能由 TEP Demo 外推",
    ]);
  }

  // 10 Close
  {
    const slide = deck.slides.add();
    slide.background.fill = C.deep;
    addImage(slide, "wuno-orb.png", { left: 914, top: 72, width: 245, height: 218 }, "Wuno 蓝色球形主视觉", { fit: "contain", geometry: "rect", borderRadius: 0 });
    addText(slide, "下一步", { left: 72, top: 80, width: 200, height: 32 }, { fontSize: 18, bold: true, color: "#58D6D6" });
    addText(slide, "用一个班组，\n把判断时间变成\n可验证的工程指标", { left: 72, top: 158, width: 730, height: 248 }, { fontSize: 52, bold: true, color: "#FFFFFF", lineSpacing: 59 });
    addText(slide, "选择一套装置 · 接一条历史数据链路 · 定义一组 PoC 验收口径", { left: 72, top: 456, width: 820, height: 42 }, { fontSize: 21, color: "#C9DAEF" });
    addBox(slide, { left: 72, top: 548, width: 758, height: 72 }, { fill: "#0F2445", line: { style: "solid", fill: "#244A76", width: 1 }, borderRadius: 16 });
    addText(slide, "序安的承诺：先把证据和责任链做扎实，再谈自动控制。", { left: 98, top: 566, width: 710, height: 36 }, { fontSize: 22, bold: true, color: "#FFFFFF", verticalAlignment: "middle" });
    addText(slide, "Process Sentinel · 序安·过程哨兵", { left: 902, top: 600, width: 286, height: 28 }, { fontSize: 14, bold: true, color: "#8FCFFF", alignment: "right" });
    addText(slide, "REVIEW · 2026.08", { left: 902, top: 638, width: 286, height: 22 }, { fontSize: 11, color: "#6E87AC", typeface: MONO, alignment: "right" });
    addSourceNotes(slide, [
      "行动建议基于内部 PoC 路径：docs/submission/作品说明_v01_DRAFT.md",
      "视觉资产：Wuno 设计系统 / WUWEI_Wuno_蓝色球形主视觉.png",
    ]);
  }

  for (const [index, slide] of deck.slides.items.entries()) {
    const stem = `artifact-slide-${String(index + 1).padStart(2, "0")}`;
    const png = await deck.export({ slide, format: "png", scale: 1 });
    await fs.writeFile(path.join(QA_DIR, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(QA_DIR, `${stem}.layout.json`), await layout.text());
  }

  const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
  await fs.writeFile(path.join(QA_DIR, "artifact-montage.webp"), new Uint8Array(await montage.arrayBuffer()));

  const pptx = await PresentationFile.exportPptx(deck);
  await pptx.save(FINAL_PPTX);
  console.log(FINAL_PPTX);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
