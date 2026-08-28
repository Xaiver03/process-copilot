def test_api_runtime_imports_the_industrial_model_package() -> None:
    import process_copilot_ml

    assert process_copilot_ml.__package__ == "process_copilot_ml"
