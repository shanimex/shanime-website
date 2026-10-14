import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Sparkles, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/admin-toast";
import { confirmAction } from "@/lib/admin-confirm";
import { allHealthRows, repairMissingSources } from "@/lib/repair-missing-sources";
import {
  anizipCover,
  anizipCoverForSeason,
  anizipCoverFromChain,
  resolveSeasonMalId,
} from "@/lib/anizip-covers";
import {
  discoverFranchise,
  fetchCatalogEpisodes,
  isPlaceholderTitle,
  type RelatedRecord,
} from "@/lib/admin-anizip";
import { repairFranchiseCatalog } from "@/lib/admin-bulk-catalog";
import { db, fillShowMetadataFromMal } from "@/lib/admin";
import { hasEpisodeCover } from "@/lib/content";
import {
  findBrokenUrls,
  findMissingSeasons,
  findMissingMetadata,
  findInvalidSources,
  findFranchiseIssues,
  type BrokenEpisodeUrl,
  type FranchiseHealthRow,
  type MissingEpisodeSourceRow,
  type MissingSeasonRow,
  type MetadataHealthRow,
  type InvalidSourceRow,
} from "@/lib/content-health";

/** Bozuk adres düzeltilirken yazılan değer (sağlayıcı direktifi). */
const FIX_URL = "@megaplay";
const MAX_VISIBLE_ISSUES = 100;
type SourceCoverageItem = {
  label: string;
  count: number;
  expected: number;
  /** Sağlayıcı kapsamı bilgi amaçlıdır; tek oynatıcı kaynağı zorunlu değildir. */
  optional?: boolean | undefined;
};

/**
 * "Veri sağlığı" — bozuk içerik kayıtlarını bulur ve **tek tıkla düzeltir**.
 *
 * NEDEN PANELDE: bu düzeltmeler daha önce elle SQL ile yapılıyordu, çünkü
 * sunucu tarafındaki anon anahtar RLS'e takılıp yazamıyor
 * (`POST show_seasons` → `42501`). Panel oturum sahibiyle çalıştığı için yazma
 * yetkisi burada var; kullanıcı tek yerde çözebilsin istendi.
 *
 * Bulduğu iki sorun (ikisi de sahada gerçekten görüldü):
 *   1. **Bozuk `watch_url`** → oynatıcı hiç yüklenmez (ör. sitede JJK S1B1'de
 *      `https://allorigins.winhttps//anizmplayer.com/...` kalmıştı).
 *   2. **Sezon kaydı eksik** → sitenin panelinde "0 sezon · N bölüm" görünür.
 */
export function DataHealthPanel({
  onNotice,
  onOpenShow,
  onRepairSources,
  genreOptions = [],
}: {
  onNotice: (message: string) => void;
  onOpenShow?: (showId: string) => void;
  onRepairSources?: (showId: string) => void;
  /**
   * Panelde hâlihazırda kullanılan tür listesi. "AniList'ten doldur" türü
   * yazarken aynı türün ikinci bir yazımını doğurmasın diye `mapGenres`e geçirilir.
   */
  genreOptions?: string[];
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** "AniList'ten doldur" işlemi sürerken o dizinin kimliği. */
  const [metaBusy, setMetaBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brokenUrls, setBrokenUrls] = useState<BrokenEpisodeUrl[]>([]);
  const [missingSeasons, setMissingSeasons] = useState<MissingSeasonRow[]>([]);
  const [missingMetadata, setMissingMetadata] = useState<MetadataHealthRow[]>([]);
  /**
   * Dizi kimliği → MAL kimliği. "AniList'ten doldur" bu eşleme olmadan
   * çalışamaz: hangi kaydın çekileceğini yalnızca MAL kimliği söyler.
   */
  const [malIdByShow, setMalIdByShow] = useState<Record<string, number>>({});
  const [invalidSources, setInvalidSources] = useState<InvalidSourceRow[]>([]);
  const [missingEpisodeCovers, setMissingEpisodeCovers] = useState<MissingEpisodeSourceRow[]>([]);
  const [franchiseIssues, setFranchiseIssues] = useState<FranchiseHealthRow[]>([]);
  const [healthShows, setHealthShows] = useState<
    Array<{
      id: string;
      title: string | null;
      image_path: string | null;
      sort_order: number;
      mal_id: number | null;
      kind: string | null;
      media_format?: string | null;
    }>
  >([]);
  const [sourceCoverage, setSourceCoverage] = useState<SourceCoverageItem[]>([]);
  const [repairStatus, setRepairStatus] = useState("");
  const [repairFailures, setRepairFailures] = useState<string[]>([]);
  async function runSourceRepair() {
    setBusy(true);
    setRepairFailures([]);
    setRepairStatus("Üç sağlayıcıdaki eksik kayıtlar hazırlanıyor…");
    try {
      const result = await repairMissingSources(setRepairStatus);
      await load();
      setRepairFailures(result.failures);
      setRepairStatus(
        `${result.total} kaynak işlemi tamamlandı: ${result.added} eklendi, ${result.failures.length} bulunamadı/başarısız. MegaPlay kayıtları oynatıcı direktifidir.`,
      );
      if (result.failures.length || !result.added)
        toast.error(`${result.added} kaynak eklendi; ${result.failures.length} çözülemedi.`);
      else onNotice(`${result.added} kaynak eklendi.`);
    } catch (error) {
      setRepairStatus(`İşlem başarısız: ${String(error)}`);
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function readHealthShows() {
    // Opsiyonel franchise alanları bazı eski Supabase ortamlarında henüz yok.
    // Önce onları isteyip bilerek 400 üretmek yerine temel sağlık kolonlarını
    // doğrudan oku; alanlar tipte opsiyonel olduğu için sonraki kontroller
    // migration uygulanmış/uygulanmamış iki ortamda da çalışır.
    return db
      .from("shows")
      .select("id,slug,title,subtitle,description,year,genre,image_path,sort_order,mal_id,kind");
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Eski onarım sonucu yeni taramaya sızmasın. Onarım akışı kendi özetini
    // tarama tamamlandıktan sonra tekrar yazar.
    setRepairStatus("");
    setRepairFailures([]);
    try {
      const [shows, seasons, episodes, sources] = await Promise.all([
        readHealthShows(),
        db.from("show_seasons").select("show_id,number,mal_id"),
        db
          .from("show_episodes")
          .select("id,show_id,season,number,title,summary,duration,watch_url,thumbnail_path"),
        allHealthRows("episode_sources", "id,episode_id,language,provider,url").then((data) => ({
          data,
          error: null,
        })),
      ]);
      if (shows.error) throw shows.error;
      if (seasons.error) throw seasons.error;
      if (episodes.error) throw episodes.error;
      if (sources.error) throw sources.error;

      const showRows = (shows.data ?? []) as {
        id: string;
        slug: string;
        title?: string | null;
        kind: string | null;
        franchise_root_id?: string | null;
        media_format?: string | null;
      }[];
      const seasonRows = (seasons.data ?? []) as {
        show_id: string;
        number: number;
        mal_id: number | null;
      }[];
      const episodeRows = (episodes.data ?? []) as {
        id: string;
        show_id: string;
        season: number;
        number: number;
        watch_url: string | null;
      }[];
      const sourceRows = (sources.data ?? []) as {
        episode_id: string;
        language: string | null;
        provider: string;
        url: string | null;
      }[];

      // 0 numaralı özel/önizleme bölümleri normal bölüm kapsamına dahil edilmez.
      const normalEpisodeIds = new Set(
        episodeRows.filter((episode) => episode.number > 0).map((episode) => episode.id),
      );
      const showKindById = new Map(
        showRows.map((show) => [show.id, String(show.kind ?? "series").toLowerCase()]),
      );
      const nonMovieEpisodeIds = new Set(
        episodeRows
          .filter((episode) => episode.number > 0 && showKindById.get(episode.show_id) !== "movie")
          .map((episode) => episode.id),
      );
      // Bir bölümün çalışması için tek bir sağlayıcıya bağlı değiliz. Özellikle
      // Anizm/PuffyTR bazı bölümleri hiç barındırmayabilir; TauVideo veya
      // MegaPlay kaydı varsa bölüm yine oynatılabilir durumdadır.
      const sourceReadyIds = new Set(
        sourceRows
          .filter((row) => {
            const provider = String(row.provider ?? "").trim();
            const url = String(row.url ?? "").trim();
            return provider && (url.startsWith("@") || /^https?:\/\//i.test(url));
          })
          .map((row) => row.episode_id),
      );
      const playableEpisodeIds = new Set(
        episodeRows
          .filter(
            (episode) =>
              episode.number > 0 &&
              (String(episode.watch_url ?? "").trim() || sourceReadyIds.has(episode.id)),
          )
          .map((episode) => episode.id),
      );
      const coverageGroups = [
        {
          label: "Anizm · yedek",
          ids: new Set(["anizm", "puffy", "puffytr", "anizmplayer"]),
          expected: nonMovieEpisodeIds,
          optional: true,
        },
        {
          label: "TauVideo",
          ids: new Set(["animecix", "tauvideo"]),
          expected: nonMovieEpisodeIds,
        },
        { label: "MegaPlay", ids: new Set(["megaplay"]), expected: normalEpisodeIds },
      ];
      setSourceCoverage([
        {
          label: "Oynatılabilir",
          count: playableEpisodeIds.size,
          expected: normalEpisodeIds.size,
        },
        ...coverageGroups.map(({ label, ids, expected, optional }) => ({
          label,
          optional,
          expected: expected.size,
          count: new Set(
            sourceRows
              .filter(
                (row) =>
                  ids.has(
                    String(row.provider ?? "")
                      .trim()
                      .toLowerCase(),
                  ) &&
                  normalEpisodeIds.has(row.episode_id) &&
                  expected.has(row.episode_id),
              )
              .map((row) => row.episode_id),
          ).size,
        })),
      ]);

      setBrokenUrls(findBrokenUrls(showRows, episodeRows));
      setMissingSeasons(findMissingSeasons(showRows, seasonRows, episodeRows));
      const richShows = (shows.data ?? []) as Array<{
        id: string;
        slug: string;
        title: string | null;
        subtitle: string | null;
        description: string | null;
        year: string | null;
        genre: string | null;
        image_path: string | null;
        sort_order: number;
        mal_id: number | null;
        kind: string | null;
        franchise_root_id?: string | null;
        media_format?: string | null;
      }>;
      setHealthShows(richShows);
      const malIdMap: Record<string, number> = {};
      for (const show of richShows) {
        if (typeof show.mal_id === "number" && show.mal_id > 0) malIdMap[show.id] = show.mal_id;
      }
      setMalIdByShow(malIdMap);
      const richEpisodes = (episodes.data ?? []) as Array<{
        id: string;
        show_id: string;
        season: number;
        number: number;
        title: string | null;
        summary: string | null;
        duration: string | null;
        watch_url: string | null;
        thumbnail_path: string | null;
      }>;
      setMissingMetadata(findMissingMetadata(richShows, richEpisodes));
      setFranchiseIssues(findFranchiseIssues(richShows, episodeRows));
      setInvalidSources(findInvalidSources(showRows, episodeRows, sourceRows));
      const showSlugs = new Map(richShows.map((show) => [show.id, show.slug]));
      const seasonMalIds = new Map(
        seasonRows.map((season) => [`${season.show_id}:${season.number}`, season.mal_id]),
      );
      const showMalIds = new Map(richShows.map((show) => [show.id, show.mal_id]));
      const catalogCache = new Map<number, Awaited<ReturnType<typeof fetchCatalogEpisodes>>>();
      const missingCovers: MissingEpisodeSourceRow[] = [];
      for (const episode of richEpisodes) {
        if (episode.number <= 0 || String(episode.thumbnail_path ?? "").trim()) continue;
        const slug = showSlugs.get(episode.show_id);
        if (slug && hasEpisodeCover(slug, episode.season, episode.number)) continue;
        const showMalId = showMalIds.get(episode.show_id) ?? null;
        const seasonMalId = resolveSeasonMalId(
          showMalId,
          episode.season,
          seasonMalIds.get(`${episode.show_id}:${episode.season}`),
        );
        let cover =
          anizipCoverForSeason(seasonMalId, episode.season, episode.number) ||
          anizipCover(showMalId, episode.season, episode.number) ||
          anizipCoverFromChain(showMalId, episode.season, episode.number, seasonMalId);
        // Baked tabloda olmayan yeni/film kayıtları için AniZip kataloğunu da
        // doğrudan kontrol et. Böylece kapak paneli yalnızca build zamanında
        // gelen dosyalara bağlı kalmaz; yeni anime eklendiğinde kendini bulur.
        if (!cover && showMalId) {
          try {
            let catalog = catalogCache.get(showMalId);
            if (!catalog) {
              catalog = await fetchCatalogEpisodes(showMalId);
              catalogCache.set(showMalId, catalog);
            }
            cover =
              catalog.find(
                (item) => item.season === episode.season && item.number === episode.number,
              )?.image ?? "";
          } catch {
            // AniZip geçici olarak kapalıysa kayıt eksik olarak kalır; sonraki
            // taramada tekrar denenir ve panel bunu açıkça gösterir.
          }
        }
        // Filmlerde tek bölümün görseli çoğu katalogda film posteri olarak
        // tutulur; bölüm bazlı TVDB görseli gelmese bile mevcut film kapağını
        // yedek olarak kaydet. Sezon arasına yerleştirilen OVA/ONA/Special
        // kayıtlarında da bölüm görseli katalogda yoksa dizi kapağı güvenli bir
        // yedektir; normal bölümlerde bu fallback'i kullanmayız.
        if (!cover) {
          const show = richShows.find((item) => item.id === episode.show_id);
          const isSpecialEpisode =
            !Number.isInteger(Number(episode.number)) ||
            /\b(?:OVA|ONA|SPECIAL)\b/i.test(String(episode.title ?? ""));
          if (
            (show?.kind === "movie" || isSpecialEpisode) &&
            String(show?.image_path ?? "").trim()
          ) {
            cover = show?.image_path?.trim() ?? "";
          }
        }
        if (cover) {
          const { error: coverError } = await db
            .from("show_episodes")
            .update({ thumbnail_path: cover })
            .eq("id", episode.id)
            .is("thumbnail_path", null);
          if (!coverError) continue;
        }
        missingCovers.push({
          showId: episode.show_id,
          slug: slug ?? "(bilinmeyen dizi)",
          season: episode.season,
          number: episode.number,
        });
      }
      setMissingEpisodeCovers(missingCovers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Tek kaydı düzeltir. `quiet=true` iken başarı bildirimi GÖSTERİLMEZ: "hepsini
   * düzelt" akışında her satır için ayrı bildirim çıkmasın, tek özet yetsin
   * (hata varsa yine gösterilir — sessizce yutulmaz).
   */
  async function fixUrl(item: BrokenEpisodeUrl, quiet = false): Promise<boolean> {
    const { error: writeError } = await db
      .from("show_episodes")
      .update({ watch_url: FIX_URL })
      .eq("show_id", item.showId)
      .eq("season", item.season)
      .eq("number", item.number);
    if (writeError) {
      toast.error(
        `Düzeltilemedi (${item.slug} S${item.season}B${item.number}): ${writeError.message}`,
      );
      return false;
    }
    if (!quiet) {
      onNotice(`${item.slug} S${item.season}B${item.number} adresi ${FIX_URL} olarak düzeltildi.`);
    }
    return true;
  }

  /** Sezon kaydı oluşturur (bkz. `fixUrl` — `quiet` aynı işi görür). */
  async function fixSeason(item: MissingSeasonRow, quiet = false): Promise<boolean> {
    const { error: writeError } = await db.from("show_seasons").insert({
      show_id: item.showId,
      number: item.number,
      title: `${item.number}. Sezon`,
      sort_order: item.number,
    });
    if (writeError) {
      toast.error(
        `Sezon kaydı oluşturulamadı (${item.slug} S${item.number}): ${writeError.message}`,
      );
      return false;
    }
    if (!quiet) onNotice(`${item.slug} için ${item.number}. Sezon kaydı oluşturuldu.`);
    return true;
  }

  /**
   * Eski importların yazdığı "1. Sezon Episode 7 · Anime" gibi jenerik adları
   * yalnız gerçekten katalogda karşılığı varsa düzeltir. Katalog boşsa yeni bir
   * isim uydurulmaz; kayıt aşağıdaki sağlık raporunda başarısız olarak kalır.
   */
  async function repairEpisodeTitles(quiet = false) {
    const issues = missingMetadata.filter((item) => item.scope === "episode");
    if (issues.length === 0) return { updated: 0, failed: 0 };

    const [episodesResult, seasonsResult] = await Promise.all([
      db.from("show_episodes").select("id,show_id,season,number,title"),
      db.from("show_seasons").select("show_id,number,mal_id"),
    ]);
    if (episodesResult.error) throw episodesResult.error;
    let seasonRows = (seasonsResult.data ?? []) as {
      show_id: string;
      number: number;
      mal_id?: number | null;
    }[];
    if (seasonsResult.error && /mal_id/i.test(seasonsResult.error.message ?? "")) {
      const fallback = await db.from("show_seasons").select("show_id,number");
      if (fallback.error) throw fallback.error;
      seasonRows = (fallback.data ?? []) as { show_id: string; number: number }[];
    } else if (seasonsResult.error) {
      throw seasonsResult.error;
    }

    const byEpisode = new Map(
      (
        (episodesResult.data ?? []) as Array<{
          id: string;
          show_id: string;
          season: number;
          number: number;
          title: string | null;
        }>
      ).map((episode) => [`${episode.show_id}:${episode.season}:${episode.number}`, episode]),
    );
    const byShow = new Map(healthShows.map((show) => [show.id, show]));
    const malBySeason = new Map(
      seasonRows.map((season) => [
        `${season.show_id}:${season.number}`,
        Number(season.mal_id ?? 0),
      ]),
    );
    const catalogCache = new Map<number, Awaited<ReturnType<typeof fetchCatalogEpisodes>>>();
    let updated = 0;
    let failed = 0;

    for (const issue of issues) {
      const episode = byEpisode.get(`${issue.showId}:${issue.season}:${issue.number}`);
      if (!episode || !isPlaceholderTitle(episode.title)) continue;
      const show = byShow.get(issue.showId);
      const malId = malBySeason.get(`${issue.showId}:${issue.season}`) || Number(show?.mal_id ?? 0);
      if (!malId) {
        failed += 1;
        continue;
      }
      try {
        let catalog = catalogCache.get(malId);
        if (!catalog) {
          catalog = await fetchCatalogEpisodes(malId);
          catalogCache.set(malId, catalog);
        }
        let match = catalog.find(
          (item) => item.season === issue.season && item.number === issue.number,
        );
        if (!match) {
          const seasons = [
            ...new Set(catalog.filter((item) => item.season > 0).map((item) => item.season)),
          ];
          if (seasons.length === 1) {
            match = catalog.find(
              (item) => item.season === seasons[0] && item.number === issue.number,
            );
          }
        }
        if (!match?.title?.trim()) {
          failed += 1;
          continue;
        }
        const { error: writeError } = await db
          .from("show_episodes")
          .update({ title: match.title.trim() })
          .eq("id", episode.id);
        if (writeError) throw writeError;
        updated += 1;
      } catch {
        failed += 1;
      }
    }

    if (!quiet && updated > 0) onNotice(`${updated} bölüm adı katalogdan düzeltildi.`);
    return { updated, failed };
  }

  async function fixAll() {
    if (fixableTotal === 0) {
      toast.info("Otomatik düzeltilecek kayıt yok; ayrıntılı sorunları aşağıdaki listeden aç.");
      return;
    }
    const ok = await confirmAction({
      title: `${fixableTotal} kayıt düzeltinsin mi?`,
      description:
        "Bozuk adresler varsayılan kaynağa çevrilir, eksik sezonlar açılır, jenerik bölüm adları katalogdan yenilenir ve eksik sağlayıcı kaynakları tekrar denenir. Bu işlem geri alınamaz.",
      confirmLabel: "Hepsini düzelt",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      let done = 0;
      let failed = 0;
      for (const item of [...brokenUrls]) {
        if (await fixUrl(item, true)) done += 1;
        else failed += 1;
      }
      for (const item of [...missingSeasons]) {
        if (await fixSeason(item, true)) done += 1;
        else failed += 1;
      }
      const titleResult = await repairEpisodeTitles(true);
      done += titleResult.updated;
      failed += titleResult.failed;

      let sourceResult: Awaited<ReturnType<typeof repairMissingSources>> | null = null;
      if (sourceGapCount > 0) {
        setRepairFailures([]);
        setRepairStatus("Eksik sağlayıcı kaynakları yeniden deneniyor…");
        sourceResult = await repairMissingSources(setRepairStatus);
        setRepairFailures(sourceResult.failures);
        done += sourceResult.added;
        failed += sourceResult.failures.length;
        setRepairStatus(
          `${sourceResult.total} kaynak işlemi tamamlandı: ${sourceResult.added} eklendi, ${sourceResult.failures.length} bulunamadı/başarısız.`,
        );
      }
      await load();
      onNotice(
        failed === 0
          ? `${done} kayıt düzeltildi.`
          : `${done} kayıt düzeltildi, ${failed} başarısız (nedenleri panelde görünüyor).`,
      );
    } catch (error) {
      toast.error(
        `Toplu düzeltme yarıda kaldı: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  /** Eski ayrı OVA/ONA/Special kartlarını onaylı biçimde kök diziye toparlar. */
  async function repairFranchiseFamilies() {
    const rootIds = [...new Set(franchiseIssues.map((issue) => issue.rootId))];
    if (rootIds.length === 0) return;
    const ok = await confirmAction({
      title: `${rootIds.length} anime ailesi düzeltinsin mi?`,
      description:
        "Ayrı açılmış OVA/ONA/Special kayıtları ait oldukları ana sezonlara AnimeciX sırasıyla yerleştirilir. Katalogu boş olan eski kartlar temizlenir; filmler ayrı kalır. Bu işlem geri alınamaz.",
      confirmLabel: "Aileleri düzelt",
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    setRepairFailures([]);
    let repaired = 0;
    let removed = 0;
    const problems: string[] = [];
    try {
      for (const rootId of rootIds) {
        const root = healthShows.find((show) => show.id === rootId);
        if (!root || !root.mal_id) {
          problems.push(`${root?.title ?? rootId}: kök MAL kimliği yok`);
          continue;
        }
        setRepairStatus(`${root.title ?? rootId} ailesi düzeltiliyor…`);
        const rootRecord: RelatedRecord = {
          malId: root.mal_id,
          title: root.title?.trim() || rootId,
          english: root.title?.trim() || rootId,
          year: null,
          episodes: null,
          format: root.media_format || (root.kind === "movie" ? "MOVIE" : "TV"),
          relationType: "ROOT",
        };
        const discovery = await discoverFranchise(rootRecord);
        const report = await repairFranchiseCatalog({
          showId: root.id,
          rootMalId: root.mal_id,
          rootTitle: rootRecord.title,
          rootImagePath: root.image_path ?? "",
          rootSortOrder: root.sort_order,
          discovery,
          legacyExtraShowIds: franchiseIssues
            .filter((issue) => issue.rootId === root.id)
            .map((issue) => issue.showId),
        });
        repaired += 1;
        removed += report.removedExtraShows;
        problems.push(...report.skipped.slice(0, 4), ...report.warnings);
      }
      await load();
      setRepairStatus(
        `${repaired} aile düzeltildi; ${removed} eski ek içerik kaydı temizlendi.` +
          (problems.length ? ` ${problems.length} uyarı var.` : ""),
      );
      if (problems.length) {
        setRepairFailures(problems);
        toast.error(`${repaired} aile düzeltildi; ${problems.length} uyarı/atlama var.`);
      } else {
        onNotice(
          `${repaired} anime ailesi düzeltildi; ${removed} eski ek içerik kaydı temizlendi.`,
        );
      }
    } catch (error) {
      setRepairStatus(
        `Aile onarımı başarısız: ${error instanceof Error ? error.message : String(error)}`,
      );
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  /**
   * "ANILIST'TEN DOLDUR" (06.10.2026) — bir dizinin BOŞ anime bilgilerini
   * (2. ad / açıklama / tür / yıl) AniList'ten çeker. DOLU alanlara DOKUNMAZ
   * (bkz. `lib/admin.ts → fillShowMetadataFromMal`); hangi alanların atlandığı
   * dürüstçe bildirilir.
   *
   * MAL kimliği olmayan dizide buton hiç çizilmez; yine de çağrılırsa net bir
   * hata verilir (sessiz başarısızlık yok).
   */
  async function fillFromMal(item: MetadataHealthRow) {
    const malId = malIdByShow[item.showId];
    if (!malId) {
      toast.error(`${item.slug} için MAL kimliği yok — düzenleyiciden girip tekrar dene.`);
      return;
    }
    setMetaBusy(item.showId);
    try {
      const { filled, skipped } = await fillShowMetadataFromMal(item.showId, malId, genreOptions);
      await load();
      if (filled.length === 0) {
        toast.info(
          `${item.slug}: AniList'te doldurulacak yeni bilgi yok` +
            (skipped.length ? ` (dolu: ${skipped.join(", ")}).` : "."),
        );
      } else {
        onNotice(`${item.slug}: ${filled.join(", ")} AniList'ten dolduruldu.`);
      }
    } catch (err) {
      toast.error(
        `${item.slug} doldurulamadı: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setMetaBusy(null);
    }
  }

  const playableCoverage = sourceCoverage.find((item) => item.label === "Oynatılabilir");
  const sourceGapCount = playableCoverage
    ? Math.max(0, playableCoverage.expected - playableCoverage.count)
    : 0;
  const episodeTitleIssues = missingMetadata.filter((item) => item.scope === "episode");
  const total =
    brokenUrls.length +
    missingSeasons.length +
    sourceGapCount +
    missingMetadata.length +
    invalidSources.length +
    missingEpisodeCovers.length +
    franchiseIssues.length;
  const fixableTotal =
    brokenUrls.length + missingSeasons.length + sourceGapCount + episodeTitleIssues.length;
  const categories = [
    {
      label: "Kritik",
      count: brokenUrls.length + missingSeasons.length + invalidSources.length,
      tone: "text-red-400",
    },
    { label: "Eksik kaynak", count: sourceGapCount, tone: "text-amber-400" },
    {
      label: "Bilgi",
      count: missingMetadata.length + missingEpisodeCovers.length,
      tone: "text-sky-400",
    },
    { label: "Aile", count: franchiseIssues.length, tone: "text-violet-400" },
  ];

  return (
    <section className="admin-card">
      {/*
        BAŞLIK + EYLEM AYNI SATIRDA — diğer kartlarla AYNI dil.
        Kullanıcı geri bildirimi (03.10.2026): "Yeniden tara" tek başına sağ
        altta süzülen bir ikondu; "Yeni seri ekle" / "Kodları göster" gibi
        başlığın sağında ETİKETLİ bir düğme oldu. Mobilde sığmazsa alt satıra iner.
      */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-3 font-display text-xl text-foreground">
          <span className="admin-card-label" aria-hidden />
          Veri sağlığı
        </h2>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 rounded-full"
          onClick={() => void load()}
          disabled={loading || busy}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
          Yeniden tara
        </Button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Taranıyor…
          </span>
        ) : total === 0 ? (
          <span className="animate-rise-in inline-flex items-center gap-2 text-emerald-400">
            <CheckCircle2 size={15} /> Sorun yok — anime, bölüm, kapak ve kaynak kayıtları yerinde.
          </span>
        ) : (
          <span className="animate-rise-in inline-flex items-center gap-2 text-foreground">
            <AlertTriangle size={15} /> {total} sorun bulundu.
          </span>
        )}
        {total > 0 && (
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => void fixAll()}
            disabled={busy || loading || fixableTotal === 0}
            title={fixableTotal === 0 ? "Şu an otomatik düzeltilebilen kayıt yok" : undefined}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
            Hepsini düzelt
          </Button>
        )}
        {sourceGapCount > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full px-2 text-xs shadow-none"
            onClick={() => void runSourceRepair()}
            disabled={busy || loading}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />} Eksik
            kaynakları yükle
          </Button>
        ) : null}
        {franchiseIssues.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full border-violet-400/40 px-2 text-xs text-violet-300 shadow-none"
            onClick={() => void repairFranchiseFamilies()}
            disabled={busy || loading}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />} Anime
            ailesini düzelt ({new Set(franchiseIssues.map((item) => item.rootId)).size})
          </Button>
        ) : null}
      </div>

      {!loading && total > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
          {categories
            .filter((item) => item.count > 0)
            .map((item) => (
              <span
                key={item.label}
                className={`rounded-full border border-current/25 bg-current/5 px-2 py-1 ${item.tone}`}
              >
                {item.label} · {item.count}
              </span>
            ))}
        </div>
      ) : null}

      {!loading && sourceCoverage.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-muted-foreground">
          <span className="mr-1 font-normal">Kaynak kapsamı:</span>
          {sourceCoverage.map((item) => (
            <span
              key={item.label}
              className={`rounded-full border px-2 py-1 ${item.optional ? "border-border bg-secondary/40 text-muted-foreground" : item.count === item.expected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}
            >
              {item.label} {item.count}/{item.expected}
            </span>
          ))}
          <span className="w-full font-normal text-muted-foreground">
            Oynatılabilir sayısı tüm kaynaklardan hesaplanır; Anizm yedek sağlayıcıdır.
          </span>
        </div>
      ) : null}
      {repairStatus && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {repairStatus}
        </p>
      )}
      {repairFailures.length > 0 && (
        <details className="mt-2 text-xs text-destructive">
          <summary>Çözülemeyen kaynaklar ({repairFailures.length})</summary>
          <ul className="mt-2 max-h-48 overflow-auto">
            {repairFailures.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}

      {total > 0 && (
        <ul className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {franchiseIssues.length > 0 ? (
            <li className="px-1 pt-1 text-[11px] font-extrabold uppercase tracking-wider text-violet-300">
              Kritik · ayrı kalmış OVA/ONA/Special kayıtları
            </li>
          ) : null}
          {franchiseIssues.slice(0, MAX_VISIBLE_ISSUES).map((item) => (
            <li
              key={`franchise-${item.showId}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-400/5 p-3 text-sm"
            >
              <span className="font-bold text-foreground">{item.title}</span>
              <span className="text-xs text-violet-200">
                {item.format} ayrı anime kaydı · {item.episodeCount} bölüm · ait olduğu ana sezona
                taşınmalı
              </span>
            </li>
          ))}
          {brokenUrls.length > 0 ? (
            <li className="px-1 pt-1 text-[11px] font-extrabold uppercase tracking-wider text-red-400">
              Kritik · bozuk adresler
            </li>
          ) : null}
          {brokenUrls.slice(0, MAX_VISIBLE_ISSUES).map((item) => (
            <li
              key={`url-${item.showId}-${item.season}-${item.number}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/50 p-3 text-sm"
            >
              <span className="font-bold text-foreground">
                {item.slug} S{item.season}B{item.number}
              </span>
              <span className="text-xs text-destructive">{item.why}</span>
              <code className="w-full truncate text-[11px] text-muted-foreground">{item.bad}</code>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto rounded-full"
                onClick={() => void fixUrl(item).then(load)}
                disabled={busy}
              >
                <Wrench size={13} /> {FIX_URL} yap
              </Button>
            </li>
          ))}
          {missingSeasons.length > 0 ? (
            <li className="px-1 pt-2 text-[11px] font-extrabold uppercase tracking-wider text-red-300">
              Kritik · eksik sezon kayıtları
            </li>
          ) : null}
          {missingSeasons.slice(0, MAX_VISIBLE_ISSUES).map((item) => (
            <li
              key={`season-${item.showId}-${item.number}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/50 p-3 text-sm"
            >
              <span className="font-bold text-foreground">{item.slug}</span>
              <span className="text-xs text-destructive">
                {item.number}. Sezon kaydı yok (bölümler var → "0 sezon" görünür)
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto rounded-full"
                onClick={() => void fixSeason(item).then(load)}
                disabled={busy}
              >
                <Wrench size={13} /> Sezon kaydını oluştur
              </Button>
            </li>
          ))}{" "}
          {missingMetadata.length > 0 ? (
            <li className="px-1 pt-2 text-[11px] font-extrabold uppercase tracking-wider text-sky-400">
              Bilgi · eksik bilgiler
            </li>
          ) : null}
          {missingMetadata.slice(0, MAX_VISIBLE_ISSUES).map((item, index) => (
            <li
              key={`meta-${item.showId}-${item.season ?? "show"}-${item.number ?? index}-${item.field}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
            >
              <span className="font-bold text-foreground">
                {item.slug}
                {item.scope === "episode" ? ` S${item.season}B${item.number}` : ""}
              </span>
              <span className="text-xs text-amber-500">
                {item.field}: {item.message}.
              </span>
              {onOpenShow ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto rounded-full"
                  onClick={() => onOpenShow(item.showId)}
                  disabled={busy}
                >
                  Diziyi aç
                </Button>
              ) : null}
              {/* ANILIST'TEN DOLDUR — yalnızca anime kapsamı ve MAL kimliği
                  olan dizilerde. Bölüm başlığı eksikliği AniList'ten gelmez. */}
              {item.scope === "anime" && malIdByShow[item.showId] ? (
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => void fillFromMal(item)}
                  disabled={busy || metaBusy !== null}
                  title={`MAL ${malIdByShow[item.showId]} verisinden doldur (yalnızca boş alanlar)`}
                >
                  {metaBusy === item.showId ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  AniList'ten doldur
                </Button>
              ) : null}
            </li>
          ))}
          {invalidSources.length > 0 ? (
            <li className="px-1 pt-2 text-[11px] font-extrabold uppercase tracking-wider text-red-400">
              Kritik · bozuk kaynak kayıtları
            </li>
          ) : null}
          {invalidSources.slice(0, MAX_VISIBLE_ISSUES).map((item) => (
            <li
              key={`invalid-source-${item.showId}-${item.season}-${item.number}-${item.provider}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <span className="font-bold text-foreground">
                {item.slug} S{item.season}B{item.number}
              </span>
              <span className="text-xs text-destructive">Embed kaynağı: {item.message}.</span>
              {onOpenShow ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto rounded-full"
                  onClick={() => onOpenShow(item.showId)}
                  disabled={busy}
                >
                  Bölümü aç
                </Button>
              ) : null}
            </li>
          ))}
          {missingEpisodeCovers.length > 0 ? (
            <li className="px-1 pt-2 text-[11px] font-extrabold uppercase tracking-wider text-sky-400">
              Bilgi · eksik bölüm kapakları
            </li>
          ) : null}
          {missingEpisodeCovers.slice(0, MAX_VISIBLE_ISSUES).map((item) => (
            <li
              key={`cover-${item.showId}-${item.season}-${item.number}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
            >
              <span className="font-bold text-foreground">
                {item.slug} S{item.season}B{item.number}
              </span>
              <span className="text-xs text-amber-500">
                Bölüm kapağı bulunamadı; AniZip/TVDB kaynakları da kontrol edildi.
              </span>
              {onOpenShow ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto rounded-full"
                  onClick={() => onOpenShow(item.showId)}
                  disabled={busy}
                >
                  Diziyi aç
                </Button>
              ) : null}
            </li>
          ))}
          {total > MAX_VISIBLE_ISSUES && (
            <li className="rounded-xl border border-border bg-background/50 p-3 text-sm text-muted-foreground">
              İlk {MAX_VISIBLE_ISSUES} kayıt gösteriliyor; toplam {total} sorun bulundu.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
