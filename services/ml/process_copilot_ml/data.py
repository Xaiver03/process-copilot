from __future__ import annotations

from dataclasses import dataclass
from io import StringIO
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

import numpy as np
from numpy.typing import NDArray

FEATURE_COUNT = 52
TEST_FAULT_ONSET_SAMPLE = 160
ARCHIVE_PREFIX = "tennessee-eastman-profBraatz-master"


@dataclass(frozen=True)
class RunData:
    run_id: str
    fault_id: int
    split: str
    values: NDArray[np.float64]


@dataclass(frozen=True)
class WindowBatch:
    values: NDArray[np.float64]
    run_ids: NDArray[np.object_]
    end_indices: NDArray[np.int64]
    labels: NDArray[np.int64]


def validate_archive_members(archive: ZipFile) -> None:
    for member in archive.infolist():
        path = PurePosixPath(member.filename)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"unsafe archive member: {member.filename}")


def _validate_fault_id(fault_id: int) -> None:
    if not 0 <= fault_id <= 21:
        raise ValueError("fault_id must be between 0 and 21")


def active_fault_labels(fault_id: int, split: str, sample_count: int) -> NDArray[np.int64]:
    _validate_fault_id(fault_id)
    if split not in {"train", "test"}:
        raise ValueError("split must be 'train' or 'test'")
    labels = np.zeros(sample_count, dtype=np.int64)
    if fault_id == 0:
        return labels
    if split == "train":
        labels.fill(fault_id)
    else:
        labels[TEST_FAULT_ONSET_SAMPLE:] = fault_id
    return labels


def load_tep_run(zip_path: Path, fault_id: int, split: str) -> RunData:
    _validate_fault_id(fault_id)
    if split not in {"train", "test"}:
        raise ValueError("split must be 'train' or 'test'")
    suffix = "_te" if split == "test" else ""
    filename = f"d{fault_id:02d}{suffix}.dat"
    member = f"{ARCHIVE_PREFIX}/{filename}"
    with ZipFile(zip_path) as archive:
        validate_archive_members(archive)
        text = archive.read(member).decode("ascii")
    values = np.loadtxt(StringIO(text), dtype=np.float64)
    if fault_id == 0 and split == "train" and values.shape == (FEATURE_COUNT, 500):
        values = values.T
    expected_rows = 960 if split == "test" else (500 if fault_id == 0 else 480)
    if values.shape != (expected_rows, FEATURE_COUNT):
        raise ValueError(f"unexpected shape for {filename}: {values.shape}")
    return RunData(f"{split}-fault-{fault_id:02d}", fault_id, split, values)


def make_windows(runs: list[RunData], window_size: int = 20, stride: int = 1) -> WindowBatch:
    if window_size < 1 or stride < 1:
        raise ValueError("window_size and stride must be positive")
    windows: list[NDArray[np.float64]] = []
    run_ids: list[str] = []
    end_indices: list[int] = []
    labels: list[int] = []
    for run in runs:
        run_labels = active_fault_labels(run.fault_id, run.split, len(run.values))
        for start in range(0, len(run.values) - window_size + 1, stride):
            end = start + window_size
            windows.append(run.values[start:end])
            run_ids.append(run.run_id)
            end_indices.append(end - 1)
            labels.append(int(run_labels[end - 1]))
    if not windows:
        return WindowBatch(
            np.empty((0, window_size, FEATURE_COUNT), dtype=np.float64),
            np.empty(0, dtype=object),
            np.empty(0, dtype=np.int64),
            np.empty(0, dtype=np.int64),
        )
    return WindowBatch(
        np.stack(windows),
        np.asarray(run_ids, dtype=object),
        np.asarray(end_indices, dtype=np.int64),
        np.asarray(labels, dtype=np.int64),
    )
