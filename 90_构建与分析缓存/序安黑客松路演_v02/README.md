# 序安黑客松路演 v02 构建与 QA

本目录保留 v02 路演文件的可复现编辑脚本、模板映射、渲染图和结构化验收证据。

- `edit_deck.mjs`：在既有模板上更新封面与封底标志，并写入逐页演讲备注。
- `deviation-log.txt`：记录与源模板的可见差异。
- `qa/final-render/`：10 页全量渲染。
- `qa/final-layout/` 与 `qa/final-inspect.ndjson`：版面与结构化检查结果。
- `qa/final-montage.webp`：逐页视觉总览。

`node_modules` 与 `runtime-bin` 只是本机运行时链接，不属于业务交付，不进入 Git。
