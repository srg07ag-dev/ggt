"use client";

import { useEffect, useRef } from "react";
import type { ActionState } from "./action";

/** Vide le formulaire quand l'action réussit (création). */
export function useResetOnSuccess(state: ActionState, enabled = true) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (enabled && state?.ok) ref.current?.reset();
  }, [state, enabled]);
  return ref;
}
