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
import { fetchCatalogEpisodes } from "@/lib/admin-anizip";
import { db, fillShowMetadataFromMal } from "@/lib/admin";
import { hasEpisodeCover } from "@/lib/content";
import {
  findBrokenUrls,
  findMissingSeasons,
  findMissingTurkishSources,
  findMissingMetadata,
  findInvalidSources,
  type BrokenEpisodeUrl,
  type MissingEpisodeSourceRow,
  type MissingSeasonRow,
  type MetadataHealthRow,
  type InvalidSourceRow,
} from "@/lib/content-health";

/** Bozuk adres düzeltilirken yazılan değer (sağlayıcı direktifi). */
const FIX_URL = "@megaplay";
const MAX_VISIBLE_ISSUES = 100;

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
  const [missingTurkishSources, setMissingTurkishSources] = useState<MissingEpisodeSourceRow[]>([]);
  const [missingMetadata, setMissingMetadata] = useState<MetadataHealthRow[]>([]);
  /**
   * Dizi kimliği → MAL kimliği. "AniList'ten doldur" bu eşleme olmadan
   * çalışamaz: hangi kaydın çekileceğini yalnızca MAL kimliği söyler.
   */
  const [malIdByShow, setMalIdByShow] = useState<Record<string, number>>({});
  const [invalidSources, setInvalidSources] = useState<InvalidSourceRow[]>([]);
  const [missingEpisodeCovers, setMissingEpisodeCovers] = useState<MissingEpisodeSourceRow[]>([]);
  const [sourceCoverage, setSourceCoverage] = useState<Array<{ label: string; count: number }>>([]);
  const [episodesCount, setEpisodesCount] = useState(0);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [shows, seasons, episodes, sources] = await Promise.all([
        db
          .from("shows")
          .select("id,slug,title,subtitle,description,year,genre,image_path,mal_id,kind"),
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

      const showRows = (shows.data ?? []) as { id: string; slug: string }[];
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
      setEpisodesCount(normalEpisodeIds.size);
      const coverageGroups = [
        { label: "Anizm", ids: new Set(["anizm", "puffy", "puffytr", "anizmplayer"]) },
        { label: "TauVideo", ids: new Set(["animecix", "tauvideo"]) },
        { label: "MegaPlay", ids: new Set(["megaplay"]) },
      ];
      setSourceCoverage(
        coverageGroups.map(({ label, ids }) => ({
          label,
          count: new Set(
            sourceRows
              .filter(
                (row) =>
                  ids.has(row.provider.trim().toLowerCase()) &&
                  normalEpisodeIds.has(row.episode_id),
              )
              .map((row) => row.episode_id),
          ).size,
        })),
      );

      setBrokenUrls(findBrokenUrls(showRows, episodeRows));
      setMissingSeasons(findMissingSeasons(showRows, seasonRows, episodeRows));
      setMissingTurkishSources(findMissingTurkishSources(showRows, episodeRows, sourceRows));
      const richShows = (shows.data ?? []) as Array<{
        id: string;
        slug: string;
        title: string | null;
        subtitle: string | null;
        description: string | null;
        year: string | null;
        genre: string | null;
        image_path: string | null;
        mal_id: number | null;
        kind: string | null;
      }>;
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
        // yedek olarak kaydet. Dizilerde seri posterini bölüm kapağı diye
        // kullanmıyoruz, aksi hâlde gerçek eksikler gizlenir.
        if (!cover) {
          const show = richShows.find((item) => item.id === episode.show_id);
          if (show?.kind === "movie" && String(show.image_path ?? "").trim()) {
            cover = show.image_path?.trim() ?? "";
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
      title: "",
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

  async function fixAll() {
    if (fixableTotal === 0) {
      toast.info(
        "Otomatik düzeltilecek adres veya sezon yok; eksik kaynakları bölüm düzenleyicisinden tamamla.",
      );
      return;
    }
    // Toplu yıkıcı yazım onaysız çalışıyordu; önce sorulur.
    const ok = await confirmAction({
      title: `${fixableTotal} kayıt düzeltinsin mi?`,
      description:
        "Bozuk adresler varsayılan kaynağa çevrilir, eksik sezon kayıtları açılır. Bu işlem geri alınamaz.",
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
      await load();
      // DÜRÜST özet: önceden kopyalanmış liste boyu değil, gerçek sonuç sayılır.
      onNotice(
        failed === 0
          ? `${done} kayıt düzeltildi.`
          : `${done} kayıt düzeltildi, ${failed} başarısız (nedeni yukarıda).`,
      );
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

  const total =
    brokenUrls.length +
    missingSeasons.length +
    missingTurkishSources.length +
    missingMetadata.length +
    invalidSources.length +
    missingEpisodeCovers.length;
  const fixableTotal = brokenUrls.length + missingSeasons.length;
  const categories = [
    {
      label: "Kritik",
      count: brokenUrls.length + missingSeasons.length + invalidSources.length,
      tone: "text-red-400",
    },
    { label: "Eksik", count: missingTurkishSources.length, tone: "text-amber-400" },
    {
      label: "Bilgi",
      count: missingMetadata.length + missingEpisodeCovers.length,
      tone: "text-sky-400",
    },
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
        {sourceCoverage.some((item) => item.count < episodesCount) ? (
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
              className={`rounded-full border px-2 py-1 ${item.count === episodesCount ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}
            >
              {item.label} {item.count}/{episodesCount}
            </span>
          ))}
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
