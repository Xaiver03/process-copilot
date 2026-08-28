"use client";

import { StatePanel } from "@/components/state-panel";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="page-stack"><StatePanel state="error" /><button className="secondary-button" type="button" onClick={reset}>重试当前页面</button></div>;
}
