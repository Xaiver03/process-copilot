from io import BytesIO
from zipfile import ZipFile

import numpy as np
import pytest
from conftest import resolve_source_zip
from process_copilot_ml.data import (
    RunData,
    active_fault_labels,
    load_tep_run,
    make_windows,
    validate_archive_members,
)


def test_source_zip_prefers_explicit_environment_path(tmp_path, monkeypatch) -> None:
    archive = tmp_path / "tep-source.zip"
    archive.write_bytes(b"fixture")
    monkeypatch.setenv("TEP_SOURCE_ZIP", str(archive))

    assert (
        resolve_source_zip(
            project_root=tmp_path / "worktree",
            home_directory=tmp_path / "home",
        )
        == archive
    )


def test_source_zip_missing_error_lists_checked_candidates(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("TEP_SOURCE_ZIP", raising=False)

    with pytest.raises(FileNotFoundError) as error:
        resolve_source_zip(
            project_root=tmp_path / "worktree",
            home_directory=tmp_path / "home",
        )

    message = str(error.value)
    assert "TEP_SOURCE_ZIP" in message
    assert "Tennessee_Eastman_Process_Braatz.zip" in message
    assert str(tmp_path / "home") in message


def test_safe_archive_rejects_parent_path() -> None:
    payload = BytesIO()
    with ZipFile(payload, "w") as archive:
        archive.writestr("../escape.dat", "unsafe")

    payload.seek(0)
    with ZipFile(payload) as archive, pytest.raises(ValueError, match="unsafe archive member"):
        validate_archive_members(archive)


def test_d00_training_is_transposed_to_500_by_52(source_zip) -> None:
    run = load_tep_run(source_zip, fault_id=0, split="train")

    assert run.values.shape == (500, 52)
    np.testing.assert_allclose(
        run.values[0, :3],
        np.array([0.24987, 3642.6, 4539.6]),
        rtol=1e-6,
    )


@pytest.mark.parametrize("fault_id", [1, 7, 21])
def test_fault_training_files_have_expected_shape(source_zip, fault_id: int) -> None:
    assert load_tep_run(source_zip, fault_id=fault_id, split="train").values.shape == (
        480,
        52,
    )


@pytest.mark.parametrize("fault_id", [0, 1, 21])
def test_test_files_have_expected_shape(source_zip, fault_id: int) -> None:
    assert load_tep_run(source_zip, fault_id=fault_id, split="test").values.shape == (
        960,
        52,
    )


def test_test_fault_labels_begin_at_zero_based_sample_160() -> None:
    labels = active_fault_labels(fault_id=6, split="test", sample_count=960)

    assert np.all(labels[:160] == 0)
    assert np.all(labels[160:] == 6)


def test_windows_never_cross_run_boundary() -> None:
    runs = [
        RunData("a", 0, "train", np.zeros((21, 52))),
        RunData("b", 1, "train", np.ones((21, 52))),
    ]

    windows = make_windows(runs, window_size=20, stride=1)

    assert windows.values.shape == (4, 20, 52)
    assert windows.run_ids.tolist() == ["a", "a", "b", "b"]
    assert np.all(windows.values[0] == 0)
    assert np.all(windows.values[-1] == 1)
