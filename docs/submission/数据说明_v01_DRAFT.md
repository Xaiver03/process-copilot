# 数据说明：Tennessee Eastman Process

状态：`DRAFT`

## 来源

- 上游仓库：[camaramm/tennessee-eastman-profBraatz](https://github.com/camaramm/tennessee-eastman-profBraatz)
- 本地原始包：`../02_AI与贵州特色产业数据研究/04_原始数据与资料/先进制造_开源基准数据_2026-08-28/raw/Tennessee_Eastman_Process_Braatz.zip`
- SHA-256：`fe3a3b0f096c9bd3f90fd33bfea0d54e0626d1e4dda7df0eb9daea7e103a24f4`
- 版权与许可：保留上游 University of Illinois 版权、许可条件和免责声明；对外发布时一并保留来源与引用。

上游仓库说明这批文件用于评价 PCA、PLS、FDA、CVA 等数据驱动方法，并给出 21 类过程扰动。训练文件通常为 `480 × 52`，测试文件为 `960 × 52`；52 列由 `XMEAS(1..41)` 与 `XMV(1..11)` 组成。

## 本项目的处理规则

- `d00.dat` 的原始布局为 `52 × 500`，导入时转置为 `500 × 52`；这是必须单测的格式特例。
- 记录间隔为 180 秒。
- 测试集故障从样本 160 附近开始；实现以 `faultOnsetSample=160` 固化并测试边界，避免 off-by-one。
- 窗口长度 20 点，即 60 分钟；步长为 1。
- 窗口绝不跨 run；不做破坏时间结构的随机切分。
- 正常工况用于 PCA 基线；演示分类器只覆盖正常和选定故障场景，不宣称具备 21 类生产级诊断能力。

## 数据产物

```text
data/processed/
├── bronze/{train,test}/fault_*.parquet
├── models/
│   ├── pca_detector.joblib
│   ├── fault_classifier.joblib
│   └── model_manifest.json
├── scenarios/
│   ├── tep-f01-feed-ratio-step/
│   ├── tep-f06-a-feed-loss/
│   └── tep-f13-kinetics-drift/
└── variable_dictionary.json
```

`data/manifests/build_manifest.json` 记录每个产物的相对路径、字节数和 SHA-256；`buildHash` 用于判断一套数据、模型与场景是否来自同一次确定性构建。

当前冻结产物：

- `buildHash`：`c8920c786aea6d7171d27629e0be703a6222b383ba3672a930cb2328ede6c83b`
- `modelVersion`：`tep-pca-hgb-5bc36d3f4e6b`
- manifest 共登记 57 个产物；相对路径、字节数和 SHA-256 已逐项复核。
- 正式回放 telemetry 不包含 `activeFaultId` 等真实答案字段。

三个冻结场景都采用同一条预注册时间规则：异常检测只依赖 T²/SPE，不读取测试集真实故障标签；事件在首次持续越界点锁定，候选故障和变量证据在固定 20 个样本（60 分钟）后刷新。F01、F06 的检测/研判样本为 `160/180`，F13 为 `167/187`。首次候选可能仍为“正常 / 分类尚未收敛”；后续 `updated` 只表示证据已刷新，不表示故障已经由人确认。

## 不能从这批数据推断的事情

- 不能代表贵州某家企业真实装置的压力、温度、原料和控制逻辑。
- 不能直接给出生产环境的误报率、漏报率、提前量或经济收益。
- 不能把仿真故障标签直接映射为企业 SOP。
- 不能依据本 Demo 自动操作阀门、联锁或控制回路。

真实 PoC 必须重新对齐变量字典、采样频率、工况分段、装置基线和安全审查。
