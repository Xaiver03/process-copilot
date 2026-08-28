import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@process-copilot/ui/tokens.css";
import "./globals.css";
import { ShellProvider } from "@/components/shell-provider";

export const metadata: Metadata = {
  title: "连续化工过程偏移副驾驶 | Wuno",
  description: "基于 Tennessee Eastman Process 公开仿真数据的只读过程偏移研判 Demo。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><ShellProvider>{children}</ShellProvider></body>
    </html>
  );
}
