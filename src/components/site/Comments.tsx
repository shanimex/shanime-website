import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

import { useLang } from "@/lib/i18n";

/**
 * BÖLÜM YORUMLARI — oynatıcının altındaki "Yorumlar" sekmesi.
 *
 * KULLANICI İSTEĞİ (04.10.2026): "videonun alt kısmına yorumlar bölümü ekleyelim".
 *
 * ── NEDEN YEREL ─────────────────────────────────────────────────────────────
 * Sitede kullanıcı hesabı (auth) ve yorum tablosu YOK. Backend uydurup sahte
 * veri göstermek yerine yorumlar tarayıcıda saklanır (`localStorage`) ve bölüm
 * bazında ayrılır (`shanime:comments:v1:<episodeId>`). Böylece özellik bugün
 * çalışır durumda: yaz, listele, sil. İleride Supabase tablosu eklenirse
 * yalnızca bu dosyanın okuma/yazma katmanı değişir, arayüz aynı kalır.
 *
 * ── GEÇİCİ OLARAK KAPALI (05.10.2026) ───────────────────────────────────────
 * KULLANICI İSTEĞİ: "yorumları geçici olarak kapalı olsun, bilgilendirelim;
 * yorumlar yine gözüksün ama yazamasınlar, kilitli olduğu belli olsun."
 *
 * `COMMENTS_LOCKED = true` iken: YAZMA alanı hiç çizilmez, onun yerine net bir
 * "geçici olarak kapalı" bilgi kutusu görünür; mevcut yorumlar OKUNABİLİR kalır
 * (silme dahil hiçbir yazma yapılamaz). Yeniden açmak için tek yapılacak:
 * aşağıdaki sabiti `false` yapmak — başka hiçbir yer değişmez.
 */
const COMMENTS_LOCKED = true;

type Comment = {
  id: string;
  name: string;
  text: string;
  /** Epoch ms. */
  at: number;
};

const STORAGE_PREFIX = "shanime:comments:v1:";
const MAX_LENGTH = 600;

function loadComments(episodeKey: string): Comment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + episodeKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Comment =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Comment).id === "string" &&
        typeof (item as Comment).text === "string",
    );
  } catch {
    return [];
  }
}

function saveComments(episodeKey: string, comments: Comment[]) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + episodeKey, JSON.stringify(comments));
  } catch {
    // Kota dolu / gizli mod: yorum o an görünür kalır, kalıcı olmaz — sessizce geç.
  }
}

/** Kısa göreli zaman: "az önce", "5 dk", "3 sa", "2 gün". */
function relativeTime(at: number, now: number, isEn: boolean) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return isEn ? "just now" : "az önce";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return isEn ? `${minutes}m` : `${minutes} dk`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return isEn ? `${hours}h` : `${hours} sa`;
  const days = Math.round(hours / 24);
  return isEn ? `${days}d` : `${days} gün`;
}

export function Comments({ episodeKey }: { episodeKey: string }) {
  const { t, lang } = useLang();
  const isEn = lang === "en";
  const [comments, setComments] = useState<Comment[]>([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  // `now` istemcide kurulur — sunucuda `Date.now()` çağırmak hidrasyon uyuşmazlığı
  // doğururdu (göreli zaman sunucu/istemci arasında farklı çıkardı).
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setComments(loadComments(episodeKey));
    setNow(Date.now());
  }, [episodeKey]);

  const submit = () => {
    if (COMMENTS_LOCKED) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const next: Comment[] = [
      ...comments,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim() || t("watch.commentsAnonymous"),
        text: trimmed.slice(0, MAX_LENGTH),
        at: Date.now(),
      },
    ];
    setComments(next);
    saveComments(episodeKey, next);
    setText("");
  };

  const remove = (id: string) => {
    if (COMMENTS_LOCKED) return;
    const next = comments.filter((comment) => comment.id !== id);
    setComments(next);
    saveComments(episodeKey, next);
  };

  const count = comments.length;

  return (
    <section aria-labelledby="watch-comments-title" className="space-y-3">
      <div className="flex items-center gap-2.5">
        <h2
          id="watch-comments-title"
          className="flex items-center gap-2.5 font-display text-sm text-foreground"
        >
          <span className="h-4 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          {t("watch.commentsHeading")}
        </h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 font-ui text-[11px] font-bold text-muted-foreground">
          {count}
        </span>
      </div>

      {/* YAZMA ALANI — GEÇİCİ OLARAK KAPALIYSA hiç çizilmez; yerine bilgi kutusu. */}
      {COMMENTS_LOCKED ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary/30 p-3.5">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-muted-foreground"
          >
            <Lock size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-ui text-[13px] font-bold text-foreground">
              {t("watch.commentsLocked")}
              <span className="rounded border border-border px-1.5 py-0.5 font-ui text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("watch.commentsLockedBadge")}
              </span>
            </p>
            <p className="mt-1 font-ui text-[12px] leading-relaxed text-muted-foreground">
              {t("watch.commentsLockedHint")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3.5">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder={t("watch.commentName")}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-ui text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary sm:max-w-[240px]"
          />
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={MAX_LENGTH}
            rows={3}
            placeholder={t("watch.commentPlaceholder")}
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-ui text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="font-ui text-[11px] text-muted-foreground/70">
              {text.length}/{MAX_LENGTH}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="rounded-lg bg-primary px-4 py-1.5 font-ui text-[12.5px] font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("watch.commentSubmit")}
            </button>
          </div>
        </div>
      )}

      {/* LİSTE — kilitliyken de OKUNABİLİR kalır. */}
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3.5 py-6 text-center font-ui text-[12.5px] text-muted-foreground">
          {COMMENTS_LOCKED ? t("watch.commentsEmptyLocked") : t("watch.commentsEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {comments
            .slice()
            .reverse()
            .map((comment) => (
              <li key={comment.id} className="flex gap-3 bg-card/40 px-3.5 py-3">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary font-ui text-[13px] font-bold uppercase text-muted-foreground"
                >
                  {comment.name.slice(0, 1) || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-ui text-[13px] font-bold text-foreground">
                      {comment.name}
                    </span>
                    <span className="font-ui text-[11px] text-muted-foreground/70">
                      {now === null ? "" : relativeTime(comment.at, now, isEn)}
                    </span>
                    {/* SİLME de bir yazma işlemidir: kilitliyken gösterilmez. */}
                    {COMMENTS_LOCKED ? null : (
                      <button
                        type="button"
                        onClick={() => remove(comment.id)}
                        className="ml-auto shrink-0 font-ui text-[11px] font-semibold text-muted-foreground/60 transition-colors hover:text-primary"
                      >
                        {t("watch.commentDelete")}
                      </button>
                    )}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words font-ui text-[13px] leading-relaxed text-foreground/90">
                    {comment.text}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
