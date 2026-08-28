# ML 判别内核

状态：`REVIEW`

这里同时保留两条明确区分的能力：

1. `build.py` 生成可复现的 TEP 冻结数据、PCA/HGB 模型和 Demo 事件模板。
2. `model.py` 提供逐样本在线 PCA 判别内核，但尚未接入 API worker 或真实 DCS。

## 在线内核

`OnlinePCAMonitor` 对每个按顺序到达的样本执行：

```text
变量数/有限值检查
  -> PCA T²/SPE 与归一化异常分数
  -> SPE Top-N 贡献变量
  -> 持续性进入阈值
  -> 滞回退出阈值
  -> normal / pending / open / recovering 状态与 opened / closed 事件
```

关键不变量：

- 坏数据不会送入 PCA，也不会开启工艺异常事件。
- 坏数据会清除尚未确认的 `pending`，但不会把已经开启的事件误判为恢复。
- 只有连续有效异常样本达到 `enter_consecutive` 才开启事件。
- 只有连续有效样本低于更低的 `exit_threshold` 达到 `exit_consecutive` 才关闭事件。
- 样本索引必须严格递增；重复或倒序数据会被拒绝，超出 `expected_sample_step` 的缺口按坏数据处理并打断尚未确认的持续性计数。
- `event_start_sample` 是首次越过进入阈值的候选起点，`opened_sample` 才是连续计数满足后真正对外开事件的样本；检测延迟必须使用 `opened_sample`。
- 事件评估采用全局一对一最大匹配，标准 precision 只把一对一命中计入分子；同一真实事件上的重复告警单独计入 `duplicate_alarm_events`。
- 过早开始的告警默认不能冒充故障命中；如业务允许预警窗口，必须显式传入 `early_detection_tolerance_samples`。

最小使用方式：

```python
from process_copilot_ml.model import OnlinePCAMonitor, PCAFaultDetector

detector = PCAFaultDetector().fit(normal_training_values)
monitor = OnlinePCAMonitor(
    detector,
    expected_features=normal_training_values.shape[1],
    enter_threshold=1.0,
    exit_threshold=0.8,
    enter_consecutive=3,
    exit_consecutive=5,
)

assessment = monitor.process(values, sample_index=sample_index)
```

`assessment` 同时包含数据质量、T²、SPE、异常分数、贡献变量索引和事件状态。调用方应持久化模型版本、阈值版本、工况和变量字典；当前类本身不做网络 IO、数据库写入或控制系统写回。

## 逐样本在线推理引擎

`OnlineInferenceEngine.from_artifacts(model_dir, variable_dictionary_path)` 加载冻结的 PCA/HGB 模型和变量字典；随后用 `process(sample_index=index, values=values)` 逐样本推理。`values` 可以是 52 维序列，也可以是包含额外字段的 mapping。mapping 只读取严格有序的 `XMEAS(1..41)`、`XMV(1..11)`；`faultOnsetSample`、`activeFaultId`、文件名中的 fault ID、预计算 `t2/spe/anomalyScore/candidate*` 等字段永远不会进入模型。

加载模型前会先校验 `model_manifest.json` 及其 `artifacts` 台账：清单必须是对象，必须覆盖两个必需的 joblib 文件；每个路径必须是位于模型目录内的相对路径，并且文件大小和小写 SHA-256 必须精确匹配。缺失、越界、篡改或格式错误的清单/模型会在 `joblib.load` 前以安全错误拒绝。

每次调用返回 `OnlineInferenceResult`：

- `sample_index`、`t2`、`spe`、`anomaly_score`、`alarm_state`、`latency_ms`
- `quality` 和 `evidence`（SPE Top-3 贡献变量）
- `initial_candidates`：告警真正锁存时，若已有完整 20 样本窗口则给出候选
- `updated_candidates`：锁存后再收到 20 个有效且连续样本时只产生一次候选更新
- `transition`：`detected`、`updated`、`closed` 或 `None`
- `model_version`

`event_start_sample` 是首次越过进入阈值的候选起点；`opened_sample` 是持续性计数满足后真正对外开事件的样本。在线事件延迟应使用 `opened_sample`。坏数据和样本缺口不会送入 PCA、不会计入 20 样本候选窗口，并会打断尚未确认的持续性；倒序或重复样本直接拒绝。

## 冻结 Demo 盲测基线

下面的结果使用仓库内冻结的 `pca_detector.joblib`，按样本顺序回放 3 个 TEP 场景。监测时不读取 `faultOnsetSample`，完成后才用它计算事件级指标。默认参数为进入连续 3 个样本、退出连续 5 个样本、提前容忍 0 个样本；预测事件的起点使用真正开事件的 `opened_sample`。

| 场景 | 预测事件（样本） | precision | recall | 检测延迟 | 每千样本误报 |
|---|---|---:|---:|---:|---:|
| F01 进料组成阶跃 | 51–64；162–959 | 0.50 | 1.00 | +2 | 1.042 |
| F06 A 进料损失 | 150–959 | 0.00 | 0.00 | — | 1.042 |
| F13 反应动力学慢漂移 | 75–80；90–106；158–166；197–959 | 0.25 | 1.00 | +37 | 3.125 |

F06 的真实故障起点是样本 160，但告警在样本 150 已经开启并一直持续。严格口径下，这不是“提前 10 个样本成功预警”，因为当前实验没有证明样本 150 已含故障信号；因此将其计为一次误报、一次漏报。上线前需要按工况分层重标阈值，并在 shadow mode 中由工艺专家确定可接受的提前预警窗口。

## 验证

```bash
uv run --project services/ml --frozen pytest services/ml/tests -q
uv run --project services/ml --frozen ruff check services/ml/process_copilot_ml services/ml/tests
```

## 尚未完成

- API worker 尚未逐样本调用在线内核。
- 尚未实现按生产模式路由的 DPCA/CVA 模型。
- 尚未加入时间新鲜度、冻结值、变化率和冗余测点一致性质量规则。
- 尚未实现已知故障概率校准与 unknown 拒识。
- 当前 TEP 结果不能替代真实装置 shadow mode 验收。
