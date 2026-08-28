"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "./app-shell";

export function ShellProvider({ children }: { children: ReactNode }) {
  return <AppShell currentPath={usePathname()}>{children}</AppShell>;
}
