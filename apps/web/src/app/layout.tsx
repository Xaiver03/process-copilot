import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@process-copilot/ui/tokens.css";
import "./globals.css";
import { ShellProvider } from "@/components/shell-provider";

export const metadata: Metadata = {
  title: "序安·DCS 智能预判平台",
  description: "基于 DCS 时序数据，提前预测工业过程风险，给出原因证据和处置建议，并由人确认闭环。",
  icons: { icon: "/brand/process-sentinel-mark-v01.png", apple: "/brand/process-sentinel-mark-v01.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><ShellProvider>{children}</ShellProvider></body>
    </html>
  );
}
