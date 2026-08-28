from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import tempfile
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from process_copilot_ml.data import (
    FEATURE_COUNT,
    TEST_FAULT_ONSET_SAMPLE,
    RunData,
    active_fault_labels,
    load_tep_run,
    make_windows,
)
from process_copilot_ml.metadata import variable_dictionary
from process_copilot_ml.model import FaultClassifier, PCAFaultDetector
from process_copilot_ml.recommendations import recommendation_for_fault

DEMO_FAULTS = (1, 6, 13)
SOURCE_LABEL = "Tennessee Eastman Process public simulation"
DATA_DISCLOSURE = "Public simulation data, not real Guizhou plant data."
PIPELINE_VERSION = "0.1.0"
DIAGNOSIS_DELAY_SAMPLES = 20

_SCENARIOS = {
    1: ("tep-f01-feed-ratio-step", "Feed composition step deviation"),
    6: ("tep-f06-a-feed-loss", "A-feed loss"),
    13: ("tep-f13-kinetics-drift", "Reaction kinetics slow drift"),
}


@dataclass(frozen=True)
class BuildResult:
    build_hash: str
    manifest_path: Path
    output_dir: Path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def _write_json(path: Path, value: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical_bytes(value))
    return path


def _write_parquet(path: Path, columns: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.table(columns)
    pq.write_table(
        table,
        path,
        compression="zstd",
        use_dictionary=False,
        write_statistics=True,
        data_page_version="1.0",
    )
    return path


def _run_columns(run: RunData, include_active_fault: bool = False) -> dict[str, Any]:
    columns: dict[str, Any] = {
        "sampleIndex": np.arange(len(run.values), dtype=np.int32),
        "relativeSeconds": np.arange(len(run.values), dtype=np.int32) * 180,
    }
    if include_active_fault:
        labels = active_fault_labels(run.fault_id, run.split, len(run.values))
        columns["activeFaultId"] = labels.astype(np.int16)
    for index in range(FEATURE_COUNT):
        variable_id = f"XMEAS({index + 1})" if index < 41 else f"XMV({index - 40})"
        columns[variable_id] = run.values[:, index]
    return columns


def _standardized_run(run: RunData, detector: PCAFaultDetector) -> RunData:
    return RunData(
        run.run_id,
        run.fault_id,
        run.split,
        detector.scaler.transform(run.values),
    )


def _ranked_candidates(
    run: RunData, detector: PCAFaultDetector, classifier: FaultClassifier
) -> list[list[tuple[int, float]]]:
    windows = make_windows([_standardized_run(run, detector)], window_size=20).values
    ranked = classifier.predict_top3(windows)
    initial = [[(0, 1.0), (1, 0.0), (6, 0.0)] for _ in range(19)]
    return initial + ranked


def _evidence_items(
    run: RunData,
    sample_index: int,
    detector: PCAFaultDetector,
    contributions: np.ndarray,
) -> list[dict[str, Any]]:
    variables = variable_dictionary()
    indices = np.argsort(contributions, kind="stable")[-3:][::-1]
    standardized = detector.scaler.transform(run.values[sample_index : sample_index + 1])[0]
    evidence = []
    start = max(0, sample_index - 19)
    for index in indices:
        z_value = float(standardized[index])
        direction = "mixed" if abs(z_value) < 0.25 else ("up" if z_value > 0 else "down")
        variable = variables[int(index)]
        evidence.append(
            {
                **variable,
                "contribution": float(contributions[index]),
                "direction": direction,
                "summary": (
                    f"{variable['variableName']} is {direction} versus the normal baseline; "
                    f"SPE contribution {contributions[index]:.4f}."
                ),
                "values": [float(value) for value in run.values[start : sample_index + 1, index]],
            }
        )
    return evidence


def select_event_sample(
    anomaly_scores: np.ndarray,
    search_start: int = TEST_FAULT_ONSET_SAMPLE,
    threshold: float = 1.0,
) -> int:
    detected = np.flatnonzero(anomaly_scores[search_start:] >= threshold)
    if len(detected):
        return search_start + int(detected[0])
    return search_start + int(np.argmax(anomaly_scores[search_start:]))


def select_diagnosis_sample(
    detection_sample: int,
    sample_count: int,
    delay_samples: int = DIAGNOSIS_DELAY_SAMPLES,
) -> int:
    if sample_count < 1:
        raise ValueError("sample_count must be positive")
    if not 0 <= detection_sample < sample_count:
        raise ValueError("detection_sample must be inside the run")
    if delay_samples < 0:
        raise ValueError("delay_samples must be non-negative")
    return min(detection_sample + delay_samples, sample_count - 1)


def _candidate_items(ranked_row: list[tuple[int, float]]) -> list[dict[str, Any]]:
    return [
        {
            "faultId": fault_id,
            "label": _SCENARIOS.get(fault_id, ("normal", "Normal operation"))[1],
            "probability": probability,
        }
        for fault_id, probability in ranked_row
    ]


def _scenario_artifacts(
    output_dir: Path,
    run: RunData,
    detector: PCAFaultDetector,
    classifier: FaultClassifier,
    model_version: str,
) -> list[Path]:
    scenario_id, scenario_name = _SCENARIOS[run.fault_id]
    scenario_dir = output_dir / "scenarios" / scenario_id
    scenario = {
        "id": scenario_id,
        "name": scenario_name,
        "faultId": run.fault_id,
        "sampleCount": len(run.values),
        "faultOnsetSample": TEST_FAULT_ONSET_SAMPLE,
        "sourceLabel": SOURCE_LABEL,
    }
    scenario_path = _write_json(scenario_dir / "scenario.json", scenario)

    scores = detector.score(run.values)
    ranked = _ranked_candidates(run, detector, classifier)
    columns = _run_columns(run, include_active_fault=False)
    columns.update(
        {
            "t2": scores.t2,
            "spe": scores.spe,
            "anomalyScore": scores.anomaly_score,
            "candidate1FaultId": np.asarray([row[0][0] for row in ranked], dtype=np.int16),
            "candidate1Probability": np.asarray([row[0][1] for row in ranked]),
            "candidate2FaultId": np.asarray([row[1][0] for row in ranked], dtype=np.int16),
            "candidate2Probability": np.asarray([row[1][1] for row in ranked]),
            "candidate3FaultId": np.asarray([row[2][0] for row in ranked], dtype=np.int16),
            "candidate3Probability": np.asarray([row[2][1] for row in ranked]),
        }
    )
    telemetry_path = _write_parquet(scenario_dir / "telemetry.parquet", columns)

    detection_sample = select_event_sample(scores.anomaly_score)
    diagnosis_sample = select_diagnosis_sample(detection_sample, len(run.values))
    initial_candidates = _candidate_items(ranked[detection_sample])
    candidates = _candidate_items(ranked[diagnosis_sample])
    event = {
        "sampleIndex": detection_sample,
        "detectionSample": detection_sample,
        "diagnosisSample": diagnosis_sample,
        "diagnosisDelaySamples": DIAGNOSIS_DELAY_SAMPLES,
        "diagnosisState": "updated",
        "anomalyLatched": True,
        "anomalyScore": float(scores.anomaly_score[detection_sample]),
        "diagnosisAnomalyScore": float(scores.anomaly_score[diagnosis_sample]),
        "initialCandidates": initial_candidates,
        "candidates": candidates,
        "evidence": _evidence_items(
            run, diagnosis_sample, detector, scores.contributions[diagnosis_sample]
        ),
        "recommendation": recommendation_for_fault(candidates[0]["faultId"]),
        "modelVersion": model_version,
        "dataSourceDisclosure": DATA_DISCLOSURE,
    }
    event_path = _write_json(scenario_dir / "event-template.json", event)
    return [scenario_path, telemetry_path, event_path]


def _implementation_sha256() -> str:
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _runtime_summary() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "dependencies": {
            name: version(name) for name in ("joblib", "numpy", "pyarrow", "scikit-learn")
        },
    }


def _build_into(
    source_zip: Path,
    output_dir: Path,
    manifest_dir: Path,
    demo_faults: tuple[int, ...] = DEMO_FAULTS,
) -> BuildResult:
    source_zip = Path(source_zip)
    output_dir = Path(output_dir)
    manifest_dir = Path(manifest_dir)
    if tuple(demo_faults) != DEMO_FAULTS:
        missing = set(demo_faults) - set(_SCENARIOS)
        if missing:
            raise ValueError(f"scenario metadata missing for faults: {sorted(missing)}")

    source_hash = _sha256(source_zip)
    tracked_paths: list[Path] = []
    tracked_paths.append(
        _write_json(output_dir / "variable_dictionary.json", variable_dictionary())
    )

    loaded: dict[tuple[str, int], RunData] = {}
    for split in ("train", "test"):
        for fault_id in range(22):
            run = load_tep_run(source_zip, fault_id, split)
            loaded[(split, fault_id)] = run
            tracked_paths.append(
                _write_parquet(
                    output_dir / "bronze" / split / f"fault_{fault_id:02d}.parquet",
                    _run_columns(run, include_active_fault=split == "train"),
                )
            )

    detector = PCAFaultDetector(variance_ratio=0.95, threshold_quantile=0.99).fit(
        loaded[("train", 0)].values
    )
    classifier_runs = [loaded[("train", fault_id)] for fault_id in (0, *demo_faults)]
    standardized_runs = [_standardized_run(run, detector) for run in classifier_runs]
    training = make_windows(standardized_runs, window_size=20, stride=1)
    classifier = FaultClassifier(random_state=42).fit(training.values, training.labels)

    config = {
        "pipelineVersion": PIPELINE_VERSION,
        "sourceSha256": source_hash,
        "demoFaults": list(demo_faults),
        "windowSize": 20,
        "stride": 1,
        "sampleIntervalSeconds": 180,
        "pcaVarianceRatio": 0.95,
        "pcaThresholdQuantile": 0.99,
        "classifier": "HistGradientBoostingClassifier",
        "randomState": 42,
        "implementationSha256": _implementation_sha256(),
        "lockSha256": _sha256(Path(__file__).resolve().parents[1] / "uv.lock"),
        "runtime": _runtime_summary(),
    }
    model_version = "tep-pca-hgb-" + hashlib.sha256(_canonical_bytes(config)).hexdigest()[:12]
    models_dir = output_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    pca_path = models_dir / "pca_detector.joblib"
    classifier_path = models_dir / "fault_classifier.joblib"
    joblib.dump(detector, pca_path, compress=3, protocol=5)
    joblib.dump(classifier, classifier_path, compress=3, protocol=5)
    tracked_paths.extend([pca_path, classifier_path])
    model_manifest = {
        "modelVersion": model_version,
        "config": config,
        "detector": {
            "t2Threshold": detector.t2_threshold,
            "speThreshold": detector.spe_threshold,
            "retainedComponents": int(detector.pca.n_components_),
        },
        "classifier": {
            "classes": [int(value) for value in classifier.estimator.classes_],
        },
        "artifacts": [
            {"path": path.name, "sha256": _sha256(path), "sizeBytes": path.stat().st_size}
            for path in (pca_path, classifier_path)
        ],
    }
    tracked_paths.append(_write_json(models_dir / "model_manifest.json", model_manifest))

    for fault_id in demo_faults:
        tracked_paths.extend(
            _scenario_artifacts(
                output_dir,
                loaded[("test", fault_id)],
                detector,
                classifier,
                model_version,
            )
        )

    artifacts = [
        {
            "path": path.relative_to(output_dir).as_posix(),
            "sha256": _sha256(path),
            "sizeBytes": path.stat().st_size,
        }
        for path in sorted(tracked_paths)
    ]
    build_hash = hashlib.sha256(_canonical_bytes(artifacts)).hexdigest()
    manifest = {
        "schemaVersion": 1,
        "pipelineVersion": PIPELINE_VERSION,
        "source": {"filename": source_zip.name, "sha256": source_hash},
        "buildHash": build_hash,
        "modelVersion": model_version,
        "artifacts": artifacts,
    }
    manifest_path = _write_json(manifest_dir / "build_manifest.json", manifest)
    return BuildResult(build_hash, manifest_path, output_dir)


def _validate_staged_build(output_dir: Path, manifest_dir: Path) -> dict[str, Any]:
    manifest_path = manifest_dir / "build_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    artifacts = manifest["artifacts"]
    declared_paths = {artifact["path"] for artifact in artifacts}
    actual_paths = {
        path.relative_to(output_dir).as_posix() for path in output_dir.rglob("*") if path.is_file()
    }
    if actual_paths != declared_paths:
        raise ValueError("staged artifact set does not match manifest")
    for artifact in artifacts:
        path = output_dir / artifact["path"]
        if path.stat().st_size != artifact["sizeBytes"] or _sha256(path) != artifact["sha256"]:
            raise ValueError(f"staged artifact failed validation: {artifact['path']}")
    expected_hash = hashlib.sha256(_canonical_bytes(artifacts)).hexdigest()
    if manifest["buildHash"] != expected_hash:
        raise ValueError("staged build hash does not match manifest")
    for telemetry_path in output_dir.glob("scenarios/*/telemetry.parquet"):
        if "activeFaultId" in pq.read_schema(telemetry_path).names:
            raise ValueError(f"serving telemetry contains label column: {telemetry_path}")
    return manifest


def _directory_is_nonempty(path: Path) -> bool:
    if not path.exists():
        return False
    if not path.is_dir():
        raise FileExistsError(f"publish target is not a directory: {path}")
    return any(path.iterdir())


def _publish_staged_directories(
    staged_output: Path,
    staged_manifests: Path,
    output_dir: Path,
    manifest_dir: Path,
    staging_root: Path,
) -> None:
    backup_output = staging_root / "backup-processed"
    backup_manifests = staging_root / "backup-manifests"
    output_existed = output_dir.exists()
    manifests_existed = manifest_dir.exists()
    published_output = False
    published_manifests = False
    try:
        if output_existed:
            os.replace(output_dir, backup_output)
        if manifests_existed:
            os.replace(manifest_dir, backup_manifests)
        os.replace(staged_output, output_dir)
        published_output = True
        os.replace(staged_manifests, manifest_dir)
        published_manifests = True
    except Exception:
        if published_manifests and manifest_dir.exists():
            shutil.rmtree(manifest_dir)
        if published_output and output_dir.exists():
            shutil.rmtree(output_dir)
        if backup_output.exists():
            os.replace(backup_output, output_dir)
        if backup_manifests.exists():
            os.replace(backup_manifests, manifest_dir)
        raise
    if backup_output.exists():
        shutil.rmtree(backup_output)
    if backup_manifests.exists():
        shutil.rmtree(backup_manifests)


def build_demo(
    source_zip: Path,
    output_dir: Path,
    manifest_dir: Path,
    demo_faults: tuple[int, ...] = DEMO_FAULTS,
    force: bool = False,
) -> BuildResult:
    output_dir = Path(output_dir).resolve()
    manifest_dir = Path(manifest_dir).resolve()
    if not force and (_directory_is_nonempty(output_dir) or _directory_is_nonempty(manifest_dir)):
        raise FileExistsError("formal output directory is non-empty; pass --force to replace it")

    common_parent = Path(os.path.commonpath((output_dir.parent, manifest_dir.parent)))
    common_parent.mkdir(parents=True, exist_ok=True)
    staging_root = Path(tempfile.mkdtemp(prefix=".build-demo-", dir=common_parent))
    staged_output = staging_root / "processed"
    staged_manifests = staging_root / "manifests"
    try:
        _build_into(source_zip, staged_output, staged_manifests, demo_faults)
        manifest = _validate_staged_build(staged_output, staged_manifests)
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        manifest_dir.parent.mkdir(parents=True, exist_ok=True)
        _publish_staged_directories(
            staged_output,
            staged_manifests,
            output_dir,
            manifest_dir,
            staging_root,
        )
        return BuildResult(manifest["buildHash"], manifest_dir / "build_manifest.json", output_dir)
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)
