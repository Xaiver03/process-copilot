# 序安 Process Sentinel 黑客松易拉宝印前与色差验收 v02

状态：`REVIEW`  
成品尺寸：`800 mm × 1800 mm`  
目标：在没有指定印厂设备配置的前提下，先交付可追踪的 CMYK 评审文件；正式生产时再切换为印厂“设备 + 墨水 + 实际介质”的专用 ICC。

## 当前文件采用的印前策略

- 矢量文字、线条、图标、流程和二维码全部使用工艺 CMYK；没有 RGB 填充或 RGB 描边操作。
- 二维码和小字使用单黑，避免四色套印造成边缘发虚。
- 主视觉为 4 通道、8 bit、嵌入 ICC 的 CMYK JPEG；放入版面后的有效输出分辨率约 119 ppi。
- 主视觉峰值总墨量实测约 296.9%，低于 300% 控制线。
- PDF 嵌入 `PSO Coated v3 / FOGRA51` 输出意图，作为 300% 总网点面积的 REVIEW 兜底条件。
- `FOGRA51` 针对高级铜版纸，不是易拉宝写真介质的专用条件，所以本文件不能替代印厂介质打样。

## 色差验收阈值

合同打样最低控制线采用 ISO 12647-7:2016 / Fogra MediaWedge 口径：

| 检查项 | ΔE00 门槛 |
|---|---:|
| 纸白 | ≤ 3.0 |
| 全部色块平均 | ≤ 2.5 |
| 全部色块最大 | ≤ 5.0 |
| CMYK 实地色最大 | ≤ 3.0 |

序安品牌色采用更严的内部验收：

- 关键青色和琥珀色目标 `ΔE00 ≤ 2.0`。
- 任一关键色 `ΔE00 > 3.0`，退回重新校色和打样。
- 同一张 800 × 1800 mm 成品做九点测量，位置间最大 `ΔE00 ≤ 3.0`。
- 测量条件统一为 `D50 / 2° / M1`；目标值、样张和成品必须使用同一仪器、同一背衬和同一测量模式。

## 交给印厂时必须确认

1. 输出设备型号、RIP、墨水体系和易拉宝实际介质名称。
2. 由印厂提供对应 ICC；若只能提供“通用 CMYK”，要求先做带 MediaWedge 和序安关键色块的签样。
3. 印厂不得把文件按未指定的 RGB 工作空间重新解释。
4. 先打一张 1:1 关键色条或小样，再决定是否整幅生产。
5. 成品按九点均匀性、关键色 ΔE00、套印清晰度、渐变断阶和二维码识别逐项验收。

## 当前技术预检

- 页面：1 页；PDF 点值换算为 `800.001 × 1799.999 mm`，属于 800 × 1800 mm 的舍入误差。
- 页面颜色空间资源：无 DeviceRGB。
- 内容流：RGB 填充 `0`、RGB 描边 `0`；CMYK 填充 `286`、CMYK 描边 `278`。
- 主视觉：ICCBased、4 通道、2508 × 5643 px、约 119 ppi。
- OutputIntent：`PSO Coated v3 / FOGRA51`，ICC 嵌入成功，`N=4`。
- 字体：PingFang HK Regular / Semibold 全部子集嵌入。
- 日志：无缺字、无 Overfull、无 Underfull。
- 公网 Demo：2026-08-28 再验证 HTTP 200。

## 官方依据

- ECI 官方 ICC 下载与 PSO Coated v3：<https://eci.org/doku.php_id=en_downloads.html>
- Fogra ProcessStandard Digital，大幅面数字印刷与 PDF/X CMYK 工作流：<https://fogra.org/en/downloads/work-tools/processstandard-digital-psd>
- bvdm MediaStandard Print，ISO 12647-7:2016 合同打样 ΔE00 阈值：<https://www.bvdm-online.de/fileadmin/user_upload/Bundesverband/Technik-Produktion/Richtlinien-Handreichungen/MediaStandard_Print_2018.pdf>
- ICC 关于打印设备配置文件的建议：<https://www.color.org/findprofile/>
- Idealliance 大幅面系统九点均匀性指标：<https://idealliance.org/systems-certification/wide-grand-format-inkjet-system/>
