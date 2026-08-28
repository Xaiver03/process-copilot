from __future__ import annotations

from dataclasses import dataclass

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
