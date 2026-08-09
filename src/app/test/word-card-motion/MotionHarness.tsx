"use client";

import { useCallback, useState } from "react";
import WordCard, {
  type WordCardMotionProbe,
} from "@/components/WordCard";

export default function MotionHarness({
  timelineLeadEnabled,
}: {
  timelineLeadEnabled: boolean;
}) {
  const [callbackCount, setCallbackCount] = useState(0);
  const [callbackDirection, setCallbackDirection] = useState("none");
  const [probe, setProbe] = useState<WordCardMotionProbe | null>(null);

  const recordCallback = useCallback((direction: "left" | "right") => {
    setCallbackCount((count) => count + 1);
    setCallbackDirection(direction);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 bg-[#F7F9FD] px-4 py-8 dark:bg-[#0B1120]">
      <div className="rounded-xl bg-white p-3 text-xs text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
        <div data-testid="callback-count">{callbackCount}</div>
        <div data-testid="callback-direction">{callbackDirection}</div>
        <pre data-testid="motion-probe" className="whitespace-pre-wrap">
          {probe ? JSON.stringify(probe) : "none"}
        </pre>
      </div>
      <WordCard
        word={{ term: "continuity", phonetic: "/ˌkɒntɪˈnjuːəti/" }}
        onSwipeLeft={() => recordCallback("left")}
        onSwipeRight={() => recordCallback("right")}
        onMotionProbe={setProbe}
        timelineLeadEnabled={timelineLeadEnabled}
      />
    </main>
  );
}
