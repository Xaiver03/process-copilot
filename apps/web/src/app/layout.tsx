import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@process-copilot/ui/tokens.css";
import "./globals.css";
import { ShellProvider } from "@/components/shell-provider";

export const metadata: Metadata = {
  title: "序安 Process Sentinel | 连续化工过程偏移副驾驶",
  description: "基于田纳西-伊士曼过程（TEP）公开仿真数据的连续过程偏移研判 Demo。",
  icons: { icon: "/brand/process-sentinel-mark-v01.png", apple: "/brand/process-sentinel-mark-v01.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><ShellProvider>{children}</ShellProvider></body>
    </html>
  );
}
