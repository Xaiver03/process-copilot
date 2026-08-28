from process_copilot_api.schemas import (
    AIConfig,
    AskEventRequest,
    UpdateAIConfigRequest,
)


def test_ai_config_response_never_contains_provider_key() -> None:
    config = AIConfig(
        provider="openai-compatible",
        baseUrl="https://provider.example/v1",
        model="demo-model",
        enabled=True,
        timeoutMs=8000,
        maxTokens=500,
        temperature=0.2,
        promptVersion="event-copilot-v01",
        fallbackPolicy="template",
        apiKeyConfigured=True,
        version=2,
    )

    payload = config.model_dump(mode="json", by_alias=True)
    assert payload["apiKeyConfigured"] is True
    assert payload["version"] == 2
    assert "apiKey" not in payload


def test_update_config_tracks_omitted_key_and_expected_version() -> None:
    update = UpdateAIConfigRequest(model="new-model", expectedVersion=2)

    assert update.model_fields_set == {"model", "expected_version"}
    assert update.api_key is None
    assert update.clear_api_key is False


def test_event_question_has_bounded_nonempty_text() -> None:
    assert AskEventRequest(question="原因是什么？").question == "原因是什么？"
