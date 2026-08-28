"use client";

import { useEffect, useState } from "react";

export type OperatorRole = "operator" | "shift_lead";

export interface AuthSession {
  token: string;
  username: string;
  role: OperatorRole;
  displayName: string;
  expiresAt: string;
}

const STORAGE_KEY = "copilot-auth";
const CHANGE_EVENT = "copilot-auth-change";

export function isShiftLead(session: AuthSession | null): boolean {
  return session?.role === "shift_lead";
}

function parseSession(raw: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AuthSession;
    if (!session.token || !session.username || !session.role) return null;
    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function readSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  return parseSession(window.localStorage.getItem(STORAGE_KEY));
}

export function saveSession(session: AuthSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeSession(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export const AUTH_STORAGE_KEY = STORAGE_KEY;

export function useSession(): AuthSession | null {
  const [session, setSession] = useState<AuthSession | null>(null);
  useEffect(() => {
    setSession(readSession());
    return subscribeSession(() => setSession(readSession()));
  }, []);
  return session;
}
