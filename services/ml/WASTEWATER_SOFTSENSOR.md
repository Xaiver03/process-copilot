# UCI Water Treatment Plant 出水 COD 软测量

本模块使用公开的 UCI Water Treatment Plant 数据格式（ID 106）。仓库冻结副本 `data/raw/wastewater/water-treatment.csv` 含 520 条非空日记录、38 个数值变量和一个第三方镜像附加的 `class` 文本列；存在缺失值。它不是贵州企业数据，也不包含可直接复用的法规限值。

- 参考目录原文件 SHA-256：`1fff0bdd9d2cc42da0aaa4d8b8d710d65b6ace2fd9166acb1e2865100cec8963`。
- 仓库规范化副本 SHA-256：`5e5ff4f87352964a701d040c1db98fed3170f6a111efdb182ed68d410ffc2778`；只移除了行末空格和文件尾空行，数值记录未改写。

## 定义

- 特征：当前行中可对应在线仪表的 7 个上游过程变量：进水流量、进水/初沉/二沉 pH 与电导率。目标列、出水变量和去除率派生字段均不进入特征。
- 目标：下一行（下一检测周期）的 `DQO-S`，通过 `features[t] -> DQO-S[t+1]` 构造。
- 切分：按时间顺序切分，前 80% 训练、后 20% 留出；不随机打乱。
- 模型：固定 `random_state=42` 的 `RandomForestRegressor`，仅用于小规模离线软测量。
- 输出：预测值、训练目标 95% 历史高位边界、留出集 MAE、基于留出残差的区间和相对风险级别。

`high`/`elevated` 是相对训练历史高位边界的运行风险提示，不是法规排放限值。预测时缺失、非有限、字段缺失或维度错误均返回 `unknown`，不会触发高风险。

## 复现

```python
from pathlib import Path
from process_copilot_ml.wastewater_softsensor import (
    WastewaterSoftSensor, load_wastewater_csv, prepare_next_cycle_data,
)

headers, values = load_wastewater_csv(Path("data/raw/wastewater/water-treatment.csv"))
split = prepare_next_cycle_data(headers, values)
sensor = WastewaterSoftSensor().fit(split)
sample = dict(zip(headers, values[-1], strict=True))
result = sensor.predict(sample)
```

当前版本不接 API、PLC/DCS 或控制回写；公开数据按日记录，因此演示只称“下一化验周期”，不换算成现场分钟数。真实部署前仍需用现场 DCS 与化验结果的时间戳配对重新训练，并处理数据新鲜度、漂移及工况外输入。
