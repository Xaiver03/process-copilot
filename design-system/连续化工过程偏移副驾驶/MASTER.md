# 连续化工过程偏移副驾驶设计系统

状态：`DRAFT`  
上游事实源：`WunoOS-WUWUI-Design-System` 与本地 `wuno-design-tokens.json/css`

自动检索原始候选保存在 [`AUTO_GENERATED_CANDIDATE.md`](AUTO_GENERATED_CANDIDATE.md)。其中 Insurance Platform 分类、独立青绿色板和 Fira 字体不适用于本产品，不得进入实现。

## Design Read

工业中控室当班工程师使用的高密度、可信、只读决策工作台。视觉服务于证据、人工确认与审计，不做炫技型 AI 看板。

- `DESIGN_VARIANCE: 3`
- `MOTION_INTENSITY: 2`
- `VISUAL_DENSITY: 8`

Taste skill 仅用于消除模板化视觉、统一形状和文案；数据表、趋势图、信息架构和全状态设计遵循工业产品可用性。

## 继承关系

```text
Wuno Core Tokens
  -> WUWUI App Shell / Shared Components
    -> Process Product Semantic Tokens
      -> Page and State Overrides
```

不得复制核心 token 后改名。产品层只增加语义别名和图表专用 token。

## 核心 token

| 语义 | 值 |
|---|---|
| Surface Canvas | `#F7FBFE` |
| Surface Panel | `#FFFFFF` |
| Surface Elevated | `#FDFEFF` |
| Primary 700 | `#24839B` |
| Primary 500 | `#3996AE` |
| Accent 500 | `#13C2C2` |
| Text Primary | `#102A3A` |
| Text Secondary | `#627987` |
| Border Subtle | `#DCEAF5` |
| Status Success | `#27AE84` |
| Status Warning | `#F2A93B` |
| Status Error | `#DE5B6D` |

## 产品语义 token

产品 token 必须映射到核心色，不增加第二套品牌调色板：

- `process.normal -> status.success`
- `process.drift -> status.warning`
- `process.alarm -> status.error`
- `data.live -> status.success`
- `data.delayed -> status.warning`
- `data.offline -> status.error`
- `evidence.selected -> primary.700`
- `evidence.baseline -> text.secondary`
- `control.readOnly -> primary.500`
- `control.humanConfirmed -> status.success`
- `chart.grid -> border.subtle`
- `chart.eventWindow -> status.warning` 的低透明背景

任何状态都必须同时包含文字、图标、形状或线型，禁止只靠红绿区分。

## 字体与数字

- 中文：PingFang SC、Noto Sans CJK SC、Arial、sans-serif。
- 品牌字样可沿用 Figma 中的 Inter Bold。
- 变量 ID、数值、时间戳局部使用系统等宽字体。
- 所有实时数值使用 tabular figures，避免更新时水平跳动。
- 正文字号不低于 14px，辅助数据不低于 12px。

## 几何与布局

- 基准画板：1440 × 900。
- 应用侧栏：240px，复用 WUWUI `AppSidebar`，只切换 active 状态。
- 工作区：1200px，24px 外边距，12 栏网格。
- 常规面板：12px 圆角；大型研判面板：16px；输入与小控件：8px。
- 卡片仅用于真实层级；密集数据优先使用留白、分组背景和单向分隔线。
- 数字区保持紧凑，触控与点击目标不小于 44 × 44px。

## 核心组件

`AppShell`、`ContextBar`、`DataFreshness`、`ReplayControl`、`ReplayScrubber`、`ProcessHeatmap`、`AlignedTrendTracks`、`EventMarker`、`RiskBanner`、`FaultCandidateList`、`VariableContribution`、`RecommendationPanel`、`HumanDecision`、`AuditTimeline`。

所有业务组件必须覆盖：正常、偏移、严重告警、加载、错误、空态、不可用与只读状态。

## 图表

优先使用：

- 变量组热力图，用于 52 路变量的总览。
- 共享横轴小多图，用于 Top-3 证据对齐比较。
- 横向贡献条，用于变量贡献排序。
- 事件时间轴，用于发现、研判、确认与升级留痕。

禁用仪表盘、3D 图、装饰性环图，以及把 52 条曲线叠在同一坐标系。图表必须提供文本摘要和可访问的数据表替代。

## 动效与状态

- 动效只表达回放推进、异常出现、内容切换和人工确认。
- 微交互 150-300ms；退出快于进入。
- 不使用滚动劫持、装饰性无限循环和外发光。
- 必须支持 `prefers-reduced-motion`。
- 数据错误时保留最后有效值，并显示错误范围、最后更新时间和重试入口。

## 响应式

- 1440：240px 侧栏，研判 8+4 栏。
- 1024：收窄/折叠侧栏，内容按 6+6 或纵向重排。
- 768 以下：侧栏改抽屉，研判纵向排列，人工确认栏吸底。
- 375：只保留当前事件、Top-3 证据和确认动作，不展示 52 变量总览。

## Figma 文件结构

审批后新建 `WunoOS - 连续化工过程偏移副驾驶`：

1. `00_Cover与说明`
2. `01_Core Library引用`
3. `02_Product Tokens`
4. `03_Industrial Components`
5. `04_Patterns与全状态`
6. `05_Screens Desktop`
7. `06_Screens Responsive`
8. `07_Prototype Demo主链路`
9. `90_Archive`

AppSidebar 必须保留为 WUWUI Library Instance，不得 detach。

