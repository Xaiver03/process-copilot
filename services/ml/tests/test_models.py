import numpy as np
import pytest
from process_copilot_ml.metadata import variable_dictionary
from process_copilot_ml.model import FaultClassifier, PCAFaultDetector, window_features
from process_copilot_ml.recommendations import recommendation_for_fault


def test_pca_scores_are_nonnegative_and_detect_large_shift() -> None:
    rng = np.random.default_rng(42)
    normal = rng.normal(size=(300, 8))
    detector = PCAFaultDetector(variance_ratio=0.9, threshold_quantile=0.99).fit(normal)

    normal_scores = detector.score(normal[:1])
    shifted_scores = detector.score(normal[:1] + 8.0)

    assert normal_scores.t2[0] >= 0
    assert normal_scores.spe[0] >= 0
    assert shifted_scores.anomaly_score[0] > normal_scores.anomaly_score[0]


def test_pca_variable_contributions_sum_to_spe() -> None:
    rng = np.random.default_rng(7)
    normal = rng.normal(size=(200, 6))
    detector = PCAFaultDetector(variance_ratio=0.8).fit(normal)

    scores = detector.score(normal[:5] + 2.0)

    np.testing.assert_allclose(scores.contributions.sum(axis=1), scores.spe)
    assert detector.top_contributor_indices(normal[0] + 2.0, count=3).shape == (3,)


def test_window_features_have_stable_shape() -> None:
    windows = np.arange(2 * 20 * 4, dtype=float).reshape(2, 20, 4)

    features = window_features(windows)

    assert features.shape == (2, 20)
    np.testing.assert_allclose(features[0, :4], windows[0, -1])


@pytest.mark.parametrize("window_size", [0, 1])
def test_window_features_rejects_windows_shorter_than_two(window_size: int) -> None:
    windows = np.zeros((2, window_size, 4), dtype=float)

    with pytest.raises(ValueError, match="at least 2"):
        window_features(windows)


def test_hist_gradient_classifier_returns_ranked_top_three() -> None:
    rng = np.random.default_rng(10)
    windows = []
    labels = []
    for label, offset in [(0, 0.0), (1, 3.0), (6, -3.0), (13, 6.0)]:
        windows.append(rng.normal(loc=offset, scale=0.3, size=(35, 20, 5)))
        labels.extend([label] * 35)
    training = np.concatenate(windows)
    classifier = FaultClassifier(random_state=42).fit(training, np.asarray(labels))

    candidates = classifier.predict_top3(training[-1:])[0]

    assert len(candidates) == 3
    assert candidates[0][0] == 13
    assert candidates[0][1] >= candidates[1][1] >= candidates[2][1]


def test_variable_dictionary_matches_tep_contract() -> None:
    variables = variable_dictionary()

    assert len(variables) == 52
    assert variables[0]["variableId"] == "XMEAS(1)"
    assert variables[40]["variableId"] == "XMEAS(41)"
    assert variables[41]["variableId"] == "XMV(1)"
    assert variables[-1]["variableId"] == "XMV(11)"


def test_recommendation_is_template_only_and_forbids_control_writeback() -> None:
    recommendation = recommendation_for_fault(6)

    assert recommendation["mode"] == "template"
    assert recommendation["checks"]
    assert recommendation["actions"]
    assert recommendation["safetyBoundary"] == (
        "Read-only advice. No automatic control write-back."
    )
