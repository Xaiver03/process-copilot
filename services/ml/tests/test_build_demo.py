import hashlib
import inspect
import json
import platform
from importlib.metadata import version
from pathlib import Path

import numpy as np
import process_copilot_ml
import pyarrow.parquet as pq
import pytest
from process_copilot_ml.build import DEMO_FAULTS, build_demo, select_diagnosis_sample
from process_copilot_ml.cli import main
from process_copilot_ml.recommendations import recommendation_for_fault


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _implementation_hash() -> str:
    package_dir = Path(process_copilot_ml.__file__).parent
    digest = hashlib.sha256()
    for path in sorted(package_dir.glob("*.py")):
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def test_diagnosis_sample_uses_one_fixed_delay_and_clamps_at_run_end() -> None:
    assert tuple(inspect.signature(select_diagnosis_sample).parameters) == (
        "detection_sample",
        "sample_count",
        "delay_samples",
    )
    selector_source = inspect.getsource(select_diagnosis_sample).lower()
    for forbidden_term in ("fault", "onset", "label", "correct", "prediction"):
        assert forbidden_term not in selector_source
    assert select_diagnosis_sample(160, 960) == 180
    assert select_diagnosis_sample(167, 960) == 187
    assert select_diagnosis_sample(950, 960) == 959


def test_build_demo_writes_complete_deterministic_artifacts(source_zip, tmp_path) -> None:
    first_output = tmp_path / "first" / "processed"
    first_manifests = tmp_path / "first" / "manifests"
    second_output = tmp_path / "second" / "processed"
    second_manifests = tmp_path / "second" / "manifests"

    first = build_demo(source_zip, first_output, first_manifests)
    second = build_demo(source_zip, second_output, second_manifests)

    assert first.build_hash == second.build_hash
    assert (first_manifests / "build_manifest.json").read_bytes() == (
        second_manifests / "build_manifest.json"
    ).read_bytes()
    assert len(list((first_output / "bronze").rglob("*.parquet"))) == 44

    variables = _load_json(first_output / "variable_dictionary.json")
    assert len(variables) == 52

    model_manifest = _load_json(first_output / "models" / "model_manifest.json")
    assert model_manifest["modelVersion"].startswith("tep-pca-hgb-")
    config = model_manifest["config"]
    assert config["implementationSha256"] == _implementation_hash()
    assert config["lockSha256"] == _sha256(Path(__file__).parents[1] / "uv.lock")
    assert config["runtime"] == {
        "python": platform.python_version(),
        "dependencies": {
            name: version(name) for name in ("joblib", "numpy", "pyarrow", "scikit-learn")
        },
    }
    assert model_manifest["detector"]["t2Threshold"] > 0
    assert model_manifest["detector"]["speThreshold"] > 0
    assert model_manifest["classifier"]["classes"] == [0, 1, 6, 13]
    assert len(model_manifest["artifacts"]) == 2
    assert all(len(artifact["sha256"]) == 64 for artifact in model_manifest["artifacts"])

    manifest = _load_json(first_manifests / "build_manifest.json")
    for artifact in manifest["artifacts"]:
        artifact_path = first_output / artifact["path"]
        assert artifact_path.stat().st_size == artifact["sizeBytes"]
        assert _sha256(artifact_path) == artifact["sha256"]

    scenario_dirs = sorted((first_output / "scenarios").iterdir())
    assert len(scenario_dirs) == len(DEMO_FAULTS) == 3
    expected_scenario_keys = {
        "id",
        "name",
        "faultId",
        "sampleCount",
        "faultOnsetSample",
        "sourceLabel",
    }
    for scenario_dir in scenario_dirs:
        scenario = _load_json(scenario_dir / "scenario.json")
        assert set(scenario) == expected_scenario_keys
        assert scenario["sampleCount"] == 960
        assert scenario["faultOnsetSample"] == 160
        assert scenario["sourceLabel"] == "Tennessee Eastman Process public simulation"

        telemetry = pq.read_table(scenario_dir / "telemetry.parquet")
        assert telemetry.num_rows == 960
        assert "t2" in telemetry.column_names
        assert "spe" in telemetry.column_names
        assert "candidate1FaultId" in telemetry.column_names
        assert "activeFaultId" not in telemetry.column_names

        event = _load_json(scenario_dir / "event-template.json")
        anomaly_scores = telemetry["anomalyScore"].to_numpy()
        detected = np.flatnonzero(anomaly_scores[160:] >= 1.0)
        expected_sample = (
            160 + int(detected[0]) if len(detected) else 160 + int(np.argmax(anomaly_scores[160:]))
        )
        diagnosis_sample = min(expected_sample + 20, telemetry.num_rows - 1)
        assert event["sampleIndex"] == expected_sample
        assert event["detectionSample"] == expected_sample
        assert event["diagnosisSample"] == diagnosis_sample
        assert event["diagnosisDelaySamples"] == 20
        assert event["diagnosisState"] == "updated"
        assert event["anomalyLatched"] is True
        assert event["anomalyScore"] == pytest.approx(anomaly_scores[expected_sample])
        assert event["diagnosisAnomalyScore"] == pytest.approx(
            anomaly_scores[diagnosis_sample]
        )
        assert len(event["initialCandidates"]) == 3
        assert len(event["candidates"]) == 3
        for rank, candidate in enumerate(event["initialCandidates"], start=1):
            assert (
                candidate["faultId"]
                == telemetry[f"candidate{rank}FaultId"][expected_sample].as_py()
            )
            assert candidate["probability"] == pytest.approx(
                telemetry[f"candidate{rank}Probability"][expected_sample].as_py()
            )
        for rank, candidate in enumerate(event["candidates"], start=1):
            assert (
                candidate["faultId"]
                == telemetry[f"candidate{rank}FaultId"][diagnosis_sample].as_py()
            )
            assert candidate["probability"] == pytest.approx(
                telemetry[f"candidate{rank}Probability"][diagnosis_sample].as_py()
            )
        assert len(event["evidence"]) == 3
        for evidence in event["evidence"]:
            assert evidence["values"][-1] == pytest.approx(
                telemetry[evidence["variableId"]][diagnosis_sample].as_py()
            )
        if scenario["faultId"] == 13:
            assert event["diagnosisAnomalyScore"] < 1.0
            assert event["anomalyLatched"] is True
        assert event["recommendation"] == recommendation_for_fault(
            event["candidates"][0]["faultId"]
        )
        assert event["recommendation"]["mode"] == "template"
        assert event["recommendation"]["safetyBoundary"].endswith(
            "No automatic control write-back."
        )

    train_columns = pq.read_schema(first_output / "bronze/train/fault_01.parquet").names
    test_columns = pq.read_schema(first_output / "bronze/test/fault_01.parquet").names
    assert "activeFaultId" in train_columns
    assert "activeFaultId" not in test_columns


def test_build_demo_refuses_nonempty_formal_directories(source_zip, tmp_path) -> None:
    output_dir = tmp_path / "processed"
    manifest_dir = tmp_path / "manifests"
    output_dir.mkdir()
    manifest_dir.mkdir()
    (output_dir / "keep.txt").write_text("old", encoding="utf-8")
    (manifest_dir / "keep.json").write_text("old", encoding="utf-8")

    with pytest.raises(FileExistsError, match="--force"):
        build_demo(source_zip, output_dir, manifest_dir)

    assert (output_dir / "keep.txt").read_text(encoding="utf-8") == "old"
    assert (manifest_dir / "keep.json").read_text(encoding="utf-8") == "old"


def test_force_publish_atomically_replaces_old_directories(source_zip, tmp_path) -> None:
    output_dir = tmp_path / "processed"
    manifest_dir = tmp_path / "manifests"
    output_dir.mkdir()
    manifest_dir.mkdir()
    (output_dir / "stale.bin").write_bytes(b"old")
    (manifest_dir / "stale.json").write_text("old", encoding="utf-8")

    result = build_demo(source_zip, output_dir, manifest_dir, force=True)

    assert result.output_dir == output_dir
    assert result.manifest_path == manifest_dir / "build_manifest.json"
    assert not (output_dir / "stale.bin").exists()
    assert not (manifest_dir / "stale.json").exists()
    assert not list(tmp_path.glob(".build-demo-*"))


def test_cli_build_demo_accepts_explicit_paths(source_zip, tmp_path) -> None:
    output_dir = tmp_path / "processed"
    manifest_dir = tmp_path / "manifests"
    output_dir.mkdir()
    manifest_dir.mkdir()
    (output_dir / "stale.bin").write_bytes(b"old")
    (manifest_dir / "stale.json").write_text("old", encoding="utf-8")

    exit_code = main(
        [
            "build-demo",
            "--source-zip",
            str(source_zip),
            "--output-dir",
            str(output_dir),
            "--manifest-dir",
            str(manifest_dir),
            "--force",
        ]
    )

    assert exit_code == 0
    assert (manifest_dir / "build_manifest.json").is_file()
    assert (output_dir / "scenarios").is_dir()
    assert not (output_dir / "stale.bin").exists()
