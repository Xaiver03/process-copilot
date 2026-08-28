import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const ROOT = "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/FDE任务/03_产品与解决方案/03_连续化工过程偏移副驾驶";
const WORKSPACE = path.join(ROOT, "90_构建与分析缓存/序安黑客松路演_v02");
const STARTER = path.join(WORKSPACE, "template-starter.pptx");
const LOGO = path.join(WORKSPACE, "assets/process-sentinel-mark-white-disc-v01.png");
const FINAL_PPTX = path.join(ROOT, "04_交付成品/序安_Process_Sentinel_黑客松路演_v02_ZH_REVIEW.pptx");
const QA_DIR = path.join(WORKSPACE, "qa");
const RENDER_DIR = path.join(QA_DIR, "final-render");
const LAYOUT_DIR = path.join(QA_DIR, "final-layout");

const talkTracks = [
  "大家好，这是“序安·过程哨兵”。它关注的是连续化工现场一个很具体的问题：事故真正形成之前，温度、压力、流量和阀门之间的关系，往往已经开始慢慢偏离。序安要做的，就是把这种偏移更早地指出来，给出证据和检查建议，最后仍然由工程师确认。",
  "现场并不是没有报警。真正难的是，几十路变量可能同时变化，而且每一路单独看都不一定严重。工程师需要回答四个问题：这是真异常还是噪声？先看哪几个变量？下一步先查什么？最后谁做了确认？序安的价值，就是把这些分散的问题整理成一条可追溯的判断链。",
  "第一步不是让大模型直接猜故障，而是先判断过程有没有持续离开正常状态。这里的 T 平方和 SPE，可以简单理解为两把尺子：一把看整体状态偏了多远，一把看变量之间原来的关系有没有被打破。只有偏移持续存在，系统才形成事件；短时波动不会被直接包装成故障。",
  "发现事件以后，序安不会只说一句“有异常”。它会给出故障候选、最值得先看的三条变量证据，以及固定的检查顺序。工程师可以回到事件发生的时间点，看哪些变量共同变化，再决定先核对原料、仪表还是上游操作。AI 在这里负责缩小范围，不负责替工程师做最终诊断。",
  "序安的主动交互，不是让操作员和一个机器人随便聊天，而是在事件发生后主动组织证据、提出下一步，并推动一次人工确认。系统负责持续读取、解释和留痕；工程师负责结合工艺、现场和安全边界作判断。确认结果、补充备注和时间都会进入审计记录，方便交班和复盘。",
  "贵州磷化集团“1468”装置的官方公开案例已经说明，预测、参数优化和边缘闭环在磷化工里有实际价值。官方公开数字包括能耗降低百分之二以上、操作频次下降百分之七十以上、稳定性提升百分之三十以上。但序安不把自己包装成同一种系统。我们的重点是闭环之前的安全异常研判：更早发现偏移，给出故障候选和变量证据，把人工接管和审计做扎实。这个案例只是公开产业参照，不代表双方合作，也不是序安的数据来源。",
  "这次 Demo 使用 Tennessee Eastman Process，也就是 TEP 公开仿真过程。它提供四十一项测量变量和十一项操纵变量，是公开、可复现的研究数据。我们把数据文件、场景、模型版本、接口契约和测试结果一起冻结下来，因此一次判断可以追到具体数据和具体版本。但它不是贵州真实工厂数据，也不能用来推断真实装置的事故改善或经济收益。",
  "现场只走一条完整链路。先选 F01 场景并开始回放；看到偏移后打开研判，查看候选故障和三条变量证据；然后由操作员人工确认，最后打开审计记录。网络不可达时，我们进入本地演示回退；语言模型不可用时，确定性的建议模板仍然可以完成链路。无论哪种情况，都不假装成功。",
  "第一阶段建议从一套装置、一条历史数据链路和一个班组开始，做四到八周只读影子模式。先完成数据对齐和正常基线，再由专家校验故障标签与检查顺序，随后持续运行并记录人工确认。验收先看判断时间、误报、漏报和处置时间，不做自动写回。只有这些指标经过现场验证，才讨论下一阶段。",
  "我们的请求很简单：选择一套装置，接入一条历史数据链路，和一个班组一起定义 PoC 的验收口径。序安承诺先把证据和责任链做扎实，再谈自动控制。今天的 Demo 是只读的；未来即使进入生产，也必须经过人工授权、权限校验、工艺上下限、联锁校验、二次确认和受控网关。让过程异常在事故之前被看见，也让每一次判断都经得起复盘。谢谢。",
];

const sourceBlocks = [
  [
    "内部事实源：README.md；docs/submission/作品说明_v01_DRAFT.md",
    "现行标志：apps/web/public/brand/process-sentinel-mark-v01.png；SHA-256 9379dcb457c4650cc4b3173341d4ef43a297515fd754217260503e2ecc1f8ca3",
  ],
  [
    "TEP 变量构成：docs/submission/数据说明_v01_DRAFT.md",
    "现场研判问题定义：docs/submission/作品说明_v01_DRAFT.md",
  ],
  [
    "检测与热力格：docs/submission/作品说明_v01_DRAFT.md",
    "在线 PCA 不变量：services/ml/README.md",
    "产品截图：90_构建与分析缓存/序安黑客松路演_v01/assets/process-replay.png",
  ],
  [
    "两阶段时间轴、20 样本窗口与建议边界：docs/submission/作品说明_v01_DRAFT.md；docs/submission/三分钟Demo脚本_v01_DRAFT.md",
    "产品截图：90_构建与分析缓存/序安黑客松路演_v01/assets/event-analysis.png",
  ],
  [
    "人机确认与审计链路：README.md；docs/submission/作品说明_v01_DRAFT.md",
    "边界说明：当前产品不具备自由对话式现场控制，也不自动写回控制系统",
  ],
  [
    "贵州省大数据发展管理局，2026-01-20：https://dsj.guizhou.gov.cn/ztzl/rdzt/jdal/202601/t20260120_89316875.html",
    "官方案例公开口径：预测、APC、RTO、边缘控制；相关装置能耗降低 2% 以上、操作频次下降 70% 以上、稳定性提升 30% 以上",
    "边界：该案例仅作产业参照；序安与贵州磷化集团无已知合作或真实数据关系",
  ],
  [
    "TEP 上游：https://github.com/camaramm/tennessee-eastman-profBraatz",
    "数据 hash、变量、窗口与冻结场景：docs/submission/数据说明_v01_DRAFT.md",
    "测试与部署：README.md；docs/deployment.md；build/qa/playwright_截图与响应式验收.json",
  ],
  [
    "三分钟路径与兜底：docs/submission/三分钟Demo脚本_v01_DRAFT.md",
    "部署入口与 E2E：README.md；docs/deployment.md",
    "产品截图：90_构建与分析缓存/序安黑客松路演_v01/assets/audit-record.png",
  ],
  [
    "PoC 路径：docs/submission/作品说明_v01_DRAFT.md；README.md",
    "部署、备份与回滚：docs/deployment.md",
    "影子模式期间的真实指标必须由现场数据重新定义，不能由 TEP Demo 外推",
  ],
  [
    "行动建议基于内部 PoC 路径：docs/submission/作品说明_v01_DRAFT.md",
    "现行标志：apps/web/public/brand/process-sentinel-mark-v01.png；SHA-256 9379dcb457c4650cc4b3173341d4ef43a297515fd754217260503e2ecc1f8ca3",
  ],
];

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

async function readArrayBuffer(filePath) {
  const bytes = await fs.readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function replaceImage(image, bytes, alt) {
  const oldFrame = image.frame;
  const oldCrop = image.crop;
  const oldFit = image.fit;
  const oldGeometry = image.geometry;
  const oldBorderRadius = image.borderRadius;
  const oldRotation = image.rotation;
  const oldFlipHorizontal = image.flipHorizontal;
  const oldFlipVertical = image.flipVertical;
  const oldLockAspectRatio = image.lockAspectRatio;

  image.replace({
    blob: bytes,
    contentType: "image/png",
    alt,
    ...(oldFit ? { fit: oldFit } : {}),
  });
  image.frame = oldFrame;
  image.crop = oldCrop;
  image.geometry = oldGeometry;
  image.borderRadius = oldBorderRadius;
  image.rotation = oldRotation;
  image.flipHorizontal = oldFlipHorizontal;
  image.flipVertical = oldFlipVertical;
  image.lockAspectRatio = oldLockAspectRatio;
}

async function main() {
  await fs.mkdir(RENDER_DIR, { recursive: true });
  await fs.mkdir(LAYOUT_DIR, { recursive: true });
  try {
    await fs.access(FINAL_PPTX);
    throw new Error(`Refusing to overwrite existing REVIEW: ${FINAL_PPTX}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const presentation = await PresentationFile.importPptx(await FileBlob.load(STARTER));
  const before = await presentation.inspect({
    kind: "slide,textbox,shape,image,notes,layout",
    maxChars: 50000,
  });
  await fs.writeFile(path.join(QA_DIR, "before-inspect.ndjson"), `${before.ndjson}\n`, "utf8");

  const coverTitle = presentation.resolve("sh/65g3298r");
  coverTitle.text.replace("事故之前，", "让过程异常");
  coverTitle.text.replace("过程先偏了一点", "在事故之前被看见");

  const logoBytes = await readArrayBuffer(LOGO);
  await replaceImage(presentation.resolve("im/jqxw72dk"), logoBytes, "序安 Process Sentinel 现行眼形过程环标志");
  await replaceImage(presentation.resolve("im/fm9sbalk"), logoBytes, "序安 Process Sentinel 现行眼形过程环标志");

  for (const [index, slide] of presentation.slides.items.entries()) {
    const notes = [
      "[逐字稿]",
      talkTracks[index],
      "",
      "[Sources]",
      ...sourceBlocks[index].map((line) => `- ${line}`),
    ].join("\n");
    slide.speakerNotes.textFrame.setText(notes);
    slide.speakerNotes.setVisible(true);

    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    await writeBlob(path.join(RENDER_DIR, `${stem}.png`), await presentation.export({ slide, format: "png", scale: 2 }));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(LAYOUT_DIR, `${stem}.layout.json`), await layout.text(), "utf8");
  }

  await writeBlob(
    path.join(QA_DIR, "final-montage.webp"),
    await presentation.export({ format: "webp", montage: true, scale: 1 }),
  );

  const after = await presentation.inspect({
    kind: "slide,textbox,shape,image,notes,layout",
    maxChars: 60000,
  });
  await fs.writeFile(path.join(QA_DIR, "final-inspect.ndjson"), `${after.ndjson}\n`, "utf8");

  const output = await PresentationFile.exportPptx(presentation);
  await output.save(FINAL_PPTX);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
