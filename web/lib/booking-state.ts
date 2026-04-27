"use client";

/**
 * Persistent state for the mobile booking funnel (`/agendar/*`).
 *
 * The funnel is split across 4 URL-routed steps; the form state lives
 * in sessionStorage so:
 *   1. The browser back button feels like an app (each step is a real
 *      history entry).
 *   2. If the user accidentally closes the tab and comes back within
 *      ~30 minutes, they pick up exactly where they left off.
 *
 * Desktop still uses the old in-memory `<Funnel embedded />` on `/`.
 * Nothing here touches that flow — desktop, admin, teacher, student
 * and the LMS continue to read from their own state stores.
 */
import { useEffect, useState } from "react";

export type GermanLevel = "A0" | "A1-A2" | "B1" | "B2+";
export type Goal =
  | "work" | "visa" | "studies" | "exam" | "travel" | "already_in_dach";

export type BookingState = {
  // Step 1 — slot
  slot_iso:     string | null;
  teacher_id:   string | null;
  teacher_name: string | null;
  // Step 2 — contact
  name:         string;
  email:        string;
  // Step 3 — level
  german_level: GermanLevel | null;
  // Step 4 — goal + WhatsApp
  goal:         Goal | null;
  country_code: string;
  phone_local:  string;
  // Lifecycle
  savedAt:      number;     // ms epoch — used to expire stale state
};

const KEY  = "b2c.agendar.v1";
const TTL  = 30 * 60 * 1000;   // 30 minutes

const EMPTY: BookingState = {
  slot_iso:     null,
  teacher_id:   null,
  teacher_name: null,
  name:         "",
  email:        "",
  german_level: null,
  goal:         null,
  country_code: "+34",          // Spain default — most leads come from ES
  phone_local:  "",
  savedAt:      0,
};

function readFromStorage(): BookingState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as BookingState;
    if (typeof parsed?.savedAt !== "number") return EMPTY;
    if (Date.now() - parsed.savedAt > TTL) {
      window.sessionStorage.removeItem(KEY);
      return EMPTY;
    }
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;
  }
}

function writeToStorage(s: BookingState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...s, savedAt: Date.now() }),
    );
  } catch {
    /* quota exceeded / private mode — ignore, the funnel still works in-memory */
  }
}

/**
 * Reactive accessor. Returns the latest state + a setter that merges
 * partial updates and persists to sessionStorage.
 *
 * On mount we hydrate from storage in a useEffect, NOT in useState's
 * initialiser — keeps SSR happy and avoids the "first render is empty"
 * flash by guarding the consumer with `hydrated`.
 */
export function useBookingState() {
  const [state,    setState]    = useState<BookingState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readFromStorage());
    setHydrated(true);
  }, []);

  const update = (patch: Partial<BookingState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writeToStorage(next);
      return next;
    });
  };

  const reset = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(KEY);
    }
    setState(EMPTY);
  };

  return { state, update, reset, hydrated };
}
