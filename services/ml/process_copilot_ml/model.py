from __future__ import annotations

from dataclasses import dataclass
from numbers import Integral
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from sklearn.decomposition import PCA
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler


def _is_positive_integer(value: object) -> bool:
    return isinstance(value, Integral) and not isinstance(value, bool) and value >= 1


def _is_non_negative_integer(value: object) -> bool:
    return isinstance(value, Integral) and not isinstance(value, bool) and value >= 0


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
    opened_sample: int | None


@dataclass(frozen=True)
class DataQualityResult:
    valid: bool
    reasons: tuple[
        Literal["feature_count", "non_finite", "sample_gap", "unparseable"],
        ...,
    ]


class SampleQualityGate:
    def __init__(self, *, expected_features: int) -> None:
        if not _is_positive_integer(expected_features):
            raise ValueError("expected_features must be a positive integer")
        self.expected_features = expected_features

    def coerce(
        self,
        values: object,
    ) -> tuple[DataQualityResult, NDArray[np.float64] | None]:
        try:
            sample = np.asarray(values, dtype=np.float64)
        except (OverflowError, TypeError, ValueError):
            return DataQualityResult(False, ("unparseable",)), None
        if sample.ndim != 1 or len(sample) != self.expected_features:
            return DataQualityResult(False, ("feature_count",)), None
        if not np.isfinite(sample).all():
            return DataQualityResult(False, ("non_finite",)), None
        return DataQualityResult(True, ()), sample

    def check(self, values: object) -> DataQualityResult:
        quality, _ = self.coerce(values)
        return quality


class AlarmStateMachine:
    def __init__(
        self,
        *,
        enter_threshold: float,
        exit_threshold: float,
        enter_consecutive: int,
        exit_consecutive: int,
    ) -> None:
        if not np.isfinite(enter_threshold) or not np.isfinite(exit_threshold):
            raise ValueError("alarm thresholds must be finite")
        if enter_threshold <= exit_threshold:
            raise ValueError("enter_threshold must be strictly greater than exit_threshold")
        if not _is_positive_integer(enter_consecutive) or not _is_positive_integer(
            exit_consecutive
        ):
            raise ValueError("consecutive counters must be positive integers")
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
            return AlarmDecision(self.state, None, self._event_start_sample, None)

        self.state = "normal"
        self._enter_count = 0
        self._event_start_sample = None
        return AlarmDecision(self.state, None, None, None)

    def update(self, anomaly_score: float, sample_index: int) -> AlarmDecision:
        if not np.isfinite(anomaly_score):
            raise ValueError("anomaly_score must be finite")
        if not _is_non_negative_integer(sample_index):
            raise ValueError("sample_index must be a non-negative integer")
        if self.state in {"open", "recovering"}:
            if anomaly_score <= self.exit_threshold:
                self._exit_count += 1
                if self._exit_count >= self.exit_consecutive:
                    self.state = "normal"
                    self._enter_count = 0
                    self._exit_count = 0
                    self._event_start_sample = None
                    return AlarmDecision(self.state, "closed", None, None)
                self.state = "recovering"
                return AlarmDecision(self.state, None, self._event_start_sample, None)

            self._exit_count = 0
            self.state = "open"
            return AlarmDecision(self.state, None, self._event_start_sample, None)

        if anomaly_score >= self.enter_threshold:
            if self._enter_count == 0:
                self._event_start_sample = sample_index
            self._enter_count += 1
            if self._enter_count >= self.enter_consecutive:
                self.state = "open"
                return AlarmDecision(
                    self.state,
                    "opened",
                    self._event_start_sample,
                    sample_index,
                )
            self.state = "pending"
            return AlarmDecision(self.state, None, self._event_start_sample, None)

        self._enter_count = 0
        self._event_start_sample = None
        self.state = "normal"
        return AlarmDecision(self.state, None, None, None)


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
    duplicate_alarm_events: int
    precision: float
    recall: float
    detection_delays: tuple[int, ...]
    false_alarms_per_1000_samples: float


def evaluate_alarm_episodes(
    predicted: list[Episode],
    truth: list[Episode],
    *,
    observation_samples: int,
    early_detection_tolerance_samples: int = 0,
) -> EventMetrics:
    if observation_samples < 1:
        raise ValueError("observation_samples must be at least 1")
    if early_detection_tolerance_samples < 0:
        raise ValueError("early_detection_tolerance_samples must be non-negative")
    if any(
        episode.end_sample >= observation_samples
        for episode in [*predicted, *truth]
    ):
        raise ValueError("episodes must stay inside the observation range")

    def qualifies(prediction: Episode, truth_episode: Episode) -> bool:
        earliest_start = truth_episode.start_sample - early_detection_tolerance_samples
        return (
            prediction.start_sample >= earliest_start
            and prediction.start_sample <= truth_episode.end_sample
            and prediction.end_sample >= truth_episode.start_sample
        )

    ordered_truth = sorted(truth, key=lambda episode: episode.start_sample)
    candidates = [
        [
            prediction_index
            for prediction_index, prediction in sorted(
                enumerate(predicted),
                key=lambda item: (
                    item[1].start_sample,
                    item[1].end_sample,
                    item[0],
                ),
            )
            if qualifies(prediction, truth_episode)
        ]
        for truth_episode in ordered_truth
    ]
    eligible_predictions = {
        prediction_index
        for truth_candidates in candidates
        for prediction_index in truth_candidates
    }
    prediction_to_truth: dict[int, int] = {}

    def assign(truth_index: int, visited_predictions: set[int]) -> bool:
        for prediction_index in candidates[truth_index]:
            if prediction_index in visited_predictions:
                continue
            visited_predictions.add(prediction_index)
            previous_truth = prediction_to_truth.get(prediction_index)
            if previous_truth is None or assign(previous_truth, visited_predictions):
                prediction_to_truth[prediction_index] = truth_index
                return True
        return False

    for truth_index in range(len(ordered_truth)):
        assign(truth_index, set())

    truth_to_prediction = {
        truth_index: prediction_index
        for prediction_index, truth_index in prediction_to_truth.items()
    }
    delays = [
        predicted[truth_to_prediction[truth_index]].start_sample
        - truth_episode.start_sample
        for truth_index, truth_episode in enumerate(ordered_truth)
        if truth_index in truth_to_prediction
    ]
    matched_events = len(prediction_to_truth)
    false_alarm_events = len(predicted) - len(eligible_predictions)
    duplicate_alarm_events = len(eligible_predictions) - matched_events
    return EventMetrics(
        matched_events=matched_events,
        false_alarm_events=false_alarm_events,
        duplicate_alarm_events=duplicate_alarm_events,
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
        expected_sample_step: int = 1,
    ) -> None:
        if not _is_positive_integer(top_contributor_count) or not (
            top_contributor_count <= expected_features
        ):
            raise ValueError(
                "top_contributor_count must be between 1 and expected_features"
            )
        if not _is_positive_integer(expected_sample_step):
            raise ValueError("expected_sample_step must be a positive integer")
        self.detector = detector
        self.quality_gate = SampleQualityGate(expected_features=expected_features)
        self.alarm_state_machine = AlarmStateMachine(
            enter_threshold=enter_threshold,
            exit_threshold=exit_threshold,
            enter_consecutive=enter_consecutive,
            exit_consecutive=exit_consecutive,
        )
        self.top_contributor_count = top_contributor_count
        self.expected_sample_step = expected_sample_step
        self._last_sample_index: int | None = None

    def process(
        self,
        values: object,
        *,
        sample_index: int,
    ) -> OnlineSampleAssessment:
        if not _is_non_negative_integer(sample_index):
            raise ValueError("sample_index must be a non-negative integer")
        if self._last_sample_index is not None and sample_index <= self._last_sample_index:
            raise ValueError("sample_index must be strictly increasing")
        has_gap = (
            self._last_sample_index is not None
            and sample_index != self._last_sample_index + self.expected_sample_step
        )
        self._last_sample_index = sample_index
        if has_gap:
            quality = DataQualityResult(False, ("sample_gap",))
            return OnlineSampleAssessment(
                sample_index=sample_index,
                quality=quality,
                t2=None,
                spe=None,
                anomaly_score=None,
                top_contributor_indices=(),
                alarm=self.alarm_state_machine.invalidate(),
            )
        quality, sample = self.quality_gate.coerce(values)
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

        assert sample is not None
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
