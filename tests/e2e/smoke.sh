#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:18090}"
CHECK_WEB="${CHECK_WEB:-1}"

command -v curl >/dev/null 2>&1 || { printf 'curl is required\n' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf 'jq is required\n' >&2; exit 1; }

request_id="smoke-$(date -u +%Y%m%d%H%M%S)-$$"
problem_file="/tmp/process-copilot-smoke-problem-$$.json"
cursor_file="/tmp/process-copilot-smoke-cursor-$$.json"
trap 'rm -f "$problem_file" "$cursor_file"' EXIT

curl -fsS "$BASE_URL/healthz" | jq -e '.status == "ok"' >/dev/null
curl -fsS "$BASE_URL/readyz" | jq -e '.status == "ok" and .checks.database == "available"' >/dev/null

if [[ "$CHECK_WEB" == "1" ]]; then
  curl -fsS "$BASE_URL/demo" | grep -q '<html'
fi

scenarios="$(curl -fsS "$BASE_URL/api/v1/scenarios")"
jq -e 'length == 3 and all(.[]; .sourceLabel == "Tennessee Eastman Process public simulation")' <<<"$scenarios" >/dev/null
scenario_id="$(jq -r '.[0].id' <<<"$scenarios")"

run_body="$(jq -nc --arg scenario_id "$scenario_id" '{scenarioId: $scenario_id, speed: 10}')"
run="$(curl -fsS -X POST "$BASE_URL/api/v1/runs" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $request_id-run" \
  --data "$run_body")"
run_id="$(jq -er '.id' <<<"$run")"

replayed_run="$(curl -fsS -X POST "$BASE_URL/api/v1/runs" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $request_id-run" \
  --data "$run_body")"
jq -e --arg run_id "$run_id" '.id == $run_id' <<<"$replayed_run" >/dev/null

mismatch_status="$(curl -sS -o "$problem_file" -w '%{http_code}' \
  -X POST "$BASE_URL/api/v1/runs" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $request_id-run" \
  --data "$(jq -nc --arg scenario_id "$scenario_id" '{scenarioId: $scenario_id, speed: 20}')")"
[[ "$mismatch_status" == "409" ]]
jq -e '.code == "idempotency_conflict" and (.traceId | length > 0)' "$problem_file" >/dev/null

event_id="$(curl -fsS "$BASE_URL/api/v1/runs/$run_id/events" | jq -er '.[0].id')"
event="$(curl -fsS "$BASE_URL/api/v1/events/$event_id")"
jq -e '
  .sampleIndex == .detectionSample
  and .diagnosisSample == (.detectionSample + 20)
  and .diagnosisDelaySamples == 20
  and .diagnosisState == "updated"
  and .anomalyLatched == true
  and (.initialCandidates | length) == 3
  and (.candidates | length) == 3
  and (.evidence | length) == 3
  and .recommendation.safetyBoundary == "Read-only advice. No automatic control write-back."
  and .dataSourceDisclosure == "Public simulation data, not real Guizhou plant data."
' <<<"$event" >/dev/null

decision_body='{"decision":"escalate","operatorName":"E2E Smoke","note":"Automated read-only demo chain verification."}'
record="$(curl -fsS -X POST "$BASE_URL/api/v1/events/$event_id/decision" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $request_id-decision" \
  --data "$decision_body")"
record_id="$(jq -er '.id' <<<"$record")"
curl -fsS "$BASE_URL/api/v1/records/$record_id" \
  | jq -e --arg event_id "$event_id" '.eventId == $event_id and .decision == "escalate" and (.traceId | length > 0)' >/dev/null

cursor_status="$(curl -sS -o "$cursor_file" -w '%{http_code}' \
  -H 'Last-Event-ID: invalid' "$BASE_URL/api/v1/runs/$run_id/stream")"
[[ "$cursor_status" == "400" ]]
jq -e '.code == "invalid_last_event_id"' "$cursor_file" >/dev/null
printf 'smoke passed: scenario=%s run=%s event=%s record=%s\n' "$scenario_id" "$run_id" "$event_id" "$record_id"
