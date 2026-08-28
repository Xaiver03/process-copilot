from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from sklearn.decomposition import PCA
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler


@dataclass(frozen=True)
class PCAScores:
    t2: NDArray[np.float64]
    spe: NDArray[np.float64]
    anomaly_score: NDArray[np.float64]
    contributions: NDArray[np.float64]


@dataclass(frozen=True)
class AlarmDecision:
    state: Literal["normal", "pending", "open", "recovering"]
    transition: Literal["opened", "closed"] | None
    event_start_sample: int | None


@dataclass(frozen=True)
class DataQualityResult:
    valid: bool
    reasons: tuple[Literal["feature_count", "non_finite"], ...]


class SampleQualityGate:
    def __init__(self, *, expected_features: int) -> None:
        self.expected_features = expected_features

    def check(self, values: NDArray[np.float64]) -> DataQualityResult:
        sample = np.asarray(values, dtype=np.float64)
        if sample.ndim != 1 or len(sample) != self.expected_features:
            return DataQualityResult(False, ("feature_count",))
        if not np.isfinite(sample).all():
            return DataQualityResult(False, ("non_finite",))
        return DataQualityResult(True, ())


class AlarmStateMachine:
    def __init__(
        self,
        *,
        enter_threshold: float,
        exit_threshold: float,
        enter_consecutive: int,
        exit_consecutive: int,
    ) -> None:
        if enter_threshold <= exit_threshold:
            raise ValueError("enter_threshold must be strictly greater than exit_threshold")
        if enter_consecutive < 1 or exit_consecutive < 1:
            raise ValueError("consecutive counters must be at least 1")
        self.enter_threshold = enter_threshold
        self.exit_threshold = exit_threshold
        self.enter_consecutive = enter_consecutive
        self.exit_consecutive = exit_consecutive
        self.state: Literal["normal", "pending", "open", "recovering"] = "normal"
        self._enter_count = 0
        self._exit_count = 0
        self._event_start_sample: int | None = None

    def invalidate(self) -> AlarmDecision:
        self._exit_count = 0
        if self.state in {"open", "recovering"}:
            self.state = "open"
            return AlarmDecision(self.state, None, self._event_start_sample)

        self.state = "normal"
        self._enter_count = 0
        self._event_start_sample = None
        return AlarmDecision(self.state, None, None)

    def update(self, anomaly_score: float, sample_index: int) -> AlarmDecision:
        if self.state in {"open", "recovering"}:
            if anomaly_score <= self.exit_threshold:
                self._exit_count += 1
                if self._exit_count >= self.exit_consecutive:
                    self.state = "normal"
                    self._enter_count = 0
                    self._exit_count = 0
                    self._event_start_sample = None
                    return AlarmDecision(self.state, "closed", None)
                self.state = "recovering"
                return AlarmDecision(self.state, None, self._event_start_sample)

            self._exit_count = 0
            self.state = "open"
            return AlarmDecision(self.state, None, self._event_start_sample)

        if anomaly_score >= self.enter_threshold:
            if self._enter_count == 0:
                self._event_start_sample = sample_index
            self._enter_count += 1
            if self._enter_count >= self.enter_consecutive:
                self.state = "open"
                return AlarmDecision(self.state, "opened", self._event_start_sample)
            self.state = "pending"
            return AlarmDecision(self.state, None, self._event_start_sample)

        self._enter_count = 0
        self._event_start_sample = None
        self.state = "normal"
        return AlarmDecision(self.state, None, None)


@dataclass(frozen=True)
class OnlineSampleAssessment:
    sample_index: int
    quality: DataQualityResult
    t2: float | None
    spe: float | None
    anomaly_score: float | None
    top_contributor_indices: tuple[int, ...]
    alarm: AlarmDecision


@dataclass(frozen=True)
class Episode:
    start_sample: int
    end_sample: int

    def __post_init__(self) -> None:
        if self.start_sample < 0 or self.end_sample < 0:
            raise ValueError("episode samples must be non-negative")
        if self.end_sample < self.start_sample:
            raise ValueError("end_sample must not be earlier than start_sample")

@dataclass(frozen=True)
class EventMetrics:
    matched_events: int
    false_alarm_events: int
    precision: float
    recall: float
    detection_delays: tuple[int, ...]
    false_alarms_per_1000_samples: float


def evaluate_alarm_episodes(
    predicted: list[Episode],
    truth: list[Episode],
    *,
    observation_samples: int,
) -> EventMetrics:
    if observation_samples < 1:
        raise ValueError("observation_samples must be at least 1")
    used_predictions: set[int] = set()
    delays: list[int] = []
    for truth_episode in sorted(truth, key=lambda episode: episode.start_sample):
        matches = [
            (index, predicted_episode)
            for index, predicted_episode in enumerate(predicted)
            if index not in used_predictions
            and predicted_episode.start_sample <= truth_episode.end_sample
            and predicted_episode.end_sample >= truth_episode.start_sample
        ]
        if not matches:
            continue
        prediction_index, prediction = min(
            matches,
            key=lambda item: item[1].start_sample,
        )
        used_predictions.add(prediction_index)
        delays.append(prediction.start_sample - truth_episode.start_sample)

    matched_events = len(used_predictions)
    false_alarm_events = len(predicted) - matched_events
    return EventMetrics(
        matched_events=matched_events,
        false_alarm_events=false_alarm_events,
        precision=matched_events / len(predicted) if predicted else 1.0,
        recall=matched_events / len(truth) if truth else 1.0,
        detection_delays=tuple(delays),
        false_alarms_per_1000_samples=false_alarm_events / observation_samples * 1000,
    )


class OnlinePCAMonitor:
    def __init__(
        self,
        detector: PCAFaultDetector,
        *,
        expected_features: int,
        enter_threshold: float = 1.0,
        exit_threshold: float = 0.8,
        enter_consecutive: int = 3,
        exit_consecutive: int = 5,
        top_contributor_count: int = 3,
    ) -> None:
        self.detector = detector
        self.quality_gate = SampleQualityGate(expected_features=expected_features)
        self.alarm_state_machine = AlarmStateMachine(
            enter_threshold=enter_threshold,
            exit_threshold=exit_threshold,
            enter_consecutive=enter_consecutive,
            exit_consecutive=exit_consecutive,
        )
        self.top_contributor_count = top_contributor_count
        self._last_sample_index: int | None = None

    def process(
        self,
        values: NDArray[np.float64],
        *,
        sample_index: int,
    ) -> OnlineSampleAssessment:
        if self._last_sample_index is not None and sample_index <= self._last_sample_index:
            raise ValueError("sample_index must be strictly increasing")
        self._last_sample_index = sample_index
        sample = np.asarray(values, dtype=np.float64)
        quality = self.quality_gate.check(sample)
        if not quality.valid:
            return OnlineSampleAssessment(
                sample_index=sample_index,
                quality=quality,
                t2=None,
                spe=None,
                anomaly_score=None,
                top_contributor_indices=(),
                alarm=self.alarm_state_machine.invalidate(),
            )

        scores = self.detector.score(sample)
        anomaly_score = float(scores.anomaly_score[0])
        top_indices = self.detector.top_contributor_indices(
            sample,
            count=self.top_contributor_count,
        )
        return OnlineSampleAssessment(
            sample_index=sample_index,
            quality=quality,
            t2=float(scores.t2[0]),
            spe=float(scores.spe[0]),
            anomaly_score=anomaly_score,
            top_contributor_indices=tuple(int(index) for index in top_indices),
            alarm=self.alarm_state_machine.update(anomaly_score, sample_index),
        )


class PCAFaultDetector:
    def __init__(self, variance_ratio: float = 0.95, threshold_quantile: float = 0.99):
        self.variance_ratio = variance_ratio
        self.threshold_quantile = threshold_quantile
        self.scaler = StandardScaler()
        self.pca = PCA(n_components=variance_ratio, svd_solver="full")
        self.t2_threshold = 0.0
        self.spe_threshold = 0.0

    def fit(self, normal_values: NDArray[np.float64]) -> PCAFaultDetector:
        standardized = self.scaler.fit_transform(normal_values)
        self.pca.fit(standardized)
        scores = self._raw_scores(standardized)
        epsilon = np.finfo(np.float64).eps
        self.t2_threshold = max(float(np.quantile(scores.t2, self.threshold_quantile)), epsilon)
        self.spe_threshold = max(float(np.quantile(scores.spe, self.threshold_quantile)), epsilon)
        return self

    def _raw_scores(self, standardized: NDArray[np.float64]) -> PCAScores:
        latent = self.pca.transform(standardized)
        safe_variance = np.maximum(self.pca.explained_variance_, np.finfo(float).eps)
        t2 = np.sum((latent**2) / safe_variance, axis=1)
        reconstructed = self.pca.inverse_transform(latent)
        contributions = (standardized - reconstructed) ** 2
        spe = contributions.sum(axis=1)
        return PCAScores(t2, spe, np.zeros_like(t2), contributions)

    def score(self, values: NDArray[np.float64]) -> PCAScores:
        standardized = self.scaler.transform(np.atleast_2d(values))
        raw = self._raw_scores(standardized)
        anomaly_score = np.maximum(
            raw.t2 / self.t2_threshold,
            raw.spe / self.spe_threshold,
        )
        return PCAScores(raw.t2, raw.spe, anomaly_score, raw.contributions)

    def top_contributor_indices(
        self, value: NDArray[np.float64], count: int = 3
    ) -> NDArray[np.int64]:
        contributions = self.score(np.asarray(value)[None, :]).contributions[0]
        return np.argsort(contributions, kind="stable")[-count:][::-1]


def window_features(windows: NDArray[np.float64]) -> NDArray[np.float64]:
    if windows.ndim != 3:
        raise ValueError("windows must have shape (samples, time, features)")
    if windows.shape[1] < 2:
        raise ValueError("window size must be at least 2")
    last = windows[:, -1, :]
    mean = windows.mean(axis=1)
    std = windows.std(axis=1)
    delta = windows[:, -1, :] - windows[:, 0, :]
    time = np.arange(windows.shape[1], dtype=np.float64)
    time -= time.mean()
    slope = np.einsum("ntf,t->nf", windows, time) / np.sum(time**2)
    return np.concatenate([last, mean, std, delta, slope], axis=1)


class FaultClassifier:
    def __init__(self, random_state: int = 42):
        self.estimator = HistGradientBoostingClassifier(
            learning_rate=0.08,
            max_iter=100,
            max_leaf_nodes=15,
            l2_regularization=0.1,
            random_state=random_state,
        )

    def fit(self, windows: NDArray[np.float64], labels: NDArray[np.int64]) -> FaultClassifier:
        self.estimator.fit(window_features(windows), labels)
        return self

    def predict_top3(self, windows: NDArray[np.float64]) -> list[list[tuple[int, float]]]:
        probabilities = self.estimator.predict_proba(window_features(windows))
        classes = self.estimator.classes_
        results: list[list[tuple[int, float]]] = []
        for row in probabilities:
            ranked = np.argsort(row, kind="stable")[::-1][:3]
            results.append([(int(classes[index]), float(row[index])) for index in ranked])
        return results
