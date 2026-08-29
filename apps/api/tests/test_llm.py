from __future__ import annotations

import json
import logging

import httpx
import pytest
from process_copilot_api.llm import ExplanationEnhancer, LLMSettings


@pytest.fixture()
def event_summary() -> dict[str, object]:
    return {
        "eventId": "event-1",
        "sampleIndex": 120,
        "severity": "critical",
        "state": "open",
        "anomalyScore": 0.87,
        "diagnosisState": "provisional",
        "candidates": [
            {"faultId": 5, "label": "冷却水流量偏移", "probability": 0.72},
        ],
        "evidence": [
            {
                "variableId": "XMEAS(1)",
                "variableName": "进料流量",
                "unit": "%",
                "contribution": 0.91,
                "direction": "up",
                "summary": "偏离正常工况基线",
                "values": [0.32, 0.48, 0.67],
            },
            {
                "variableId": "XMV(1)",
                "variableName": "冷却水阀位",
                "unit": "%",
                "contribution": 0.61,
                "direction": "down",
                "summary": "执行器侧变化相反",
                "values": [0.74, 0.60, 0.45],
            },
        ],
        "recommendation": {
            "risk": "先确认过程变量与现场仪表状态",
            "checks": ["核对进料流量趋势"],
            "actions": ["按变量顺序人工检查"],
        },
        "faultOnsetSample": 999,
        "activeFaultId": 5,
        "untrustedProviderNote": "must not be forwarded",
    }


def settings(**overrides: object) -> LLMSettings:
    values: dict[str, object] = {
        "provider": "openai-compatible",
        "base_url": "https://llm.example/v1",
        "model": "demo-model",
        "api_key": "sk-test-secret",
        "timeout_seconds": 1.0,
        "max_tokens": 500,
        "temperature": 0.2,
        "fallback_policy": "template",
        "prompt_version": "event-copilot-v01",
    }
    values.update(overrides)
    return LLMSettings(**values)


def test_disabled_provider_returns_deterministic_template_without_http(
    event_summary: dict[str, object],
):
    def fail_request(request: httpx.Request) -> httpx.Response:
        raise AssertionError("disabled provider must not make an HTTP request")

    enhancer = ExplanationEnhancer(
        settings(provider="disabled"),
        transport=httpx.MockTransport(fail_request),
    )
    result = enhancer.enhance(event_summary, "先看哪三个变量？", trace_id="trace-disabled")

    assert result.mode == "template"
    assert result.model == "template-v0.1"
    assert result.trace_id == "trace-disabled"
    assert result.evidence_refs == ["XMEAS(1)", "XMV(1)"]
    assert "模板" in result.answer
    assert result.latency_ms >= 0


def test_success_accepts_only_explanation_fields_and_filters_unknown_refs(
    event_summary: dict[str, object],
):
    captured: dict[str, object] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "answer": "优先核对进料流量，再确认冷却水阀位。",
                                    "evidenceRefs": ["XMEAS(1)", "UNKNOWN"],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
        )

    enhancer = ExplanationEnhancer(settings(), transport=httpx.MockTransport(respond))
    result = enhancer.enhance(event_summary, "先看哪三个变量？", trace_id="trace-success")

    assert result.mode == "llm_enhanced"
    assert result.model == "demo-model"
    assert result.answer == "优先核对进料流量，再确认冷却水阀位。"
    assert result.evidence_refs == ["XMEAS(1)"]
    assert result.trace_id == "trace-success"
    assert result.latency_ms >= 0
    body = captured["body"]
    assert isinstance(body, dict)
    user_message = body["messages"][1]["content"]
    assert "untrustedProviderNote" not in user_message
    assert "faultOnsetSample" not in user_message
    assert "activeFaultId" not in user_message
    assert body["response_format"] == {"type": "json_object"}


def test_provider_request_uses_configured_temperature(
    event_summary: dict[str, object],
):
    captured: dict[str, object] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "answer": "优先核对进料流量。",
                                    "evidenceRefs": ["XMEAS(1)"],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
        )

    enhancer = ExplanationEnhancer(
        settings(temperature=0.35),
        transport=httpx.MockTransport(respond),
    )

    result = enhancer.enhance(event_summary, "先看哪个变量？")

    assert result.mode == "llm_enhanced"
    body = captured["body"]
    assert isinstance(body, dict)
    assert body["temperature"] == 0.35


@pytest.mark.parametrize(
    "response_factory",
    [
        lambda: httpx.Response(500, json={"error": "provider failed"}),
        lambda: httpx.Response(
            200,
            json={"choices": [{"message": {"content": "not-json"}}]},
        ),
    ],
    ids=["provider-5xx", "invalid-json"],
)
def test_provider_failures_return_template(
    event_summary: dict[str, object],
    response_factory,
):
    enhancer = ExplanationEnhancer(
        settings(),
        transport=httpx.MockTransport(lambda request: response_factory()),
    )

    result = enhancer.enhance(event_summary, "如何判断？", trace_id="trace-failure")

    assert result.mode == "template"
    assert result.model == "template-v0.1"
    assert result.trace_id == "trace-failure"
    assert "模板" in result.answer


def test_provider_timeout_returns_template(event_summary: dict[str, object]):
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("provider timed out", request=request)

    enhancer = ExplanationEnhancer(settings(), transport=httpx.MockTransport(timeout))
    result = enhancer.enhance(event_summary, "下一步做什么？", trace_id="trace-timeout")

    assert result.mode == "template"
    assert result.trace_id == "trace-timeout"


def test_degraded_fallback_policy_never_claims_template_answer(
    event_summary: dict[str, object],
):
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("provider timed out", request=request)

    enhancer = ExplanationEnhancer(
        settings(fallback_policy="degraded"),
        transport=httpx.MockTransport(timeout),
    )

    result = enhancer.enhance(event_summary, "下一步做什么？", trace_id="trace-degraded")

    assert result.mode == "degraded"
    assert result.model == "provider-unavailable"
    assert result.trace_id == "trace-degraded"
    assert "语言模型暂不可用" in result.answer
    assert "确定性模板" not in result.answer


def test_schema_overreach_and_control_output_are_rejected(
    event_summary: dict[str, object],
):
    responses = [
        {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "answer": "异常分数应改为 0.1。",
                                "evidenceRefs": ["XMEAS(1)"],
                                "anomalyScore": 0.1,
                            }
                        )
                    }
                }
            ]
        },
        {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "answer": "向 PLC 寄存器写入 1，并调用工具执行。",
                                "evidenceRefs": ["XMEAS(1)"],
                            }
                        )
                    }
                }
            ]
        },
    ]
    for payload in responses:
        enhancer = ExplanationEnhancer(
            settings(),
            transport=httpx.MockTransport(
                lambda request, payload=payload: httpx.Response(200, json=payload)
            ),
        )
        result = enhancer.enhance(event_summary, "请给出建议", trace_id="trace-safe")
        assert result.mode == "template"
        assert "PLC" not in result.answer
        assert "寄存器" not in result.answer


@pytest.mark.parametrize(
    "answer",
    [
        "三项证据共同偏移。当前仅提供只读建议，不向 PLC/DCS 写回，请由操作员核对趋势。",
        "这里只解释已有证据，不会向 DCS 下发命令，最终由现场人员确认。",
        "优先查看三项分析数据的趋势一致性和可信度，不涉及任何控制写回。",
        "Read-only advice; no automatic control write-back to PLC/DCS.",
    ],
)
def test_read_only_control_system_disclaimers_are_accepted(
    event_summary: dict[str, object],
    answer: str,
):
    payload = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "answer": answer,
                            "evidenceRefs": ["XMEAS(1)", "XMV(1)"],
                        },
                        ensure_ascii=False,
                    )
                }
            }
        ]
    }
    enhancer = ExplanationEnhancer(
        settings(),
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=payload)
        ),
    )

    result = enhancer.enhance(event_summary, "为什么这样判断？")

    assert result.mode == "llm_enhanced"
    assert result.answer == answer


@pytest.mark.parametrize(
    "answer",
    [
        "建议向 DCS 下发命令，将压力设定值调高 5%。",
        "请对 PLC 写回控制指令并立即执行。",
        "Open the coolant valve and increase the pressure setpoint.",
        "不向 PLC 写回；请把阀门打开。",
        "不向 PLC 写回；请将压力设定值调高 5%。",
        "不涉及任何控制写回；请把阀门打开。",
        "不涉及任何控制写回；请把阀门开启。",
        "不涉及任何控制写回；请将压力提升至 5%。",
        "不涉及任何控制写回；请将压\u2063力设定值调\u2063高 5%。",
        "不涉及任何控制写回；请调节压力。",
        "不涉及任何控制写回；请将阀门置于开启状态。",
        "不涉及任何控制写回；请启动冷却泵。",
        "不涉及任何控制写回；请将压\u034f力设定值调\u034f高 5%。",
        "不涉及任何控制写回；请将压力\n调高至 5%。",
        "不涉及任何控制写回；请将温度升至 80℃。",
        "不涉及任何控制写回；请把阀门调至 50%。",
        "不涉及任何控制写回；请将压力设成 5%。",
        "不涉及任何控制写回；请将压 力设定值调 高 5%。",
        "不涉及任何控制写回；请将压力在确认当前工况、相关趋势、报警记录、"
        "联锁状态、设备健康、报警抑制和人工复核结果之后再调高至 5%。",
        "不涉及任何控制写回；请重启电机。",
        "不涉及任何控制写回；请复位泵。",
        "不涉及任何控制写回；请升温至 80℃。",
        "不涉及任何控制写回；重启电机。",
        "不涉及任何控制写回；复位泵。",
        "不涉及任何控制写回；请切换手动模式。",
        "不涉及任何控制写回；请复位报警。",
        "不涉及任何控制写回；请开启继电器。",
        "不涉及任何控制写回；Please restart the motor.",
        "不涉及任何控制写回；Please reset the pump.",
        "不涉及任何控制写回；Please reboot the controller.",
        "不涉及任何控制写回；Please turn on the relay.",
        "不涉及任何控制写回；Please raise the pressure.",
        "不涉及任何控制写回；请暂停泵。",
        "不涉及任何控制写回；请合上断路器。",
        "不涉及任何控制写回；请投用继电器。",
        "不涉及任何控制写回；请向 P.L.C. 写入 1。",
        "不涉及任何控制写回；请向 \u0420LC 写入 1。",
        "不涉及任何控制写回；请向 P.L.C. 下发指令。",
        "不涉及任何控制写回；请向 P.L.C. 写值 1。",
        "不涉及任何控制写回；Please write to P.L.C.",
        "不涉及任何控制写回；Please send a command to P.L.C.",
        "不涉及任何控制写回；请将压力维持在 5%。",
        "不涉及任何控制写回；请保持温度为 80℃。",
        "把流量调整至 20%。",
        "请将设定值改为 10%。",
        "请将压\u200b力设定值调\u200b高 5%。",
    ],
)
def test_affirmative_control_instructions_remain_rejected(
    event_summary: dict[str, object],
    answer: str,
):
    payload = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {"answer": answer, "evidenceRefs": ["XMEAS(1)"]},
                        ensure_ascii=False,
                    )
                }
            }
        ]
    }
    enhancer = ExplanationEnhancer(
        settings(),
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=payload)
        ),
    )

    result = enhancer.enhance(event_summary, "请给出建议")

    assert result.mode == "template"
    assert result.model == "template-v0.1"


def test_api_key_never_enters_logs_on_provider_failure(
    event_summary: dict[str, object],
    caplog: pytest.LogCaptureFixture,
):
    secret = "sk-super-secret-never-log"

    def fail(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "unauthorized"})

    caplog.set_level(logging.WARNING)
    enhancer = ExplanationEnhancer(
        settings(api_key=secret),
        transport=httpx.MockTransport(fail),
    )
    enhancer.enhance(event_summary, "为什么？", trace_id="trace-secret")

    assert secret not in caplog.text


def test_settings_read_expected_environment_variables(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("LLM_BASE_URL", "https://provider.example/v1")
    monkeypatch.setenv("LLM_MODEL", "model-from-env")
    monkeypatch.setenv("LLM_API_KEY", "env-secret")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "8")
    monkeypatch.setenv("LLM_MAX_TOKENS", "500")
    monkeypatch.setenv("LLM_TEMPERATURE", "0.35")
    monkeypatch.setenv("LLM_FALLBACK_POLICY", "degraded")
    monkeypatch.setenv("LLM_PROMPT_VERSION", "event-copilot-v01")

    config = LLMSettings.from_env()

    assert config.provider == "openai-compatible"
    assert config.model == "model-from-env"
    assert config.timeout_seconds == 8.0
    assert config.max_tokens == 500
    assert config.temperature == 0.35
    assert config.fallback_policy == "degraded"
