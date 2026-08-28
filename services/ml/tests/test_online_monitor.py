from __future__ import annotations

import numpy as np
import process_copilot_ml.model as model_module
import pytest


def test_alarm_opens_only_after_persistent_anomaly() -> None:
    state_machine_type = getattr(model_module, "AlarmStateMachine", None)
    assert state_machine_type is not None, "online alarm state machine is not implemented"

    state_machine = state_machine_type(
        enter_threshold=1.0,
        exit_threshold=0.8,
        enter_consecutive=3,
        exit_consecutive=2,
    )

    decisions = [
        state_machine.update(score, sample_index)
        for sample_index, score in enumerate([0.2, 1.1, 1.2, 1.3])
    ]

    assert [decision.state for decision in decisions] == [
        "normal",
        "pending",
        "pending",
        "open",
    ]
    assert decisions[-1].transition == "opened"
    assert decisions[-1].event_start_sample == 1


def test_open_alarm_uses_hysteresis_and_persistent_recovery() -> None:
    state_machine = model_module.AlarmStateMachine(
        enter_threshold=1.0,
        exit_threshold=0.8,
        enter_consecutive=3,
        exit_consecutive=2,
    )
    for sample_index, score in enumerate([1.1, 1.2, 1.3]):
        state_machine.update(score, sample_index)

    decisions = [
        state_machine.update(score, sample_index)
        for sample_index, score in enumerate([0.9, 0.7, 1.1, 0.7, 0.6], start=3)
    ]

    assert [decision.state for decision in decisions] == [
        "open",
        "recovering",
        "open",
        "recovering",
        "normal",
    ]
    assert [decision.transition for decision in decisions] == [
        None,
        None,
        None,
        None,
        "closed",
    ]
    assert all(decision.event_start_sample == 0 for decision in decisions[:-1])
    assert decisions[-1].event_start_sample is None


def test_quality_gate_rejects_wrong_width_and_non_finite_values() -> None:
    quality_gate_type = getattr(model_module, "SampleQualityGate", None)
    assert quality_gate_type is not None, "sample quality gate is not implemented"

    quality_gate = quality_gate_type(expected_features=3)

    valid = quality_gate.check(np.asarray([1.0, 2.0, 3.0]))
    wrong_width = quality_gate.check(np.asarray([1.0, 2.0]))
    non_finite = quality_gate.check(np.asarray([1.0, np.nan, 3.0]))

    assert valid.valid is True
    assert valid.reasons == ()
    assert wrong_width.valid is False
    assert wrong_width.reasons == ("feature_count",)
    assert non_finite.valid is False
    assert non_finite.reasons == ("non_finite",)


def test_online_monitor_scores_valid_samples_and_blocks_bad_data() -> None:
    online_monitor_type = getattr(model_module, "OnlinePCAMonitor", None)
    assert online_monitor_type is not None, "online PCA monitor is not implemented"

    random = np.random.default_rng(42)
    baseline = random.normal(0.0, 0.1, size=200)
    normal = np.column_stack(
        [
            baseline,
            baseline + random.normal(0.0, 0.001, size=200),
            baseline + random.normal(0.0, 0.001, size=200),
        ]
    )
    detector = model_module.PCAFaultDetector(
        variance_ratio=0.90,
        threshold_quantile=0.99,
    ).fit(normal)
    monitor = online_monitor_type(
        detector,
        expected_features=3,
        enter_threshold=1.0,
        exit_threshold=0.8,
        enter_consecutive=2,
        exit_consecutive=2,
    )

    shifted = np.asarray([8.0, 0.0, 0.0])
    first = monitor.process(shifted, sample_index=0)
    invalid = monitor.process(np.asarray([np.nan, 0.0, 0.0]), sample_index=1)
    second = monitor.process(shifted, sample_index=2)
    opened = monitor.process(shifted, sample_index=3)

    assert first.quality.valid is True
    assert first.anomaly_score is not None and first.anomaly_score >= 1.0
    assert first.alarm.state == "pending"
    assert invalid.quality.valid is False
    assert invalid.anomaly_score is None
    assert invalid.top_contributor_indices == ()
    assert invalid.alarm.state == "normal"
    assert second.alarm.state == "pending"
    assert opened.alarm.transition == "opened"
    assert opened.alarm.event_start_sample == 2
    assert opened.top_contributor_indices[0] == 0


def test_event_metrics_match_alarm_episodes_once_and_report_delay() -> None:
    evaluate = getattr(model_module, "evaluate_alarm_episodes", None)
    episode_type = getattr(model_module, "Episode", None)
    assert evaluate is not None and episode_type is not None, "event metrics are not implemented"

    truth = [episode_type(10, 20), episode_type(40, 50)]
    predicted = [episode_type(8, 15), episode_type(42, 47), episode_type(70, 75)]

    metrics = evaluate(predicted, truth, observation_samples=100)

    assert metrics.matched_events == 2
    assert metrics.false_alarm_events == 1
    assert metrics.precision == 2 / 3
    assert metrics.recall == 1.0
    assert metrics.detection_delays == (-2, 2)
    assert metrics.false_alarms_per_1000_samples == 10.0


@pytest.mark.parametrize(
    "overrides",
    [
        {"enter_threshold": 0.8, "exit_threshold": 0.8},
        {"enter_consecutive": 0},
        {"exit_consecutive": 0},
    ],
)
def test_alarm_state_machine_rejects_unsafe_configuration(
    overrides: dict[str, float | int],
) -> None:
    configuration: dict[str, float | int] = {
        "enter_threshold": 1.0,
        "exit_threshold": 0.8,
        "enter_consecutive": 3,
        "exit_consecutive": 2,
    }
    configuration.update(overrides)

    with pytest.raises(ValueError):
        model_module.AlarmStateMachine(**configuration)


def test_online_monitor_rejects_duplicate_or_out_of_order_sample_indices() -> None:
    random = np.random.default_rng(7)
    detector = model_module.PCAFaultDetector().fit(random.normal(size=(100, 3)))
    monitor = model_module.OnlinePCAMonitor(detector, expected_features=3)

    monitor.process(np.asarray([0.0, 0.0, 0.0]), sample_index=4)

    with pytest.raises(ValueError, match="strictly increasing"):
        monitor.process(np.asarray([0.0, 0.0, 0.0]), sample_index=4)
    with pytest.raises(ValueError, match="strictly increasing"):
        monitor.process(np.asarray([0.0, 0.0, 0.0]), sample_index=3)


def test_event_metrics_reject_invalid_episode_and_observation_ranges() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        model_module.Episode(-1, 2)
    with pytest.raises(ValueError, match="end_sample"):
        model_module.Episode(3, 2)
    with pytest.raises(ValueError, match="observation_samples"):
        model_module.evaluate_alarm_episodes([], [], observation_samples=0)
