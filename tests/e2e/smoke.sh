#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:18090}"
CHECK_WEB="${CHECK_WEB:-1}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-5}"
CURL_MAX_TIME="${CURL_MAX_TIME:-30}"
E2E_USERNAME="${E2E_USERNAME:-shift-lead}"
E2E_PASSWORD="${E2E_PASSWORD:-demo-lead-2026}"
ADMIN_USERNAME="${ADMIN_USERNAME:-system-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-demo-admin-2026}"
CHECK_ONLINE_AI="${CHECK_ONLINE_AI:-1}"
curl_limits=(--connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME")

command -v curl >/dev/null 2>&1 || { printf 'curl is required\n' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf 'jq is required\n' >&2; exit 1; }

request_id="smoke-$(date -u +%Y%m%d%H%M%S)-$$"
problem_file="/tmp/process-copilot-smoke-problem-$$.json"
cursor_file="/tmp/process-copilot-smoke-cursor-$$.json"
trap 'rm -f "$problem_file" "$cursor_file"' EXIT

curl "${curl_limits[@]}" -fsS "$BASE_URL/healthz" | jq -e '.status == "ok"' >/dev/null
curl "${curl_limits[@]}" -fsS "$BASE_URL/readyz" | jq -e '.status == "ok" and .checks.database == "available"' >/dev/null

if [[ "$CHECK_WEB" == "1" ]]; then
  curl "${curl_limits[@]}" -fsS "$BASE_URL/demo" | grep -q '<html'
fi

scenarios="$(curl "${curl_limits[@]}" -fsS "$BASE_URL/api/v1/scenarios")"
jq -e 'length == 3 and all(.[]; .sourceLabel == "Tennessee Eastman Process public simulation")' <<<"$scenarios" >/dev/null
scenario_id="$(jq -r '.[0].id' <<<"$scenarios")"

run_body="$(jq -nc --arg scenario_id "$scenario_id" '{scenarioId: $scenario_id, speed: 10}')"
run="$(curl "${curl_limits[@]}" -fsS -X POST "$BASE_URL/api/v1/runs" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $request_id-run" \
  --data "$run_body")"
run_id="$(jq -er '.id' <<<"$run")"

replayed_run="$(curl "${curl_limits[@]}" -fsS -X POST "$BASE_URL/api/v1/runs" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $request_id-run" \
  --data "$run_body")"
jq -e --arg run_id "$run_id" '.id == $run_id' <<<"$replayed_run" >/dev/null

mismatch_status="$(curl "${curl_limits[@]}" -sS -o "$problem_file" -w '%{http_code}' \
  -X POST "$BASE_URL/api/v1/runs" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $request_id-run" \
  --data "$(jq -nc --arg scenario_id "$scenario_id" '{scenarioId: $scenario_id, speed: 20}')")"
[[ "$mismatch_status" == "409" ]]
jq -e '.code == "idempotency_conflict" and (.traceId | length > 0)' "$problem_file" >/dev/null

event_id="$(curl "${curl_limits[@]}" -fsS "$BASE_URL/api/v1/runs/$run_id/events" | jq -er '.[0].id')"
event="$(curl "${curl_limits[@]}" -fsS "$BASE_URL/api/v1/events/$event_id")"
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

login_body="$(jq -nc --arg username "$E2E_USERNAME" --arg password "$E2E_PASSWORD" \
  '{username: $username, password: $password}')"
auth_token="$(curl "${curl_limits[@]}" -fsS -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  --data "$login_body" | jq -er '.token')"

admin_login_body="$(jq -nc --arg username "$ADMIN_USERNAME" --arg password "$ADMIN_PASSWORD" \
  '{username: $username, password: $password}')"
admin_token="$(curl "${curl_limits[@]}" -fsS -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  --data "$admin_login_body" | jq -er 'select(.role == "admin") | .token')"
curl "${curl_limits[@]}" -fsS "$BASE_URL/api/v1/admin/overview" \
  -H "Authorization: Bearer $admin_token" \
  | jq -e '
      (.inferenceMode == "online" or .inferenceMode == "template")
      and (.worker.status | length > 0)
      and (.industrialModel.status | length > 0)
      and (.languageModel.status | length > 0)
      and (.dataBuildHash | length > 0)
    ' >/dev/null

decision_body='{"decision":"escalate","decisionMethod":"followed","note":"Automated read-only demo chain verification."}'
record="$(curl "${curl_limits[@]}" -fsS -X POST "$BASE_URL/api/v1/events/$event_id/decision" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $auth_token" \
  -H "Idempotency-Key: $request_id-decision" \
  --data "$decision_body")"
record_id="$(jq -er '.id' <<<"$record")"
curl "${curl_limits[@]}" -fsS "$BASE_URL/api/v1/records/$record_id" \
  | jq -e --arg event_id "$event_id" '
      .eventId == $event_id
      and .decision == "escalate"
      and .operatorRole == "shift_lead"
      and (.operatorName | length > 0)
      and (.traceId | length > 0)
    ' >/dev/null

cursor_status="$(curl "${curl_limits[@]}" -sS -o "$cursor_file" -w '%{http_code}' \
  -H 'Last-Event-ID: invalid' "$BASE_URL/api/v1/runs/$run_id/stream")"
[[ "$cursor_status" == "400" ]]
jq -e '.code == "invalid_last_event_id"' "$cursor_file" >/dev/null

online_run_id="disabled"
online_event_id="disabled"
if [[ "$CHECK_ONLINE_AI" == "1" ]]; then
  online_scenario="$(jq -c '[.[] | select(.id == "tep-f01-feed-ratio-step")][0] // .[0]' <<<"$scenarios")"
  online_scenario_id="$(jq -er '.id' <<<"$online_scenario")"
  online_fault_onset="$(jq -er '.faultOnsetSample' <<<"$online_scenario")"
  online_run_body="$(jq -nc --arg scenario_id "$online_scenario_id" \
    '{scenarioId: $scenario_id, speed: 20, inferenceMode: "online"}')"
  online_run="$(curl "${curl_limits[@]}" -fsS -X POST "$BASE_URL/api/v1/runs" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $request_id-online-run" \
    --data "$online_run_body")"
  online_run_id="$(jq -er 'select(.inferenceMode == "online") | select(.state == "ready") | .id' <<<"$online_run")"
  curl "${curl_limits[@]}" -fsS "$BASE_URL/api/v1/runs/$online_run_id/events" \
    | jq -e 'length == 0' >/dev/null
  curl "${curl_limits[@]}" -fsS -X POST "$BASE_URL/api/v1/runs/$online_run_id/control" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $request_id-online-play" \
    --data '{"action":"play","speed":20}' \
    | jq -e '.state == "playing" and .inferenceMode == "online"' >/dev/null

  online_event_id=""
  for _attempt in $(seq 1 50); do
    online_events="$(curl "${curl_limits[@]}" -fsS "$BASE_URL/api/v1/runs/$online_run_id/events")"
    online_event_id="$(jq -r --argjson onset "$online_fault_onset" \
      '[.[] | select(.state == "open" and .sampleIndex >= $onset)][0].id // empty' \
      <<<"$online_events")"
    [[ -n "$online_event_id" ]] && break
    sleep 2
  done
  [[ -n "$online_event_id" ]] || {
    printf 'online inference did not produce an active post-onset event in time\n' >&2
    exit 1
  }

  online_detail="$(curl "${curl_limits[@]}" -fsS "$BASE_URL/api/v1/events/$online_event_id")"
  jq -e '
      (.modelVersion | startswith("tep-pca-hgb-"))
      and (.evidence | length) == 3
      and (.candidates | length) >= 1
      and .recommendation.safetyBoundary == "Read-only advice. No automatic control write-back."
    ' <<<"$online_detail" >/dev/null
  ai_answer="$(curl "${curl_limits[@]}" -fsS -X POST "$BASE_URL/api/v1/events/$online_event_id/ask" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $auth_token" \
    --data '{"question":"请根据当前证据说明原因和优先检查顺序。"}')"
  jq -e '
      (.mode == "llm_enhanced" or .mode == "template" or .mode == "degraded")
      and (.answer | length > 0)
      and (.evidenceRefs | length) >= 1
      and (.traceId | length > 0)
    ' <<<"$ai_answer" >/dev/null
fi
printf 'smoke passed: scenario=%s run=%s event=%s record=%s online_run=%s online_event=%s\n' \
  "$scenario_id" "$run_id" "$event_id" "$record_id" "$online_run_id" "$online_event_id"
