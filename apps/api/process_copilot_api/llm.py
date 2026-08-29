"""Safe, optional OpenAI-compatible explanation enhancement for event summaries."""

from __future__ import annotations

import json
import logging
import os
import re
import time
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal
from uuid import uuid4

import httpx

from .ai_config import validate_provider_base_url

logger = logging.getLogger(__name__)

LLMMode = Literal["llm_enhanced", "template", "degraded"]
TEMPLATE_MODEL = "template-v0.1"
MAX_QUESTION_CHARS = 500
MAX_ANSWER_CHARS = 2_000

SYSTEM_PROMPT = """
You are an industrial process explanation assistant. Return one JSON object with exactly
these fields: answer (a concise narrative string) and evidenceRefs (an array of variable
IDs from the supplied event summary). Explain the supplied facts only. Do not alter or
invent anomaly scores, samples, severity, candidates, evidence, model versions, or plant
data. Do not provide PLC/DCS addresses, registers, control instructions, executable steps,
tool calls, or write-back commands. The system is read-only and a human operator makes
all decisions.
""".strip()

_ALLOWED_RESPONSE_KEYS = frozenset({"answer", "narrative", "evidenceRefs"})
_SAFE_READ_ONLY_BOUNDARY_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"(?:不|不会|不得|禁止|严禁|无需|无须)(?:直接)?(?:向|对)\s*"
        r"(?:plc|dcs|scada|modbus|opc[ -]?ua)"
        r"(?:\s*/\s*(?:plc|dcs|scada|modbus|opc[ -]?ua))*"
        r"(?:\s*系统)?\s*(?:执行)?"
        r"(?:写入|写回|下发(?:控制)?命令|发送(?:控制)?指令)",
        r"(?:do(?:es)? not|will not|never|no)\s+(?:automatic\s+)?"
        r"(?:control\s+)?(?:write[- ]?back|commands?)\s+(?:to|into)\s+"
        r"(?:the\s+)?(?:plc|dcs|scada|modbus|opc[ -]?ua)"
        r"(?:\s*/\s*(?:plc|dcs|scada|modbus|opc[ -]?ua))*",
        r"(?:不涉及|不包含|不提供)\s*(?:任何)?\s*(?:自动)?\s*(?:控制)?\s*"
        r"(?:写回|下发(?:控制)?命令|发送(?:控制)?指令)",
    )
)
_CONTROL_ACTIONS_ZH = (
    r"设(?:置|定|为|成)|置(?:于)?|修改|改(?:为)?|调(?:整|节|高|低|至|为)|"
    r"打开|关(?:闭)?|开(?:启)?|启(?:用|动)|停(?:用|止)|升(?:高|至)|提(?:升|高)|"
    r"降(?:低|至|温)|升温|重启|复位|上调|下调|增(?:加|大)|减(?:少|小)|"
    r"切换|暂停|恢复|保持|维持|合上|断开|投入|投用|退出|跳闸|"
    r"写(?:入|回|值)|赋值|下(?:发|达)|发送|传(?:送|输)|转发|发布|执行|控制|调控|激活"
)
_CONTROL_TARGETS_ZH = (
    r"阀门?|泵|压力|流量|温(?:度)?|液位|转速|功率|频率|电流|电压|扭矩|开度|"
    r"设定值|给定值|输出|加热|冷却|进料|出料|回流|搅拌|风机|压缩机|电机|"
    r"寄存器|模式|报警|继电器|开关|接触器|断路器|控制器|执行器"
)
_CONTROL_ACTIONS_EN = (
    r"set|write|change|adjust|open|close|increase|decrease|raise|lower|restart|"
    r"reboot|reset|switch|start|stop|enable|disable|execute|send|transmit|forward|relay|route|"
    r"issue|dispatch|"
    r"command|maintain|keep|hold|"
    r"turn\s+(?:on|off)|power\s+(?:on|off)"
)
_CONTROL_TARGETS_EN = (
    r"valve|pressure|flow|temperature|setpoint|output|motor|pump|relay|mode|alarm|"
    r"controller|actuator|heater|cooler|compressor|fan"
)
_UNSAFE_RESPONSE_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\b(?:plc|dcs|scada|modbus|opc[ -]?ua)\b",
        r"寄存器|点位地址|控制指令|调用工具|工具调用|写回|下发命令",
        r"\b(?:tool_calls?|function_call|execute|sudo|curl|ssh)\b",
        r"https?://|(?:\d{1,3}\.){3}\d{1,3}",
        r"(?:set|write|change|adjust|open|close|increase|decrease)\s+"
        r"(?:the\s+)?(?:valve|pressure|flow|temperature|setpoint|output)",
        r"(?:设置|调整|打开|关闭|开启|启用|启动|停用|停止|调高|调低|"
        r"升高|提升|上调|下调|增加|减少|增大|减小|写入|下发).{0,20}"
        r"(?:阀|压力|流量|温度|设定值|setpoint|寄存器)",
        r"(?:阀门?|压力|流量|温度|设定值|setpoint|寄存器).{0,24}"
        r"(?:设置|调整(?:至|为)?|打开|关闭|开启|启用|启动|停用|停止|"
        r"调高|调低|升高|提升|上调|下调|增加|减少|增大|减小|写入|下发|"
        r"执行|控制|改为|提高|降低|设为)",
        r"(?:valve|pressure|flow|temperature|setpoint|output).{0,24}"
        r"(?:set|write|change|adjust|open|close|increase|decrease)",
        rf"(?:{_CONTROL_ACTIONS_ZH}).{{0,32}}(?:{_CONTROL_TARGETS_ZH})",
        rf"(?:{_CONTROL_TARGETS_ZH}).{{0,32}}(?:{_CONTROL_ACTIONS_ZH})",
        r"(?:anomaly\s*score|异常分数|检测样本|严重等级|模型版本)"
        r".{0,30}(?:改为|修改|调整|覆盖|应为|should\s+be|set\s+to|change)",
    )
)


@dataclass(frozen=True, slots=True)
class LLMSettings:
    provider: str = "disabled"
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    timeout_seconds: float = 8.0
    max_tokens: int = 500
    temperature: float = 0.2
    fallback_policy: Literal["template", "degraded"] = "template"
    prompt_version: str = "event-copilot-v01"

    def __post_init__(self) -> None:
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if self.max_tokens < 1:
            raise ValueError("max_tokens must be positive")
        if not 0 <= self.temperature <= 2:
            raise ValueError("temperature must be between 0 and 2")
        if self.fallback_policy not in {"template", "degraded"}:
            raise ValueError("fallback_policy must be template or degraded")

    @classmethod
    def from_env(cls) -> LLMSettings:
        try:
            timeout_seconds = float(os.getenv("LLM_TIMEOUT_SECONDS", "8"))
        except ValueError:
            timeout_seconds = 8.0
        try:
            max_tokens = int(os.getenv("LLM_MAX_TOKENS", "500"))
        except ValueError:
            max_tokens = 500
        try:
            temperature = float(os.getenv("LLM_TEMPERATURE", "0.2"))
        except ValueError:
            temperature = 0.2
        fallback_policy = os.getenv("LLM_FALLBACK_POLICY", "template").strip().lower()
        if fallback_policy not in {"template", "degraded"}:
            fallback_policy = "template"
        return cls(
            provider=os.getenv("LLM_PROVIDER", "disabled").strip().lower(),
            base_url=os.getenv("LLM_BASE_URL", "").strip().rstrip("/"),
            model=os.getenv("LLM_MODEL", "").strip(),
            api_key=os.getenv("LLM_API_KEY", ""),
            timeout_seconds=timeout_seconds,
            max_tokens=max_tokens,
            temperature=temperature,
            fallback_policy=fallback_policy,
            prompt_version=os.getenv("LLM_PROMPT_VERSION", "event-copilot-v01").strip(),
        )


@dataclass(frozen=True, slots=True)
class ExplanationResult:
    answer: str
    mode: LLMMode
    model: str
    evidence_refs: list[str]
    latency_ms: int
    trace_id: str
    fallback_reason: str | None = None

    @property
    def narrative(self) -> str:
        return self.answer

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "mode": self.mode,
            "model": self.model,
            "evidenceRefs": list(self.evidence_refs),
            "latencyMs": self.latency_ms,
            "traceId": self.trace_id,
        }

    as_dict = to_dict


class ExplanationEnhancer:
    """Enhance a structured event summary, with a deterministic template fallback."""

    def __init__(
        self,
        settings: LLMSettings | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.settings = settings or LLMSettings.from_env()
        self._transport = transport

    def enhance(
        self,
        event_summary: Mapping[str, Any],
        question: str,
        *,
        trace_id: str | None = None,
    ) -> ExplanationResult:
        started = time.perf_counter()
        resolved_trace_id = trace_id or str(uuid4())
        safe_summary = _sanitize_event_summary(event_summary)
        if safe_summary is None:
            return self._fallback(started, resolved_trace_id, [], "invalid_event_summary")
        if not isinstance(question, str) or not 0 < len(question.strip()) <= MAX_QUESTION_CHARS:
            return self._fallback(
                started,
                resolved_trace_id,
                _evidence_refs(safe_summary),
                "invalid_question",
            )

        refs = _evidence_refs(safe_summary)
        if self.settings.provider != "openai-compatible":
            return self._fallback(started, resolved_trace_id, refs, "provider_disabled")
        if not self.settings.base_url or not self.settings.model or not self.settings.api_key:
            return self._fallback(started, resolved_trace_id, refs, "provider_not_configured")

        try:
            provider_payload = self._request(safe_summary, question.strip())
            parsed = _parse_provider_result(provider_payload, refs)
            if parsed is None:
                return self._fallback(started, resolved_trace_id, refs, "invalid_provider_schema")
            answer, evidence_refs = parsed
            return ExplanationResult(
                answer=answer,
                mode="llm_enhanced",
                model=self.settings.model,
                evidence_refs=evidence_refs,
                latency_ms=_latency_ms(started),
                trace_id=resolved_trace_id,
            )
        except Exception as exc:
            # Never log the URL, request, response, exception text, or headers: any may
            # contain credentials supplied by a provider or an operator configuration.
            logger.warning("LLM provider call failed: %s", type(exc).__name__)
            return self._fallback(started, resolved_trace_id, refs, type(exc).__name__)

    def explain(
        self,
        event_summary: Mapping[str, Any],
        question: str,
        *,
        trace_id: str | None = None,
    ) -> ExplanationResult:
        return self.enhance(event_summary, question, trace_id=trace_id)

    def _request(self, event_summary: dict[str, Any], question: str) -> Any:
        base_url = validate_provider_base_url(self.settings.base_url, enabled=True)
        request_payload = {
            "model": self.settings.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {"eventSummary": event_summary, "question": question},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                },
            ],
            "temperature": self.settings.temperature,
            "max_tokens": self.settings.max_tokens,
            "response_format": {"type": "json_object"},
        }
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        headers["Authorization"] = f"Bearer {self.settings.api_key}"
        with httpx.Client(
            transport=self._transport,
            timeout=self.settings.timeout_seconds,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json=request_payload,
            )
        if not 200 <= response.status_code < 300:
            raise RuntimeError(f"provider_status_{response.status_code}")
        return response.json()

    def _fallback(
        self,
        started: float,
        trace_id: str,
        refs: list[str],
        reason: str,
    ) -> ExplanationResult:
        if self.settings.fallback_policy == "degraded":
            return ExplanationResult(
                answer=(
                    "语言模型暂不可用，当前不生成替代研判。请直接核对已登记证据与现场仪表，"
                    "并由操作员独立决定下一步；系统保持只读。"
                ),
                mode="degraded",
                model="provider-unavailable",
                evidence_refs=refs,
                latency_ms=_latency_ms(started),
                trace_id=trace_id,
                fallback_reason=reason,
            )
        reference_text = "、".join(refs[:3]) or "已登记证据"
        return ExplanationResult(
            answer=(
                f"当前使用确定性模板模式。请先核对 {reference_text} 的趋势与现场仪表状态，"
                "再由操作员确认；本回答仅作只读解释。"
            ),
            mode="template",
            model=TEMPLATE_MODEL,
            evidence_refs=refs,
            latency_ms=_latency_ms(started),
            trace_id=trace_id,
            fallback_reason=reason,
        )


def _latency_ms(started: float) -> int:
    return max(0, round((time.perf_counter() - started) * 1000))


def _value(mapping: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _sanitize_event_summary(summary: Mapping[str, Any]) -> dict[str, Any] | None:
    if not isinstance(summary, Mapping):
        return None
    result: dict[str, Any] = {}
    scalar_keys = (
        ("eventId", "event_id"),
        ("sampleIndex", "sample_index"),
        ("severity",),
        ("state",),
        ("anomalyScore", "anomaly_score"),
        ("diagnosisState", "diagnosis_state"),
        ("diagnosisAnomalyScore", "diagnosis_anomaly_score"),
        ("modelVersion", "model_version"),
        ("dataSourceDisclosure", "data_source_disclosure"),
    )
    for aliases in scalar_keys:
        value = _value(summary, *aliases)
        if isinstance(value, (str, int, float, bool)):
            result[aliases[0]] = value

    candidates = _value(summary, "candidates", "initialCandidates", "initial_candidates")
    if isinstance(candidates, list):
        result["candidates"] = [
            {
                "label": candidate.get("label"),
                "probability": candidate.get("probability"),
            }
            for candidate in candidates[:3]
            if isinstance(candidate, Mapping)
            and isinstance(candidate.get("label"), str)
            and isinstance(candidate.get("probability"), (int, float))
        ]

    evidence = _value(summary, "evidence")
    if isinstance(evidence, list):
        result["evidence"] = []
        for item in evidence[:3]:
            if not isinstance(item, Mapping):
                continue
            variable_id = _value(item, "variableId", "variable_id")
            if not isinstance(variable_id, str) or not variable_id.strip():
                continue
            safe_item: dict[str, Any] = {"variableId": variable_id.strip()}
            for aliases in (
                ("variableName", "variable_name"),
                ("unit",),
                ("contribution",),
                ("direction",),
                ("summary",),
            ):
                value = _value(item, *aliases)
                if isinstance(value, (str, int, float, bool)):
                    safe_item[aliases[0]] = value
            values = _value(item, "values")
            if isinstance(values, list):
                safe_item["values"] = [
                    value for value in values[:8] if isinstance(value, (int, float))
                ]
            result["evidence"].append(safe_item)

    recommendation = _value(summary, "recommendation")
    if isinstance(recommendation, Mapping):
        safe_recommendation: dict[str, Any] = {}
        for key in ("risk", "checks", "actions"):
            value = recommendation.get(key)
            if isinstance(value, str):
                safe_recommendation[key] = value
            elif isinstance(value, list):
                safe_recommendation[key] = [item for item in value[:5] if isinstance(item, str)]
        if safe_recommendation:
            result["recommendation"] = safe_recommendation
    return result


def _evidence_refs(event_summary: Mapping[str, Any]) -> list[str]:
    evidence = event_summary.get("evidence")
    if not isinstance(evidence, list):
        return []
    refs: list[str] = []
    for item in evidence:
        if not isinstance(item, Mapping):
            continue
        variable_id = item.get("variableId")
        if isinstance(variable_id, str) and variable_id not in refs:
            refs.append(variable_id)
    return refs


def _parse_provider_result(payload: Any, allowed_refs: list[str]) -> tuple[str, list[str]] | None:
    if isinstance(payload, Mapping) and "choices" in payload:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        first = choices[0]
        if not isinstance(first, Mapping):
            return None
        message = first.get("message")
        if not isinstance(message, Mapping):
            return None
        content = message.get("content")
    else:
        content = payload
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError:
            return None
    if not isinstance(content, Mapping):
        return None
    if set(content) - _ALLOWED_RESPONSE_KEYS:
        return None
    answer = content.get("answer", content.get("narrative"))
    refs = content.get("evidenceRefs")
    if not isinstance(answer, str) or not answer.strip() or len(answer) > MAX_ANSWER_CHARS:
        return None
    if not isinstance(refs, list) or _unsafe_answer(answer):
        return None
    filtered_refs: list[str] = []
    for ref in refs:
        if isinstance(ref, str) and ref in allowed_refs and ref not in filtered_refs:
            filtered_refs.append(ref)
    return answer.strip(), filtered_refs


def _unsafe_answer(answer: str) -> bool:
    # Providers commonly restate the read-only boundary in otherwise valid answers.
    # Remove only explicit negative control-system phrases before applying the strict
    # deny-list; affirmative instructions and every other PLC/DCS mention remain blocked.
    text_to_check = unicodedata.normalize("NFKC", answer)
    text_to_check = text_to_check.translate(
        str.maketrans(
            {
                "Р": "P",
                "р": "p",
                "Ρ": "P",
                "ρ": "p",
                "С": "C",
                "с": "c",
                "О": "O",
                "о": "o",
                "Ο": "O",
                "ο": "o",
                "М": "M",
                "м": "m",
                "Μ": "M",
                "μ": "m",
            }
        )
    )
    text_to_check = "".join(
        character
        for character in text_to_check
        if unicodedata.category(character) != "Cf"
        and not unicodedata.category(character).startswith("M")
    )
    text_to_check = re.sub(r"\s+", " ", text_to_check)
    for safe_pattern in _SAFE_READ_ONLY_BOUNDARY_PATTERNS:
        text_to_check = safe_pattern.sub("", text_to_check)
    compact_text = re.sub(r"[\W_]+", "", text_to_check, flags=re.UNICODE)
    if re.search(
        r"写(?:入|回|值)|赋值|下(?:发|达)(?:控制)?(?:命令|指令)?|"
        r"发送(?:控制)?(?:命令|指令)",
        compact_text,
    ):
        return True
    lowercase_text = text_to_check.lower()
    protocols = ("plc", "dcs", "scada", "modbus", "opcua")
    if any(protocol in compact_text.lower() for protocol in protocols):
        if re.search(r"命令|指令|控制量", compact_text):
            return True
        if re.search(_CONTROL_ACTIONS_ZH, compact_text) or re.search(
            rf"\b(?:{_CONTROL_ACTIONS_EN})\b", lowercase_text
        ):
            return True
    if re.search(_CONTROL_ACTIONS_ZH, compact_text) and re.search(
        _CONTROL_TARGETS_ZH, compact_text
    ):
        return True
    if re.search(rf"\b(?:{_CONTROL_ACTIONS_EN})\b", lowercase_text) and re.search(
        rf"\b(?:{_CONTROL_TARGETS_EN})\b", lowercase_text
    ):
        return True
    return any(pattern.search(text_to_check) for pattern in _UNSAFE_RESPONSE_PATTERNS)
