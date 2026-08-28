from __future__ import annotations

import json
import shutil
from dataclasses import replace
from pathlib import Path

import numpy as np
import process_copilot_ml
import pytest


@pytest.fixture
def artifacts() -> tuple[Path, Path]:
    root = Path(__file__).resolve().parents[3]
    return (
        root / "data" / "processed" / "models",
        root / "data" / "processed" / "variable_dictionary.json",
    )


def _baseline_values(model_dir: Path) -> np.ndarray:
    from joblib import load

    detector = load(model_dir / "pca_detector.joblib")
    return detector.scaler.mean_.copy()


def _shifted_values(model_dir: Path) -> np.ndarray:
    from joblib import load

    detector = load(model_dir / "pca_detector.joblib")
    return detector.scaler.mean_ + 20.0 * detector.scaler.scale_


def _raw_mapping(variable_dictionary_path: Path, values: np.ndarray) -> dict[str, float]:
    variables = json.loads(variable_dictionary_path.read_text(encoding="utf-8"))
    return {
        variable["variableId"]: float(values[index])
        for index, variable in enumerate(variables)
    }


def _copy_model_artifacts(model_dir: Path, tmp_path: Path) -> Path:
    copied_model_dir = tmp_path / "models"
    shutil.copytree(model_dir, copied_model_dir)
    return copied_model_dir


def _without_latency(result):
    return replace(result, latency_ms=0.0)


def _engine_type():
    engine_type = getattr(process_copilot_ml, "OnlineInferenceEngine", None)
    assert engine_type is not None, "online inference engine is not implemented"
    return engine_type


def test_engine_uses_only_raw_variables_and_is_reproducible(artifacts) -> None:
    model_dir, variable_dictionary_path = artifacts
    values = _baseline_values(model_dir)
    raw = _raw_mapping(variable_dictionary_path, values)
    telemetry = {
        **raw,
        "faultOnsetSample": 160,
        "activeFaultId": 13,
        "t2": 999999.0,
        "spe": 999999.0,
        "anomalyScore": 999999.0,
        "candidate1FaultId": 21,
        "candidate1Probability": 1.0,
    }

    engine_type = _engine_type()
    first = engine_type.from_artifacts(model_dir, variable_dictionary_path)
    second = engine_type.from_artifacts(model_dir, variable_dictionary_path)
    first_result = first.process(sample_index=0, values=telemetry)
    second_result = second.process(sample_index=0, values=raw)

    assert _without_latency(first_result) == _without_latency(second_result)
    assert first_result.model_version
    assert first_result.t2 is not None
    assert first_result.spe is not None
    assert first_result.anomaly_score is not None
    assert first_result.initial_candidates is None
    assert first_result.updated_candidates is None


def test_engine_detects_then_updates_candidates_after_twenty_samples(artifacts) -> None:
    model_dir, variable_dictionary_path = artifacts
    engine = _engine_type().from_artifacts(model_dir, variable_dictionary_path)
    normal = _raw_mapping(variable_dictionary_path, _baseline_values(model_dir))
    shifted = _raw_mapping(variable_dictionary_path, _shifted_values(model_dir))

    for index in range(20):
        result = engine.process(sample_index=index, values=normal)
        assert result.transition is None

    detected = [engine.process(sample_index=index, values=shifted) for index in range(20, 23)]
    assert detected[-1].transition == "detected"
    assert detected[-1].alarm_state == "open"
    assert detected[-1].initial_candidates is not None
    assert len(detected[-1].initial_candidates) == 3
    assert detected[-1].updated_candidates is None

    updates = [engine.process(sample_index=index, values=shifted) for index in range(23, 43)]
    updated = [result for result in updates if result.transition == "updated"]
    assert len(updated) == 1
    assert updated[0].sample_index == 42
    assert len(updated[0].updated_candidates) == 3
    assert all(result.transition is None for result in updates if result is not updated[0])


def test_engine_bad_data_gap_and_reverse_never_score_pca(artifacts) -> None:
    model_dir, variable_dictionary_path = artifacts
    engine = _engine_type().from_artifacts(model_dir, variable_dictionary_path)
    values = _raw_mapping(variable_dictionary_path, _baseline_values(model_dir))

    valid = engine.process(sample_index=0, values=values)
    bad = engine.process(sample_index=1, values={**values, "XMEAS(1)": "not-a-number"})
    gap = engine.process(sample_index=3, values=values)

    assert valid.t2 is not None
    assert bad.quality.reasons == ("unparseable",)
    assert bad.t2 is None
    assert gap.quality.reasons == ("sample_gap",)
    assert gap.t2 is None
    with pytest.raises(ValueError, match="strictly increasing"):
        engine.process(sample_index=2, values=values)


def test_engine_requires_twenty_contiguous_samples_after_gap_for_update(artifacts) -> None:
    model_dir, variable_dictionary_path = artifacts
    engine = _engine_type().from_artifacts(model_dir, variable_dictionary_path)
    normal = _raw_mapping(variable_dictionary_path, _baseline_values(model_dir))
    shifted = _raw_mapping(variable_dictionary_path, _shifted_values(model_dir))

    for index in range(20):
        engine.process(sample_index=index, values=normal)
    for index in range(20, 23):
        result = engine.process(sample_index=index, values=shifted)
    assert result.transition == "detected"

    for index in range(23, 33):
        engine.process(sample_index=index, values=shifted)
    gap = engine.process(sample_index=34, values=shifted)
    assert gap.quality.reasons == ("sample_gap",)

    after_gap = [engine.process(sample_index=index, values=shifted) for index in range(35, 54)]
    assert all(result.transition != "updated" for result in after_gap)
    assert engine.process(sample_index=54, values=shifted).transition == "updated"


def test_engine_rejects_malformed_variable_dictionary(artifacts, tmp_path) -> None:
    model_dir, variable_dictionary_path = artifacts
    variables = json.loads(variable_dictionary_path.read_text(encoding="utf-8"))
    variables[0]["variableId"] = "activeFaultId"
    malformed = tmp_path / "variable_dictionary.json"
    malformed.write_text(json.dumps(variables), encoding="utf-8")

    with pytest.raises(ValueError, match="52 raw XMEAS/XMV variables"):
        _engine_type().from_artifacts(model_dir, malformed)


@pytest.mark.parametrize(
    "manifest_mutation",
    [
        pytest.param("missing_artifacts", id="missing-artifacts"),
        pytest.param("absolute_path", id="absolute-path"),
        pytest.param("parent_path", id="parent-path"),
        pytest.param("wrong_size", id="wrong-size"),
        pytest.param("wrong_hash", id="wrong-hash"),
        pytest.param("missing_file", id="missing-file"),
        pytest.param("tampered_file", id="tampered-file"),
    ],
)
def test_engine_rejects_invalid_model_artifact_integrity(
    artifacts, tmp_path, manifest_mutation
) -> None:
    model_dir, variable_dictionary_path = artifacts
    copied_model_dir = _copy_model_artifacts(model_dir, tmp_path)
    manifest = json.loads(
        (copied_model_dir / "model_manifest.json").read_text(encoding="utf-8")
    )

    if manifest_mutation == "missing_artifacts":
        manifest.pop("artifacts")
    elif manifest_mutation == "absolute_path":
        manifest["artifacts"][0]["path"] = "/tmp/pca_detector.joblib"
    elif manifest_mutation == "parent_path":
        manifest["artifacts"][0]["path"] = "../pca_detector.joblib"
    elif manifest_mutation == "wrong_size":
        manifest["artifacts"][0]["sizeBytes"] += 1
    elif manifest_mutation == "wrong_hash":
        manifest["artifacts"][0]["sha256"] = "0" * 64
    elif manifest_mutation == "missing_file":
        (copied_model_dir / "pca_detector.joblib").unlink()
    elif manifest_mutation == "tampered_file":
        with (copied_model_dir / "pca_detector.joblib").open("ab") as artifact:
            artifact.write(b"tampered")
    else:
        raise AssertionError(f"unknown mutation: {manifest_mutation}")
    if manifest_mutation not in {"missing_file", "tampered_file"}:
        (copied_model_dir / "model_manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )

    with pytest.raises(ValueError, match="model artifact integrity") as error:
        _engine_type().from_artifacts(copied_model_dir, variable_dictionary_path)

    assert str(copied_model_dir) not in str(error.value)


@pytest.mark.parametrize(
    "manifest_content",
    [
        pytest.param("[]", id="array"),
        pytest.param("{\"modelVersion\": \"missing-artifacts\"}", id="missing-artifacts"),
        pytest.param("not-json", id="malformed-json"),
    ],
)
def test_engine_rejects_invalid_model_manifest(artifacts, tmp_path, manifest_content) -> None:
    model_dir, variable_dictionary_path = artifacts
    copied_model_dir = _copy_model_artifacts(model_dir, tmp_path)
    (copied_model_dir / "model_manifest.json").write_text(manifest_content, encoding="utf-8")

    with pytest.raises(ValueError, match="model artifact integrity") as error:
        _engine_type().from_artifacts(copied_model_dir, variable_dictionary_path)

    assert str(copied_model_dir) not in str(error.value)
