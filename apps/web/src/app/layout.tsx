import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@process-copilot/ui/tokens.css";
import "./globals.css";
import { ShellProvider } from "@/components/shell-provider";

export const metadata: Metadata = {
  title: "序安·磷煤化工异常早期预警平台",
  description: "基于 DCS 时序数据提前发现磷煤化工过程异常，给出原因证据和处置建议，并由人员确认闭环。",
  icons: { icon: "/favicon.ico", apple: "/icon.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><ShellProvider>{children}</ShellProvider></body>
    </html>
  );
}
