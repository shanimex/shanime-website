import { db } from "@/lib/admin";
import { puffySlugFor, puffySlugForSeason } from "@/lib/puffy";

type Show = {
  id: string;
  slug: string;
  title: string;
  mal_id: number | null;
  animecix_id: number | null;
  kind: string | null;
};
type Episode = { id: string; show_id: string; season: number; number: number };
type Source = { episode_id: string; provider: string; url: string };

// Supabase caps responses at 1000 rows: source coverage and repair must read
// every page, otherwise already-present providers appear missing.
export async function allHealthRows(table: string, columns: string) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await db
      .from(table)
      .select(columns)
      .order("id")
      .range(offset, offset + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 1000) return rows;
  }
}

async function lookup(path: string, params: URLSearchParams) {
  let last = "Kaynak bulunamadı";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${path}?${params}`, { signal: AbortSignal.timeout(90000) });
      const data = await response.json();
      if (response.ok && data.ok) return data;
      last = data.reason ?? `HTTP ${response.status}`;
      if (response.ok && !data.temporary) break;
    } catch (error) {
      last = String(error);
    }
  }
  throw new Error(last);
}

export async function repairMissingSources(progress: (message: string) => void) {
  const [shows, episodes, sources] = (await Promise.all([
    allHealthRows("shows", "id,slug,title,mal_id,animecix_id,kind"),
    allHealthRows("show_episodes", "id,show_id,season,number"),
    allHealthRows("episode_sources", "id,episode_id,provider,url"),
  ])) as [Show[], Episode[], Source[]];
  const byShow = new Map(shows.map((show) => [show.id, show]));
  const present = new Set(
    sources
      .filter((row) => row.url?.trim())
      .map(
        (row) =>
          `${row.episode_id}:${/^(puffy|puffytr|anizmplayer)$/.test(row.provider) ? "anizm" : row.provider}`,
      ),
  );
  const providers = ["anizm", "animecix", "megaplay"];
  const jobs = episodes
    .filter((ep) => ep.number > 0)
    .flatMap((ep) => {
      const show = byShow.get(ep.show_id);
      // Animecix/TauVideo ve Anizm film kataloğu sunmuyor; film için yalnızca
      // MegaPlay beklenir. Aksi hâlde onarım her taramada aynı sahte eksik işi
      // yeniden üretir (ör. Jujutsu Kaisen 0).
      const expectedProviders = show?.kind === "movie" ? ["megaplay"] : providers;
      return expectedProviders
        .filter((provider) => !present.has(`${ep.id}:${provider}`))
        .map((provider) => ({ ep, provider }));
    });
  let added = 0;
  const failures: string[] = [];
  for (let index = 0; index < jobs.length; index++) {
    const { ep, provider } = jobs[index]!;
    const show = byShow.get(ep.show_id);
    const label =
      provider === "anizm" ? "Anizm / Puffy" : provider === "animecix" ? "TauVideo" : "MegaPlay";
    const key = `${show?.slug ?? ep.show_id} S${ep.season}B${ep.number} · ${label}`;
    progress(`${index + 1}/${jobs.length} · ${key} aranıyor · ${added} eklendi`);
    try {
      if (!show) throw new Error("Dizi kaydı bulunamadı");
      let url = "@megaplay";
      if (provider === "anizm") {
        const base = puffySlugFor(show.slug);
        const min = Math.min(
          ...episodes
            .filter(
              (item) => item.show_id === ep.show_id && item.season === ep.season && item.number > 0,
            )
            .map((item) => item.number),
        );
        const result = await lookup(
          "/api/anizm",
          new URLSearchParams({
            base,
            puffy: puffySlugForSeason(base, ep.season),
            season: String(ep.season),
            number: String(ep.number),
            min: String(min),
            show: show.slug,
            title: show.title,
            mal: String(show.mal_id ?? ""),
          }),
        );
        url = result.url;
        if (!/^https:\/\/anizmplayer\.com\/video\/[a-f0-9]{16,}$/i.test(url ?? ""))
          throw new Error("Geçerli Anizm adresi dönmedi");
      } else if (provider === "animecix") {
        if (!show.animecix_id) throw new Error("TauVideo dizi eşlemesi eksik");
        const result = await lookup(
          "/api/animecix",
          new URLSearchParams({
            titleId: String(show.animecix_id),
            season: String(ep.season),
            episode: String(ep.number),
          }),
        );
        url = result.best;
        if (!/^https:\/\/tau-video\.xyz\/embed\/[a-f0-9]{16,}/i.test(url ?? ""))
          throw new Error("Geçerli TauVideo adresi dönmedi");
      } else if (!show.mal_id) throw new Error("MegaPlay için MAL kimliği eksik");
      const write = await db.from("episode_sources").upsert(
        {
          episode_id: ep.id,
          provider,
          language: provider === "megaplay" ? "en" : "tr",
          label,
          url,
          sort_order: providers.indexOf(provider),
        },
        { onConflict: "episode_id,provider" },
      );
      if (write.error) throw write.error;
      added++;
    } catch (error) {
      failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { added, failures, total: jobs.length };
}
