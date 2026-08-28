import os
from pathlib import Path

import pytest

ARCHIVE_NAME = "Tennessee_Eastman_Process_Braatz.zip"


def resolve_source_zip(
    *,
    project_root: Path,
    home_directory: Path | None = None,
) -> Path:
    configured_path = os.getenv("TEP_SOURCE_ZIP")
    if configured_path:
        candidate = Path(configured_path).expanduser().resolve()
        if candidate.is_file():
            return candidate
        raise FileNotFoundError(
            "TEP_SOURCE_ZIP points to a missing Tennessee Eastman archive: "
            f"{candidate}"
        )

    home = home_directory or Path.home()
    candidates = (
        project_root.parent
        / "02_AI与贵州特色产业数据研究"
        / "04_原始数据与资料"
        / "先进制造_开源基准数据_2026-08-28"
        / "raw"
        / ARCHIVE_NAME,
        home
        / "Desktop"
        / "All in one Data"
        / "01_PROJECTS"
        / "FDE任务"
        / "03_产品与解决方案"
        / "02_AI与贵州特色产业数据研究"
        / "04_原始数据与资料"
        / "先进制造_开源基准数据_2026-08-28"
        / "raw"
        / ARCHIVE_NAME,
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()

    checked = "\n".join(f"- {candidate}" for candidate in candidates)
    raise FileNotFoundError(
        "Tennessee Eastman source archive was not found. "
        "Set TEP_SOURCE_ZIP to its absolute path. Checked:\n"
        f"{checked}"
    )


@pytest.fixture(scope="session")
def source_zip() -> Path:
    project_root = Path(__file__).resolve().parents[3]
    return resolve_source_zip(project_root=project_root)
