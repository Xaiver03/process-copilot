# 序安·磷煤化工异常早期预警平台黑客松路演 v14

本目录是 v14 REVIEW 的可重建源与视觉 QA 证据。该版本从空白画布重建，不复用 v13 页面骨架。

## 重建

```bash
NODE_PATH=/Users/rocalight/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
/Users/rocalight/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
authoring/build_v14.cjs
```

生成：

- `../../04_交付成品/序安_磷煤化工异常早期预警平台_黑客松路演_v14_ZH_REVIEW.pptx`
- `../../docs/submission/序安_磷煤化工异常早期预警平台_黑客松路演逐字稿_v14_REVIEW.md`

## 资产

- Logo 唯一事实源：`apps/web/public/brand/xuanan-anomaly-intercept-v04.svg`（v04“异常边界截获”矢量标志）。PPT 生成器直接引用该正式资产，不再使用独立复制件。
- `assets/园区封面主视觉.png`：AI 生成的无文字磷煤化工园区主视觉。
- `assets/过滤异常主视觉.png`：AI 生成的无文字过滤/管线异常叙事主视觉。
- `assets/screenshots/公网在线回放_1440.png`：2026-08-29 Playwright 公网实拍。
- `assets/screenshots/公网事件列表_1440.png`：2026-08-29 Playwright 公网实拍，作为备用证据。
- `assets/screenshots/公网DeepSeek_AI研判与证据解释_首屏.png`：2026-08-30 Playwright 公网实拍，用于第 5 页真实 `llm_enhanced / deepseek-v4-flash` AI 研判链路。
- `assets/screenshots/公网AI配置只读边界_全页.png` 与 `assets/screenshots/公网AI运行状态_全页.png`：2026-08-30 公网 AI 配置、运行状态与只读边界备用证据。

## QA

- `qa/content-gate-final/render/`：12 页 144 dpi 最终渲染。
- `qa/content-gate-final/contact-sheet.png`：12 页最终逐页总览。
- `qa/content-gate-final/extracted.txt`：8 项强制内容的 PDF 文本检索事实源。
- `qa/content-gate-final/pdf/`：12 页审核 PDF。
- `qa/public-11of11-final/`：公网完整用户旅程 11/11 通过后的第 6 页证据渲染与同版 PDF；该结果证明 Demo 可复现，不代表生产验证。
- `qa/slides-test.txt`：画布溢出检查。
- `qa/notes-transcript-check.txt`：演讲者备注与逐字稿逐页一致性。
- `qa/pdffonts.txt`：字体嵌入记录。
- `qa/pdfinfo.txt`：页数与页面尺寸。
- `qa/sha256.txt`：PPTX、PDF 哈希。

本版第 5 页已使用 2026-08-30 Playwright 公网真实截图，实测口径为 `llm_enhanced / deepseek-v4-flash`。该证据只说明公网 Demo 的语言模型解释链路已打通，不代表生产系统验证、自动控制能力或与贵州企业存在合作。
