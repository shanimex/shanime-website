/**
 * Plasmic görsel düzenleyici bağlantısı (02.10.2026).
 *
 * KURAL: token KODA GÖMÜLMEZ — `.env` içinde durur
 * (`PLASMIC_PROJECT_ID`, `PLASMIC_PROJECT_TOKEN`). Koda gömülü token
 * tarayıcı paketine sızar; env'den okunursa sunucuda kalır.
 *
 * KULLANIM: Plasmic'te çizilen sayfa, bir rotada
 * `<PlasmicComponent component="SayfaAdi" />` ile çizilir (bkz. test rotası).
 * Mevcut sayfalar aynen durur; Plasmic yalnızca seçilen rotaları yönetir.
 */
import { initPlasmicLoader } from "@plasmicapp/loader-react";

import { PlasmicAnimeCard } from "@/components/home/PlasmicAnimeCard";

function env(name: string): string {
  if (typeof process !== "undefined" && process.env?.[name]) {
    return String(process.env[name]).trim();
  }
  const vite = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (vite?.[`VITE_${name}`] ?? "").trim();
}

export const PLASMIC = initPlasmicLoader({
  projects: [
    {
      id: env("PLASMIC_PROJECT_ID"),
      token: env("PLASMIC_PROJECT_TOKEN"),
    },
  ],
  preview: false,
});

/**
 * Studio kaydı: sol panelde "AnimeCard" olarak sürükle-bırakla gelir.
 *
 * NEDEN 4 DÜZ METİN (nesne değil): Studio'da her alan ayrı kutucuk olur —
 * başlık, kapak adresi, alt yazı, slug yazılır, kart anında önizlenir.
 * `slug` boşsa kart bağlantısız çizilir.
 */
PLASMIC.registerComponent(PlasmicAnimeCard, {
  name: "AnimeCard",
  props: {
    title: {
      type: "string",
      defaultValue: "Jujutsu Kaisen",
    },
    image: {
      type: "string",
      defaultValue: "/static/anime-data/jujutsu-kaisen/anime-cover.jpg",
    },
    subtitle: {
      type: "string",
      defaultValue: "Lanetler, büyücüler ve büyük bir hesaplaşma",
    },
    slug: {
      type: "string",
      defaultValue: "jujutsu-kaisen",
    },
  },
});
