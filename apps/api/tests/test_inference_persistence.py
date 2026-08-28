from datetime import UTC, datetime

from process_copilot_api.db import (
    AdminAuditRow,
    AIConfigurationRow,
    AIInteractionRow,
    Database,
    RunInferenceStateRow,
    RunStreamMessageRow,
)


def test_online_inference_state_stream_and_interaction_round_trip(tmp_path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'persistence.db'}")
    database.create_schema()
    now = datetime.now(UTC).replace(tzinfo=None)

    with database.session() as session:
        session.add(
            RunInferenceStateRow(
                run_id="11111111-1111-1111-1111-111111111111",
                mode="online",
                model_version="tep-pca-hgb-v01",
                worker_id="worker-01",
                heartbeat_at=now,
                failure_reason=None,
            )
        )
        session.add(
            RunStreamMessageRow(
                run_id="11111111-1111-1111-1111-111111111111",
                event_type="inference",
                sample_index=42,
                payload={"anomalyScore": 0.73},
                created_at=now,
            )
        )
        session.add(
            AIInteractionRow(
                id="22222222-2222-2222-2222-222222222222",
                event_id="33333333-3333-3333-3333-333333333333",
                operator="operator-01",
                question="原因是什么？",
                answer="优先检查冷却水回路。",
                evidence_refs=["XMEAS(21)"],
                mode="template",
                model="deterministic-template-v01",
                latency_ms=3,
                trace_id="trace-persistence",
                created_at=now,
            )
        )

    with database.session() as session:
        inference = session.get(
            RunInferenceStateRow,
            "11111111-1111-1111-1111-111111111111",
        )
        stream = session.query(RunStreamMessageRow).one()
        interaction = session.get(
            AIInteractionRow,
            "22222222-2222-2222-2222-222222222222",
        )

        assert inference is not None
        assert inference.mode == "online"
        assert stream.id == 1
        assert stream.payload == {"anomalyScore": 0.73}
        assert interaction is not None
        assert interaction.trace_id == "trace-persistence"
        assert interaction.evidence_refs == ["XMEAS(21)"]


def test_stream_message_ids_are_monotonic_sse_cursors(tmp_path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'cursor.db'}")
    database.create_schema()
    now = datetime.now(UTC).replace(tzinfo=None)

    with database.session() as session:
        for sample_index in (7, 8, 9):
            session.add(
                RunStreamMessageRow(
                    run_id="11111111-1111-1111-1111-111111111111",
                    event_type="inference",
                    sample_index=sample_index,
                    payload={"sampleIndex": sample_index},
                    created_at=now,
                )
            )

    with database.session() as session:
        rows = session.query(RunStreamMessageRow).order_by(RunStreamMessageRow.id).all()
        assert [row.id for row in rows] == [1, 2, 3]


def test_admin_configuration_and_audit_round_trip(tmp_path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'admin.db'}")
    database.create_schema()
    now = datetime.now(UTC).replace(tzinfo=None)

    with database.session() as session:
        session.add(
            AIConfigurationRow(
                id="default",
                enabled=True,
                provider="openai-compatible",
                base_url="https://provider.example/v1",
                model="demo-model",
                api_key_ciphertext="encrypted-only",
                timeout_seconds=8,
                max_tokens=500,
                temperature=0.2,
                prompt_version="event-copilot-v01",
                fallback_mode="template",
                version=1,
                updated_at=now,
            )
        )
        session.add(
            AdminAuditRow(
                id="44444444-4444-4444-4444-444444444444",
                actor="system-admin",
                action="ai_config_updated",
                resource_type="ai_configuration",
                resource_id="default",
                change_summary={"changedFields": ["model"], "apiKeyChanged": False},
                trace_id="trace-admin",
                request_id="request-admin",
                created_at=now,
            )
        )

    with database.session() as session:
        config = session.get(AIConfigurationRow, "default")
        audit = session.get(AdminAuditRow, "44444444-4444-4444-4444-444444444444")
        assert config is not None
        assert config.api_key_ciphertext == "encrypted-only"
        assert config.version == 1
        assert audit is not None
        assert audit.change_summary["changedFields"] == ["model"]
