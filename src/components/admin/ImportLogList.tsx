import { AlertTriangle, CheckCircle2, Info, Loader2, MinusCircle } from "lucide-react";
import type { ImportLogEntry, ImportStatus } from "@/lib/import-runner";
import { cn } from "@/lib/utils";

/**
 * ── YÜKLEME KAYDI (kullanıcı isteği, 27.09.2026) ──────────────────────────────
 *
 * NEDEN VAR: "hangi bölümlerin/kaynakların başarıyla yüklendiğini, hangilerinin
 * başarısız olduğunu admin panelinde bir log listesi olarak bana göster ki işlemin
 * nerede tıkandığını görebileyim." Eskiden sonuç yalnızca birkaç saniyede kaybolan
 * bir toast'tı ve "12 bölüm başarısız" cümlesinden hangi bölümün nerede takıldığı
 * öğrenilemiyordu. Bu liste ekranda KALIR; her satır bir kalem, altındaki satırlar
 * o kalemin KAYNAKLARIdır (bölüm → kaynak kırılımı).
 *
 * RENK KURALI (kullanıcı isteği): yeşil yalnızca gerçekten yazılanlar için;
 * `skipped` ("kaynakta yok") HATA değildir → nötr amber/mavi; kırmızı YALNIZCA
 * gerçek hatalar için.
 */

const STATUS_STYLE: Record<
  ImportStatus,
  { icon: typeof CheckCircle2; className: string; text: string }
> = {
  ok: { icon: CheckCircle2, className: "text-emerald-400", text: "yazıldı" },
  skipped: { icon: MinusCircle, className: "text-amber-400", text: "kaynakta yok" },
  failed: { icon: AlertTriangle, className: "text-red-400", text: "başarısız" },
  stopped: { icon: Info, className: "text-muted-foreground", text: "durduruldu" },
};

/** Tek satır (bölüm ya da kaynak) — aynı görsel dil, farklı girinti. */
function LogRow({
  status,
  title,
  detail,
  meta,
  indent,
}: {
  status: ImportStatus;
  title: string;
  detail: string;
  meta: string;
  indent?: boolean;
}) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.failed;
  const Icon = style.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-2 py-1.5",
        indent ? "ml-4 bg-background/40" : "bg-background/70",
      )}
    >
      <Icon size={13} className={cn("mt-0.5 shrink-0", style.className)} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-foreground">
          {title}
          <span className={cn("ml-2 font-semibold", style.className)}>{style.text}</span>
        </p>
        {detail ? (
          <p className="mt-0.5 break-words text-[11px] leading-4 text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      {meta ? (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{meta}</span>
      ) : null}
    </div>
  );
}

export function ImportLogList({
  entries,
  running,
  onClear,
}: {
  entries: ImportLogEntry[];
  /** Koşu sürüyor mu (başlıkta dönen simge gösterilir). */
  running?: boolean;
  onClear?: () => void;
}) {
  if (entries.length === 0 && !running) return null;

  const ok = entries.filter((entry) => entry.status === "ok").length;
  const skipped = entries.filter((entry) => entry.status === "skipped").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;

  return (
    <section className="mt-3 rounded-2xl border border-border bg-card/50 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-foreground">
          {running ? <Loader2 size={13} className="animate-spin" /> : <Info size={13} />} Yükleme
          kaydı
        </h4>
        <span className="text-[11px] text-muted-foreground">
          {entries.length} bölüm · <span className="text-emerald-400">{ok} yazıldı</span>
          {skipped > 0 ? ` · ${skipped} kaynakta yok` : ""}
          {failed > 0 ? (
            <>
              {" · "}
              <span className="text-red-400">{failed} başarısız</span>
            </>
          ) : null}
        </span>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-all hover:text-foreground active:scale-[0.97]"
          >
            temizle
          </button>
        ) : null}
      </header>

      {/* Kaydırılabilir liste: yüzlerce bölümde panel şişmesin. */}
      <div className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <div key={entry.seq}>
            <LogRow
              status={entry.status}
              title={entry.label}
              detail={entry.detail}
              meta={`${entry.ms} ms${entry.attempts > 1 ? ` · ${entry.attempts} deneme` : ""}`}
            />
            {(entry.children ?? []).map((child, index) => (
              <LogRow
                key={`${entry.seq}-${child.provider}-${index}`}
                status={child.status}
                title={child.label}
                detail={child.detail}
                // "2 deneme" = dalgalı hata yaşandı ama kurtarıldı (ör. Cloudflare 502).
                meta={`${child.ms} ms${child.attempts && child.attempts > 1 ? ` · ${child.attempts} deneme` : ""}`}
                indent
              />
            ))}
          </div>
        ))}
        {running ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">işleniyor…</p>
        ) : null}
      </div>
    </section>
  );
}
