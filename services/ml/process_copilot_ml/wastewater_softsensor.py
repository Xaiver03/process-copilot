from __future__ import annotations

import csv
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline

TARGET = "DQO-S"
CLASS_COLUMN = "class"
ONLINE_FEATURE_COLUMNS = (
    "Q-E",
    "PH-E",
    "COND-E",
    "PH-P",
    "COND-P",
    "PH-D",
    "COND-D",
)


@dataclass(frozen=True)
class SplitData:
    train_features: np.ndarray
    train_target: np.ndarray
    test_features: np.ndarray
    test_target: np.ndarray
    feature_columns: tuple[str, ...]
    target_column: str = TARGET


@dataclass(frozen=True)
class SoftSensorResult:
    status: Literal["ok", "unknown"]
    prediction: float | None
    historical_high_boundary: float | None
    holdout_mae: float | None
    uncertainty_interval: tuple[float, float] | None
    risk_level: Literal["unknown", "normal", "elevated", "high"]
    reason: str | None = None


def load_wastewater_csv(path: Path) -> tuple[tuple[str, ...], np.ndarray]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        raw_headers = tuple(column.strip() for column in next(reader))
        has_class_column = raw_headers and raw_headers[0].lower() == CLASS_COLUMN
        headers = raw_headers[1:] if has_class_column else raw_headers
        if TARGET not in headers:
            raise ValueError(f"CSV must contain target column {TARGET!r}")
        rows: list[list[float]] = []
        for record in reader:
            if not record or not any(cell.strip() for cell in record):
                continue
            numeric = record[1:] if has_class_column else record
            if len(numeric) != len(headers):
                raise ValueError("CSV row does not match header width")
            rows.append([float(value) if value.strip() else np.nan for value in numeric])
    return headers, np.asarray(rows, dtype=float)


def prepare_next_cycle_data(
    headers: Sequence[str],
    values: np.ndarray,
    *,
    feature_columns: Sequence[str] = ONLINE_FEATURE_COLUMNS,
    test_fraction: float = 0.2,
) -> SplitData:
    if not 0 < test_fraction < 1:
        raise ValueError("test_fraction must be between 0 and 1")
    if values.ndim != 2 or values.shape[1] != len(headers):
        raise ValueError("values must match CSV headers")
    header_index = {name: index for index, name in enumerate(headers)}
    missing = [name for name in (*feature_columns, TARGET) if name not in header_index]
    if missing:
        raise ValueError(f"missing required columns: {', '.join(missing)}")
    selected_features = tuple(feature_columns)
    if TARGET in selected_features:
        raise ValueError("future target must not be used as an input feature")
    features = values[:, [header_index[name] for name in selected_features]]
    target_index = header_index[TARGET]
    target = values[:, target_index]
    x, y = features[:-1], target[1:]
    usable = np.isfinite(y)
    x, y = x[usable], y[usable]
    cut = int(len(y) * (1 - test_fraction))
    if cut < 2 or len(y) - cut < 1:
        raise ValueError("not enough rows for chronological train/test split")
    return SplitData(x[:cut], y[:cut], x[cut:], y[cut:], selected_features)


class WastewaterSoftSensor:
    def __init__(self, *, random_state: int = 42, high_quantile: float = 0.95) -> None:
        if not 0 < high_quantile < 1:
            raise ValueError("high_quantile must be between 0 and 1")
        self.random_state = random_state
        self.high_quantile = high_quantile
        self._model = None
        self._features: tuple[str, ...] = ()
        self._boundary = self._mae = None
        self._residual_interval: tuple[float, float] | None = None

    def fit(self, split: SplitData) -> WastewaterSoftSensor:
        if not np.isfinite(split.train_target).all():
            raise ValueError("training target must contain finite values")
        self._features = split.feature_columns
        self._model = make_pipeline(
            SimpleImputer(strategy="median"),
            RandomForestRegressor(
                n_estimators=100, max_features=1.0, random_state=self.random_state, n_jobs=1
            ),
        )
        self._model.fit(split.train_features, split.train_target)
        predictions = self._model.predict(split.test_features)
        residuals = split.test_target - predictions
        self._mae = float(np.mean(np.abs(residuals)))
        spread = float(np.quantile(np.abs(residuals), 0.9))
        center = float(np.median(residuals))
        self._residual_interval = (center - spread, center + spread)
        self._boundary = float(np.quantile(split.train_target, self.high_quantile))
        return self

    def predict(self, values: Mapping[str, object] | Sequence[object]) -> SoftSensorResult:
        if self._model is None or self._boundary is None or self._residual_interval is None:
            raise RuntimeError("fit must be called before predict")
        try:
            if isinstance(values, Mapping):
                row = [values.get(name, np.nan) for name in self._features]
            else:
                if len(values) != len(self._features):
                    return self._unknown("feature count")
                row = list(values)
            sample = np.asarray(row, dtype=float)
        except (TypeError, ValueError):
            return self._unknown("unparseable input")
        if not np.isfinite(sample).all():
            return self._unknown("missing or non-finite process variables")
        prediction = float(self._model.predict(sample.reshape(1, -1))[0])
        low = prediction + self._residual_interval[0]
        high = prediction + self._residual_interval[1]
        risk = (
            "high"
            if low > self._boundary
            else "elevated"
            if high > self._boundary
            else "normal"
        )
        return SoftSensorResult("ok", prediction, self._boundary, self._mae, (low, high), risk)

    @staticmethod
    def _unknown(reason: str) -> SoftSensorResult:
        return SoftSensorResult("unknown", None, None, None, None, "unknown", reason)
