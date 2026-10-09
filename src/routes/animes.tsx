/**
 * Animes sayfası (`/animes`) — 02.10.2026.
 *
 * Alt sekme çubuğundaki "Diziler" buraya gelir: aramalı tam ızgara.
 * Veri kaynağı ana sayfayla AYNI önbellektir (ek okuma yok).
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { SeriesCard } from "@/components/home/azList";
import {
  DISCOVERY_GRID_CAPPED,
  HEAD_GAP_ROW,
  HEAD_ROW,
  PAGE_CONTAINER,
} from "@/components/home/homeClass";
import { fetchShows } from "@/lib/content";
import { t as translate, useDocumentTitle, useLang } from "@/lib/i18n";
import { cachedRead, TTL_CATALOG_SECONDS } from "@/lib/server-cache";

export const Route = createFileRoute("/animes")({
  loader: () => cachedRead("public:catalog:shows", TTL_CATALOG_SECONDS, fetchShows),
  head: () => ({
    meta: [
      { title: `${translate("footer.allSeries")} | shanime` },
      { name: "description", content: translate("meta.animesDescription") },
      { property: "og:title", content: `${translate("footer.allSeries")} | shanime` },
      { property: "og:description", content: translate("meta.animesDescription") },
      { property: "og:url", content: "https://shanime.xyz/animes" },
    ],
    links: [{ rel: "canonical", href: "https://shanime.xyz/animes" }],
  }),
  component: Series,
});

function Series() {
  const { t } = useLang();
  useDocumentTitle(`${t("footer.allSeries")} | shanime`);
  const loadedShows = Route.useLoaderData();
  const dbShows = useMemo(() => loadedShows ?? [], [loadedShows]);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    if (!needle) return dbShows;
    return dbShows.filter((show) =>
      `${show.title} ${show.slug ?? ""}`.toLocaleLowerCase("tr").includes(needle),
    );
  }, [dbShows, query]);
  return (
    <div className={`${PAGE_CONTAINER} py-10`}>
      <div className={HEAD_GAP_ROW}>
        <h1 className={`${HEAD_ROW} page-title`}>{t("footer.allSeries")}</h1>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("common.searchPlaceholder")}
        aria-label={t("common.search")}
        className="mb-6 h-11 w-full rounded-lg border border-border bg-input px-4 text-base text-foreground placeholder:text-muted-foreground"
      />
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{t("home.noFilterMatch")}</p>
      ) : (
        <div className={DISCOVERY_GRID_CAPPED}>
          {filtered.map((show) => (
            <SeriesCard key={show.slug ?? show.title} show={show} />
          ))}
        </div>
      )}
    </div>
  );
}
