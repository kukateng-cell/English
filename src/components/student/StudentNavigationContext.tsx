"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type StudentStudyNavigationPhase =
  | "loading"
  | "assess"
  | "quiz"
  | "done"
  | "error"
  | "locked";

export interface StudentNavigationState {
  active: boolean;
  phase: StudentStudyNavigationPhase | null;
  navigationBlocked: boolean;
  dialogOpen: boolean;
}

type NavigationGuard = (href: string) => boolean;

interface StudentNavigationContextValue {
  state: StudentNavigationState;
  setStudyNavigationState: (
    next: Partial<StudentNavigationState>,
  ) => void;
  resetStudyNavigationState: () => void;
  registerNavigationGuard: (guard: NavigationGuard | null) => void;
  canNavigate: (href: string) => boolean;
}

const INITIAL_STATE: StudentNavigationState = {
  active: false,
  phase: null,
  navigationBlocked: false,
  dialogOpen: false,
};

const StudentNavigationContext =
  createContext<StudentNavigationContextValue | null>(null);

const FALLBACK_CONTEXT: StudentNavigationContextValue = {
  state: INITIAL_STATE,
  setStudyNavigationState: () => undefined,
  resetStudyNavigationState: () => undefined,
  registerNavigationGuard: () => undefined,
  canNavigate: () => true,
};

export function StudentNavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudentNavigationState>(INITIAL_STATE);
  const guardRef = useRef<NavigationGuard | null>(null);

  const setStudyNavigationState = useCallback(
    (next: Partial<StudentNavigationState>) => {
      setState((previous) => {
        const updated = { ...previous, ...next };
        return (
          Object.keys(updated).some(
            (key) =>
              updated[key as keyof StudentNavigationState] !==
              previous[key as keyof StudentNavigationState],
          )
            ? updated
            : previous
        );
      });
    },
    [],
  );

  const resetStudyNavigationState = useCallback(() => {
    guardRef.current = null;
    setState((previous) => {
      if (Object.keys(INITIAL_STATE).every(
        (key) =>
          INITIAL_STATE[key as keyof StudentNavigationState] ===
          previous[key as keyof StudentNavigationState],
      )) {
        return previous;
      }
      return INITIAL_STATE;
    });
  }, []);

  const registerNavigationGuard = useCallback(
    (guard: NavigationGuard | null) => {
      guardRef.current = guard;
    },
    [],
  );

  const canNavigate = useCallback(
    (href: string) => {
      if (state.dialogOpen) return false;
      if (guardRef.current) return guardRef.current(href);
      return !state.navigationBlocked;
    },
    [state.dialogOpen, state.navigationBlocked],
  );

  const value = useMemo<StudentNavigationContextValue>(
    () => ({
      state,
      setStudyNavigationState,
      resetStudyNavigationState,
      registerNavigationGuard,
      canNavigate,
    }),
    [
      canNavigate,
      registerNavigationGuard,
      resetStudyNavigationState,
      setStudyNavigationState,
      state,
    ],
  );

  return (
    <StudentNavigationContext.Provider value={value}>
      {children}
    </StudentNavigationContext.Provider>
  );
}

export function useStudentNavigation(): StudentNavigationContextValue {
  const context = useContext(StudentNavigationContext);
  return context ?? FALLBACK_CONTEXT;
}
