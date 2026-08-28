import { CloudSlash, Database } from "@phosphor-icons/react/dist/ssr";

export function ModeNotice({ mode, notice }: { mode: "live" | "static-demo"; notice: string }) {
  const Icon = mode === "live" ? Database : CloudSlash;
  return (
    <div className={`mode-notice mode-${mode}`} role="status">
      <Icon aria-hidden="true" />
      <strong>{mode === "live" ? "API 在线" : "静态 Demo 降级"}</strong>
      <span>{notice}</span>
    </div>
  );
}
