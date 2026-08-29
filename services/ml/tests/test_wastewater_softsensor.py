from pathlib import Path

import numpy as np
import pytest
from process_copilot_ml.wastewater_softsensor import (
    ONLINE_FEATURE_COLUMNS,
    TARGET,
    WastewaterSoftSensor,
    load_wastewater_csv,
    prepare_next_cycle_data,
)


def frame():
    headers = (*ONLINE_FEATURE_COLUMNS, TARGET, "SS-S", "RD-DQO-G")
    values = np.array(
        [
            [
                100 + i,
                7 + i * 0.01,
                1200 + i,
                7.1 + i * 0.01,
                1150 + i,
                7.2 + i * 0.01,
                1100 + i,
                80 + i * 1.4,
                20 + i,
                75 + i * 0.1,
            ]
            for i in range(30)
        ],
        dtype=float,
    )
    return headers, values


def test_next_cycle_target_is_future_and_split_is_chronological():
    headers, values = frame()
    split = prepare_next_cycle_data(headers, values, test_fraction=0.2)
    target_index = headers.index(TARGET)
    assert split.train_target[0] == values[1, target_index]
    assert split.train_features[0, 0] == values[0, 0]
    assert split.train_features[-1, 0] < split.test_features[0, 0]
    assert TARGET not in split.feature_columns
    assert split.feature_columns == ONLINE_FEATURE_COLUMNS
    assert not any(column.endswith("-S") for column in split.feature_columns)
    assert not any(column.startswith("RD-") for column in split.feature_columns)


def test_prediction_is_repeatable_and_has_metrics():
    headers, values = frame()
    sensor = WastewaterSoftSensor().fit(prepare_next_cycle_data(headers, values))
    sample = values[0, : len(ONLINE_FEATURE_COLUMNS)]
    result_a = sensor.predict(sample)
    result_b = sensor.predict(sample)
    assert result_a == result_b
    assert result_a.status == "ok"
    assert result_a.holdout_mae is not None
    assert result_a.uncertainty_interval is not None
    assert result_a.risk_level in {"normal", "elevated", "high"}


@pytest.mark.parametrize(
    "bad",
    [
        np.ones((len(ONLINE_FEATURE_COLUMNS), 2)),
        {"Q-E": [1]},
        [1],
        [1, 2, 3, 4, 5, 6, np.nan],
        [1, 2, 3, 4, 5, 6, np.inf],
        {"Q-E": 1},
    ],
)
def test_invalid_input_is_unknown_and_not_high(bad):
    headers, values = frame()
    sensor = WastewaterSoftSensor().fit(prepare_next_cycle_data(headers, values))
    result = sensor.predict(bad)
    assert result.status == "unknown"
    assert result.risk_level == "unknown"


def test_csv_loader_reads_standard_asset(tmp_path):
    path = tmp_path / "water.csv"
    path.write_text(
        "class,Q-E,PH-E,COND-E,PH-P,COND-P,PH-D,COND-D,DQO-S\n"
        "Normal_situation,10,7,1200,7.1,1180,7.2,1160,100\n",
        encoding="utf-8",
    )
    headers, values = load_wastewater_csv(path)
    assert headers == (*ONLINE_FEATURE_COLUMNS, TARGET)
    assert values.shape == (1, 8)


def test_frozen_public_asset_loads_without_class_or_blank_rows():
    path = Path(__file__).parents[3] / "data/raw/wastewater/water-treatment.csv"
    headers, values = load_wastewater_csv(path)
    assert headers[0] == "Q-E"
    assert len(headers) == 38
    assert values.shape == (520, 38)
    split = prepare_next_cycle_data(headers, values)
    assert split.feature_columns == ONLINE_FEATURE_COLUMNS
