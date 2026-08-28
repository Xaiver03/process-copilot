from __future__ import annotations

import json
import time
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
from numpy.typing import NDArray

from process_copilot_ml.model import (
    DataQualityResult,
    FaultClassifier,
    OnlinePCAMonitor,
    PCAFaultDetector,
)

_WINDOW_SIZE = 20
_RAW_VARIABLE_IDS = tuple(
    [f"XMEAS({index})" for index in range(1, 42)]
    + [f"XMV({index})" for index in range(1, 12)]
)
_MISSING = object()


@dataclass(frozen=True)
class OnlineInferenceResult:
    sample_index: int
    quality: DataQualityResult
    t2: float | None
    spe: float | None
    anomaly_score: float | None
    alarm_state: Literal["normal", "pending", "open", "recovering"]
    transition: Literal["detected", "updated", "closed"] | None
    initial_candidates: tuple[tuple[int, float], ...] | None
    updated_candidates: tuple[tuple[int, float], ...] | None
    evidence: tuple[dict[str, object], ...]
    model_version: str
    latency_ms: float


class OnlineInferenceEngine:
    def __init__(
        self,
        detector: PCAFaultDetector,
        classifier: FaultClassifier,
        variables: list[dict[str, str]],
        model_version: str,
        *,
        enter_threshold: float = 1.0,
        exit_threshold: float = 0.8,
        enter_consecutive: int = 3,
        exit_consecutive: int = 5,
        top_contributor_count: int = 3,
        expected_sample_step: int = 1,
    ) -> None:
        variable_ids = tuple(variable["variableId"] for variable in variables)
        if variable_ids != _RAW_VARIABLE_IDS:
            raise ValueError("variable dictionary must contain the 52 raw XMEAS/XMV variables")
        if detector.scaler.mean_.shape != (len(_RAW_VARIABLE_IDS),):
            raise ValueError("PCA detector must be fitted on 52 raw XMEAS/XMV variables")
        if not model_version:
            raise ValueError("model_version must not be empty")

        self.detector = detector
        self.classifier = classifier
        self.variables = tuple(dict(variable) for variable in variables)
        self.model_version = model_version
        self.monitor = OnlinePCAMonitor(
            detector,
            expected_features=len(_RAW_VARIABLE_IDS),
            enter_threshold=enter_threshold,
            exit_threshold=exit_threshold,
            enter_consecutive=enter_consecutive,
            exit_consecutive=exit_consecutive,
            top_contributor_count=top_contributor_count,
            expected_sample_step=expected_sample_step,
        )
        self._history: deque[NDArray[np.float64]] = deque(maxlen=_WINDOW_SIZE)
        self._samples_after_open = 0
        self._awaiting_update = False

    @classmethod
    def from_artifacts(
        cls,
        model_dir: Path,
        variable_dictionary_path: Path,
    ) -> OnlineInferenceEngine:
        model_dir = Path(model_dir)
        variable_dictionary_path = Path(variable_dictionary_path)
        detector = joblib.load(model_dir / "pca_detector.joblib")
        classifier = joblib.load(model_dir / "fault_classifier.joblib")
        manifest = json.loads((model_dir / "model_manifest.json").read_text(encoding="utf-8"))
        variables = json.loads(variable_dictionary_path.read_text(encoding="utf-8"))
        model_version = manifest.get("modelVersion")
        if not isinstance(model_version, str):
            raise ValueError("model manifest must contain a string modelVersion")
        return cls(detector, classifier, variables, model_version)

    def process(self, *, sample_index: int, values: object) -> OnlineInferenceResult:
        started_ns = time.perf_counter_ns()
        raw_values = self._raw_values(values)
        assessment = self.monitor.process(raw_values, sample_index=sample_index)
        if not assessment.quality.valid:
            self._history.clear()
            self._samples_after_open = 0
            if assessment.alarm.transition == "closed":
                self._awaiting_update = False
            return self._result(
                started_ns,
                assessment.sample_index,
                assessment.quality,
                assessment.t2,
                assessment.spe,
                assessment.anomaly_score,
                assessment.alarm.state,
                None,
                None,
                None,
                (),
            )

        sample = np.asarray(raw_values, dtype=np.float64)
        scores = self.detector.score(sample)
        standardized = self.detector.scaler.transform(sample[None, :])[0]
        self._history.append(standardized)
        evidence = self._evidence(scores.contributions[0], standardized)

        transition: Literal["detected", "updated", "closed"] | None = None
        initial_candidates: tuple[tuple[int, float], ...] | None = None
        updated_candidates: tuple[tuple[int, float], ...] | None = None
        if assessment.alarm.transition == "opened":
            transition = "detected"
            initial_candidates = self._candidates()
            self._samples_after_open = 0
            self._awaiting_update = True
        elif assessment.alarm.transition == "closed":
            transition = "closed"
            self._samples_after_open = 0
            self._awaiting_update = False
        elif self._awaiting_update:
            self._samples_after_open += 1
            if self._samples_after_open >= _WINDOW_SIZE:
                updated_candidates = self._candidates()
                transition = "updated"
                self._awaiting_update = False

        return self._result(
            started_ns,
            assessment.sample_index,
            assessment.quality,
            float(scores.t2[0]),
            float(scores.spe[0]),
            float(scores.anomaly_score[0]),
            assessment.alarm.state,
            transition,
            initial_candidates,
            updated_candidates,
            evidence,
        )

    @staticmethod
    def _raw_values(values: object) -> object:
        if not isinstance(values, Mapping):
            return values
        return [values.get(variable_id, _MISSING) for variable_id in _RAW_VARIABLE_IDS]

    def _candidates(self) -> tuple[tuple[int, float], ...] | None:
        if len(self._history) < _WINDOW_SIZE:
            return None
        windows = np.stack(tuple(self._history))[None, :, :]
        return tuple(self.classifier.predict_top3(windows)[0])

    def _evidence(
        self,
        contributions: NDArray[np.float64],
        standardized: NDArray[np.float64],
    ) -> tuple[dict[str, object], ...]:
        indices = np.argsort(contributions, kind="stable")[-3:][::-1]
        evidence: list[dict[str, object]] = []
        for index in indices:
            variable = self.variables[int(index)]
            z_value = float(standardized[index])
            direction = "mixed" if abs(z_value) < 0.25 else ("up" if z_value > 0 else "down")
            evidence.append(
                {
                    **variable,
                    "contribution": float(contributions[index]),
                    "direction": direction,
                }
            )
        return tuple(evidence)

    def _result(
        self,
        started_ns: int,
        sample_index: int,
        quality: DataQualityResult,
        t2: float | None,
        spe: float | None,
        anomaly_score: float | None,
        alarm_state: Literal["normal", "pending", "open", "recovering"],
        transition: Literal["detected", "updated", "closed"] | None,
        initial_candidates: tuple[tuple[int, float], ...] | None,
        updated_candidates: tuple[tuple[int, float], ...] | None,
        evidence: tuple[dict[str, object], ...],
    ) -> OnlineInferenceResult:
        latency_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        return OnlineInferenceResult(
            sample_index=sample_index,
            quality=quality,
            t2=t2,
            spe=spe,
            anomaly_score=anomaly_score,
            alarm_state=alarm_state,
            transition=transition,
            initial_candidates=initial_candidates,
            updated_candidates=updated_candidates,
            evidence=evidence,
            model_version=self.model_version,
            latency_ms=latency_ms,
        )
