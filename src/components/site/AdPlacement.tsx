import { useEffect, useState } from "react";
import { AdSlot, useAdCode } from "@/components/site/AdSlot";
import { AdsterraLeaderboard, AdsterraNative } from "@/components/site/AdsterraUnit";

/** Wait for panel settings before loading a fallback; omit desktop slots on phones. */
export function AdPlacement({
  slot,
  nativeOnDesktop = false,
  desktopOnly = false,
}: {
  slot: string;
  nativeOnDesktop?: boolean;
  desktopOnly?: boolean;
}) {
  const { code, isFetched } = useAdCode(slot);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    setDesktop(query.matches);
    const update = (event: MediaQueryListEvent) => setDesktop(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  if (!isFetched || (desktopOnly && !desktop)) return null;
  return (
    <div className="mx-auto w-full max-w-full overflow-hidden px-2 py-0.5 md:px-0 md:py-1">
      {code ? (
        <AdSlot slot={slot} className="flex justify-center" />
      ) : nativeOnDesktop && desktop ? (
        <AdsterraNative className="flex justify-center" />
      ) : (
        <AdsterraLeaderboard />
      )}
    </div>
  );
}
