from __future__ import annotations

SAFETY_BOUNDARY = "Read-only advice. No automatic control write-back."

_FAULT_GUIDANCE = {
    1: {
        "risk": "Feed composition or A/C ratio may have shifted from its expected state.",
        "checks": [
            "Compare stream 4 composition analysis with the current operating target.",
            "Verify feed analyzer freshness and recent laboratory results.",
            "Review upstream feed changes with the field operator.",
        ],
    },
    6: {
        "risk": "A-feed availability may be reduced, affecting reactor material balance.",
        "checks": [
            "Verify A-feed flow indication and upstream supply status.",
            "Check related valve position and controller output for disagreement.",
            "Review reactor pressure and feed-rate trends with the shift engineer.",
        ],
    },
    13: {
        "risk": "A slow process-kinetics drift may be developing.",
        "checks": [
            "Compare reactor temperature and product composition against the recent baseline.",
            "Review raw-material lot, catalyst and laboratory quality context.",
            "Ask process engineering to assess the sustained drift before intervention.",
        ],
    },
}


def recommendation_for_fault(fault_id: int) -> dict[str, object]:
    guidance = _FAULT_GUIDANCE.get(
        fault_id,
        {
            "risk": "A multivariable process deviation requires operator review.",
            "checks": [
                "Review the three highest-contribution variables and their data freshness.",
                "Compare the deviation with current alarms and laboratory context.",
                "Escalate unresolved evidence to the shift engineer.",
            ],
        },
    )
    return {
        "mode": "template",
        "risk": guidance["risk"],
        "checks": guidance["checks"],
        "actions": [
            "Record the evidence and request human confirmation.",
            "Follow the site's approved operating procedure if escalation is confirmed.",
        ],
        "safetyBoundary": SAFETY_BOUNDARY,
    }
