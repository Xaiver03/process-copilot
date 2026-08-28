export const productTokens = {
  processNormal: "var(--wuno-status-success)",
  processDrift: "var(--wuno-status-warning)",
  processAlarm: "var(--wuno-status-error)",
  dataLive: "var(--wuno-status-success)",
  dataDelayed: "var(--wuno-status-warning)",
  dataOffline: "var(--wuno-status-error)",
  evidenceSelected: "var(--wuno-primary-700)",
  evidenceBaseline: "var(--wuno-text-secondary)",
  controlReadOnly: "var(--wuno-primary-500)",
  controlHumanConfirmed: "var(--wuno-status-success)",
  chartGrid: "var(--wuno-border-subtle)",
  chartEventWindow: "color-mix(in srgb, var(--wuno-status-warning) 14%, transparent)",
} as const;
