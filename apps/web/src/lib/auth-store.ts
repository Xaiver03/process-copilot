"use client";

import { useEffect, useState } from "react";

export type OperatorRole = "operator" | "shift_lead" | "admin";

export interface AuthSession {
  token: string;
  username: string;
  role: OperatorRole;
  displayName: string;
  expiresAt: string;
}

export type AdminSession = AuthSession & { role: "admin" };
export type AnyAuthSession = AuthSession;

const STORAGE_KEY = "copilot-auth";
const CHANGE_EVENT = "copilot-auth-change";

export function isShiftLead(session: AnyAuthSession | null): boolean {
  return session?.role === "shift_lead";
}

export function isAdmin(session: AnyAuthSession | null): session is AdminSession {
  return session?.role === "admin";
}

function parseSession(raw: string | null): AnyAuthSession | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AnyAuthSession;
    if (!session.token || !session.username || !session.role) return null;
    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function readSession(): AnyAuthSession | null {
  if (typeof window === "undefined") return null;
  return parseSession(window.localStorage.getItem(STORAGE_KEY));
}

export function saveSession(session: AnyAuthSession): void {
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

export function useSession(): AnyAuthSession | null {
  const [session, setSession] = useState<AuthSession | null>(null);
  useEffect(() => {
    setSession(readSession() as AuthSession | null);
    return subscribeSession(() => setSession(readSession() as AuthSession | null));
  }, []);
  return session;
}

export function useAuthSession(): AnyAuthSession | null {
  const [session, setSession] = useState<AnyAuthSession | null>(null);
  useEffect(() => {
    setSession(readSession());
    return subscribeSession(() => setSession(readSession()));
  }, []);
  return session;
}
