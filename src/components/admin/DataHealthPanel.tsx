import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/admin";
import {
  findBrokenUrls,
  findMissingSeasons,
  type BrokenEpisodeUrl,
  type MissingSeasonRow,
} from "@/lib/content-health";

/** Bozuk adres düzeltilirken yazılan değer (sağlayıcı direktifi). */
const FIX_URL = "@megaplay";

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
export function DataHealthPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokenUrls, setBrokenUrls] = useState<BrokenEpisodeUrl[]>([]);
  const [missingSeasons, setMissingSeasons] = useState<MissingSeasonRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [shows, seasons, episodes] = await Promise.all([
        db.from("shows").select("id,slug"),
        db.from("show_seasons").select("show_id,number"),
        db.from("show_episodes").select("show_id,season,number,watch_url"),
      ]);
      if (shows.error) throw shows.error;
      if (seasons.error) throw seasons.error;
      if (episodes.error) throw episodes.error;

      const showRows = (shows.data ?? []) as { id: string; slug: string }[];
      const seasonRows = (seasons.data ?? []) as { show_id: string; number: number }[];
      const episodeRows = (episodes.data ?? []) as {
        show_id: string;
        season: number;
        number: number;
        watch_url: string | null;
      }[];

      setBrokenUrls(findBrokenUrls(showRows, episodeRows));
      setMissingSeasons(findMissingSeasons(showRows, seasonRows, episodeRows));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function fixUrl(item: BrokenEpisodeUrl) {
    const { error: writeError } = await db
      .from("show_episodes")
      .update({ watch_url: FIX_URL })
      .eq("show_id", item.showId)
      .eq("season", item.season)
      .eq("number", item.number);
    if (writeError) {
      alert("Düzeltilemedi: " + writeError.message);
      return;
    }
    onNotice(`${item.slug} S${item.season}B${item.number} adresi ${FIX_URL} olarak düzeltildi.`);
  }

  async function fixSeason(item: MissingSeasonRow) {
    const { error: writeError } = await db.from("show_seasons").insert({
      show_id: item.showId,
      number: item.number,
      title: "",
      sort_order: item.number,
    });
    if (writeError) {
      alert("Sezon kaydı oluşturulamadı: " + writeError.message);
      return;
    }
    onNotice(`${item.slug} için ${item.number}. Sezon kaydı oluşturuldu.`);
  }

  async function fixAll() {
    setBusy(true);
    try {
      const urls = [...brokenUrls];
      const seasons = [...missingSeasons];
      for (const item of urls) await fixUrl(item);
      for (const item of seasons) await fixSeason(item);
      await load();
      onNotice(`${urls.length} bağlantı + ${seasons.length} sezon kaydı düzeltildi.`);
    } finally {
      setBusy(false);
    }
  }

  const total = brokenUrls.length + missingSeasons.length;

  return (
    <section className="admin-card">
      <h2 className="flex items-center gap-3 font-display text-2xl text-foreground">
        <span className="admin-card-label" aria-hidden />
        Veri sağlığı
      </h2>

      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Taranıyor…
          </span>
        ) : total === 0 ? (
          <span className="inline-flex items-center gap-2 text-primary">
            <CheckCircle2 size={15} /> Sorun yok — tüm oynatıcı adresleri ve sezon kayıtları
            yerinde.
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-foreground">
            <AlertTriangle size={15} /> {total} sorun bulundu.
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto rounded-full"
          onClick={() => void load()}
          disabled={loading || busy}
          title="Yeniden tara"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
        </Button>
        {total > 0 && (
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => void fixAll()}
            disabled={busy || loading}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
            Hepsini düzelt
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}

      {total > 0 && (
        <ul className="mt-3 space-y-2">
          {brokenUrls.map((item) => (
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
          {missingSeasons.map((item) => (
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
          ))}
        </ul>
      )}
    </section>
  );
}
