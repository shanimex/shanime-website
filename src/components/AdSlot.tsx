import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Admin panelinden yönetilen reklam slotları (site_settings key'leri). */
export const AD_SLOTS = [
  { key: "ad_home", label: "Ana sayfa (tek banner)" },
  { key: "ad_detail_top", label: "Detay sayfası - üst" },
  { key: "ad_detail_bottom", label: "Detay sayfası - alt" },
  { key: "ad_watch_top", label: "İzleme sayfası - üst" },
  { key: "ad_watch_bottom", label: "İzleme sayfası - alt" },
  { key: "ad_preroll", label: "Video öncesi 5 sn (tek banner)" },
] as const;

export async function fetchAdCode(key: string): Promise<string> {
  const { data } = await db.from("site_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string) ?? "";
}

/**
 * Admin'in site_settings'e yapıştırdığı reklam kodunu (Adsterra banner vb.)
 * sayfaya enjekte eder. Kod boşsa hiçbir şey çizmez; popunder asla kullanılmaz.
 */
export function AdSlot({ slot, className }: { slot: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { data: code } = useQuery({
    queryKey: ["ad-slot", slot],
    queryFn: () => fetchAdCode(slot),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!code) return;
    const parsed = new DOMParser().parseFromString(code, "text/html");
    // <script> etiketleri innerHTML ile çalışmaz; elle yeniden oluşturulur.
    for (const old of Array.from(parsed.querySelectorAll("script"))) {
      const script = document.createElement("script");
      for (const attr of Array.from(old.attributes)) script.setAttribute(attr.name, attr.value);
      script.textContent = old.textContent ?? "";
      host.appendChild(script);
    }
    for (const node of Array.from(parsed.body.childNodes)) {
      if (node.nodeName === "SCRIPT") continue;
      host.appendChild(document.importNode(node, true));
    }
  }, [code]);

  if (!code) return null;
  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
