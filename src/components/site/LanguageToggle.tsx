import { LANGS, useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * TR | EN dil değiştirici — referans sitedeki (anikoto) "EN | JP" anahtarının
 * BİREBİR aynısı.
 *
 * NEDEN TEK BİLEŞEN: aynı anahtar dört farklı sayfa başlığında (ana sayfa, seri,
 * izleme, kök 404/hata ekranları) duruyor. Kopyala-yapıştır yapılsaydı biri
 * güncellenmeden kalırdı ve sayfalar arasında görünüm sapardı.
 *
 * ── GÖRÜNÜM: REFERANSTAN BİREBİR ALINDI ─────────────────────────────────────
 * Ölçüler referansın kendi CSS'inden (`header .title-language`) okundu:
 *   · Dış kap: iki çipin YAN YANA yapıştığı tek bir hap; kendi dolgusu/kenarlığı
 *     YOK (eski sürümdeki yuvarlak gri kutu kaldırıldı).
 *   · Çip: `height:23px; line-height:23px; padding:0 5px; font-weight:600;
 *     font-size:1rem; border:2px solid #111b29`. Sağ kenarlık yalnızca son çipte
 *     vardır; ilk çipin sol ucu ve son çipin sağ ucu yarım daire (`50rem`) —
 *     böylece iki çip birleşince tek bir hap gibi görünür.
 *   · AKTİF çip: açık gri dolgu (`#a0b1c5`), KOYU lacivert yazı (`#142030`).
 *     Pasif çip: dolgusuz, `#a0b1c5` yazı. Hover: `#233854` dolgu.
 *   · Font: başlık şeridinde `Nunito` (bkz. styles.css `#sh-header`).
 * KURAL YERİ: ölçüler Tailwind sınıfı olarak değil, `styles.css` içindeki `.sh-lang`
 * bloğunda durur — referansın 2 px'lik kenarlığı ile `content-box` yüksekliği
 * birebir korunabilsin diye.
 *
 * ── SABİT GENİŞLİK: KUTU KAYMAZ ─────────────────────────────────────────────
 * KULLANICI GERİ BİLDİRİMİ (28.09.2026): "TR|EN düğmesi neden kayıyor? Basınca kutu
 * kayıyor, sanki sayfa yeniden çizilmiş gibi."
 * ÇÖZÜM: her çipin metni ORTALANIR ve çipe metinden bağımsız bir `min-width`
 * verilir. Referans bu ölçüyü vermiyordu (iki harfli etiketler orada da aynı
 * genişlikte) ama başlık şeridi `flex` olduğu için tek piksellik fark bile
 * komşuları iter; `min-width` bunu tümden kapatır ve gözle görülür bir değişiklik
 * yaratmaz. Basma hissi `active:scale-95` ile verilir — `transform` yerleşim
 * akışına girmediği için animasyon kutunun İÇİNDE kalır.
 *
 * ── YENİDEN KURULMA (REMOUNT) YOK ───────────────────────────────────────────
 * React `key`i etiket kodudur ("tr"/"en") ve aktif dile BAĞLI DEĞİLDİR. Anahtar
 * `lang` olsaydı her basışta iki düğüm de yeniden kurulur, kutu bir kare boş
 * görünürdü (flash).
 *
 * ── SAYFA YENİLENMESİ / GEZİNME YOK ─────────────────────────────────────────
 * Çip PAYLAŞILAN bir bileşendir ve dört ayrı başlık şeridinde kullanılır; birinde
 * düğümün bir `<form>` ya da `<a>` içine alınması yeterdi ve tıklama ÖRTÜK FORM
 * GÖNDERİMİ / bağlantı varsayılanı ile sayfayı baştan yüklerdi. Bu yüzden:
 *   · `type="button"` — düğme hiçbir zaman "submit" değildir.
 *   · İşleyici açıkça `preventDefault()` + `stopPropagation()` çağırır.
 * Sonuç: dil değişimi SAF istemci metin değişimidir — gezinme, tam sayfa
 * yenileme, hash değişimi ve kaydırma sıçraması OLMAZ.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useLang();

  // "TR"/"EN" kısa kodları çevrilmez (dil kodları her dilde aynı yazılır); yalnızca
  // ekran okuyucular için uzun ad çevrilir.
  const ariaFor = (code: Lang) => (code === "tr" ? t("lang.trLabel") : t("lang.enLabel"));

  return (
    <div role="group" aria-label={t("lang.groupLabel")} className={cn("sh-lang", className)}>
      {LANGS.map((code) => {
        const active = code === lang;
        return (
          <button
            // Anahtar ETİKET kodu, aktif dil DEĞİL: dil değişince düğüm yeniden
            // kurulmaz (bkz. yukarıdaki "YENİDEN KURULMA" notu).
            key={code}
            type="button"
            aria-pressed={active}
            aria-label={ariaFor(code)}
            onClick={(event) => {
              // Varsayılan davranışı açıkça kes: hiçbir form/bağlantı varsayılanı
              // sayfayı yenileyemesin (bkz. "SAYFA YENİLENMESİ" notu).
              event.preventDefault();
              event.stopPropagation();
              setLang(code);
            }}
            // Durum yalnızca `active` sınıfıyla bildirilir; renkler `styles.css`te.
            className={active ? "active" : undefined}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
