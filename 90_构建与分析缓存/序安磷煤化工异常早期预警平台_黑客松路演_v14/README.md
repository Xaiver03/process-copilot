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

- `assets/序安标志_v04.svg`：v04“异常边界截获”矢量标志。
- `assets/园区封面主视觉.png`：AI 生成的无文字磷煤化工园区主视觉。
- `assets/过滤异常主视觉.png`：AI 生成的无文字过滤/管线异常叙事主视觉。
- `assets/screenshots/公网在线回放_1440.png`：2026-08-29 Playwright 公网实拍。
- `assets/screenshots/公网事件列表_1440.png`：2026-08-29 Playwright 公网实拍，作为备用证据。

## QA

- `qa/final-render/`：10 页 144 dpi 最终渲染。
- `qa/final-contact-sheet.png`：最终逐页总览。
- `qa/slides-test.txt`：画布溢出检查。
- `qa/notes-transcript-check.txt`：演讲者备注与逐字稿逐页一致性。
- `qa/pdffonts.txt`：字体嵌入记录。
- `qa/pdfinfo.txt`：页数与页面尺寸。
- `qa/sha256.txt`：PPTX、PDF 哈希。

真实 `llm_enhanced` 截图不在本版本中伪造；当前使用在线回放真实截图完成产品旅程展示。
