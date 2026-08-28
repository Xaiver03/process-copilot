import {
  ArrowClockwise,
  CloudSlash,
  Database,
  Eye,
  Info,
} from "@phosphor-icons/react/dist/ssr";

const states = {
  loading: {
    title: "正在读取过程数据",
    body: "正在保留图表坐标与面板尺寸，数据到达后不会产生布局跳动。",
    icon: Database,
  },
  error: {
    title: "数据读取失败",
    body: "已保留最后有效数据。请检查 API 状态后重试。",
    icon: ArrowClockwise,
  },
  empty: {
    title: "当前没有偏移事件",
    body: "调整时间范围，或继续回放以等待新的偏移信号。",
    icon: Info,
  },
  degraded: {
    title: "静态 Demo 降级",
    body: "API 当前不可用。页面使用明确标注的公开仿真静态数据，操作不会持久化。",
    icon: CloudSlash,
  },
  "read-only": {
    title: "当前 Demo 只读",
    body: "当前演示不连接控制网；生产版可经人工授权、权限校验与联锁校验后受控写回 PLC/DCS。",
    icon: Eye,
  },
} as const;

export function StatePanel({
  state,
  compact = false,
  detail,
  onRetry,
}: {
  state: keyof typeof states;
  compact?: boolean;
  detail?: string;
  onRetry?: () => void;
}) {
  const current = states[state];
  const Icon = current.icon;
  return (
    <section className={`state-panel state-${state}${compact ? " state-compact" : ""}`} role={state === "error" ? "alert" : "status"}>
      <Icon aria-hidden="true" />
      <div><strong>{current.title}</strong><p>{detail ?? current.body}</p>{onRetry ? <button className="text-link" type="button" onClick={onRetry}>重试</button> : null}</div>
    </section>
  );
}
