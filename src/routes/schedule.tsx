/**
 * Takvim sayfası (`/schedule`) — 02.10.2026.
 *
 * Alt sekme çubuğundaki "Takvim" buraya gelir: haftalık yayın takvimi tam
 * genişlikte. Veri ve bileşen ana sayfayla AYNI (ek okuma yok).
 */
import { createFileRoute } from "@tanstack/react-router";

import { ScheduleSection } from "@/components/home/anilist";
import { HEAD_GAP_ROW, HEAD_ROW, PAGE_CONTAINER } from "@/components/home/homeClass";
import { fetchShows } from "@/lib/content";
import { t as translate, useDocumentTitle, useLang } from "@/lib/i18n";
import { cachedRead, TTL_CATALOG_SECONDS } from "@/lib/server-cache";

export const Route = createFileRoute("/schedule")({
  loader: () => cachedRead("public:catalog:shows", TTL_CATALOG_SECONDS, fetchShows),
  head: () => ({
    meta: [
      { title: `${translate("common.schedule")} | shanime` },
      { name: "description", content: translate("meta.scheduleDescription") },
      { property: "og:title", content: `${translate("common.schedule")} | shanime` },
      { property: "og:description", content: translate("meta.scheduleDescription") },
      { property: "og:url", content: "https://shanime.xyz/schedule" },
    ],
    links: [{ rel: "canonical", href: "https://shanime.xyz/schedule" }],
  }),
  component: Schedule,
});

function Schedule() {
  const { t } = useLang();
  useDocumentTitle(`${t("common.schedule")} | shanime`);
  const dbShows = Route.useLoaderData() ?? [];
  return (
    <div className={`${PAGE_CONTAINER} max-w-3xl py-10`}>
      <div className={HEAD_GAP_ROW}>
        <h1 className={`${HEAD_ROW} page-title`}>{t("common.schedule")}</h1>
      </div>
      <ScheduleSection shows={dbShows} />
    </div>
  );
}
