from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def source_zip() -> Path:
    project_root = Path(__file__).resolve().parents[3]
    return (
        project_root.parent
        / "02_AI与贵州特色产业数据研究"
        / "04_原始数据与资料"
        / "先进制造_开源基准数据_2026-08-28"
        / "raw"
        / "Tennessee_Eastman_Process_Braatz.zip"
    )
