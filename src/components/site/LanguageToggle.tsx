import { LANGS, useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * TR | EN dil değiştirici — sağ üstteki iki küçük "pill".
 *
 * NEDEN TEK BİLEŞEN: aynı anahtar üç farklı sayfa başlığında (ana sayfa, seri
 * detayı, izleme) duruyor. Kopyala-yapıştır yapılsaydı biri güncellenmeden
 * kalırdı ve sayfalar arasında görünüm sapardı.
 *
 * NEDEN KOMPAKT: başlık şeridi mobilde dar. Çipler küçük (11 px yazı, sabit
 * yükseklik) tutulur ki mobil menü düğmesiyle yan yana sığsınlar ve mevcut mobil
 * menüyü (açılır panel) hiç etkilemesinler.
 *
 * Renkler bizim temamızdan: aktif çip ANA RENK (primary), pasif çip soluk
 * (muted). Referanstaki (anikoto "EN | JP") yerleşim fikri alındı, renkler
 * alınmadı.
 *
 * ── SABİT GENİŞLİK: KUTU ARTIK KAYMIYOR ─────────────────────────────────────
 * KULLANICI GERİ BİLDİRİMİ: "TR | EN düğmesi neden kayıyor? Basınca kutu
 * kayıyor, sanki sayfa yeniden çizilmiş gibi."
 *
 * SEBEP: eski çiplerde genişliği YAZI belirliyordu (`px-2 py-0.5` + serbest
 * metin) ve üst şerit `justify-between` bir flex'tir. Dil değişince yalnızca
 * düğmenin kendi metni değil, YANINDAKİ menü ve "Keşfet/Explore" düğmesinin
 * metni de değişiyor; flex yeniden ölçülüyor ve düğme yatay olarak kayıyordu.
 *
 * ÇÖZÜM (üç kural birden, çünkü biri tek başına yetmiyor):
 *   1) Her çip `w-9` (36 px) SABİT genişlikte ve yatay dolgusu YOK; etiket
 *      `justify-center` ile ortalanır. "TR" ile "EN" harf genişliği farklı
 *      olsa da kutu aynı kalır.
 *   2) Aktif/pasif durumda `font-weight`, `border` ve `padding` AYNI; yalnızca
 *      `color` + `background-color` değişir. (Eski kodda da ağırlık aynıydı ama
 *      dolgu serbest metne göre ölçülüyordu — asıl kayma sebebi buydu.)
 *      Böylece kap genişliği = 2×36 (çip) + 1×2 (gap) + 2×2 (dolgu) +
 *      2×1 (kenarlık) = 80 px ve dil ne olursa olsun DEĞİŞMEZ.
 *   3) Basma hissi `active:scale-95` ile verilir: `transform` yerleşim akışına
 *      girmediği için animasyon kutunun İÇİNDE kalır, komşu öğeleri itmez.
 *      Renk geçişi tek bir `transition-property` listesinde tutulur
 *      (`transition-[color,background-color,transform]`): `transition-colors` +
 *      `transition-transform` ayrı yazılsaydı `twMerge` ikincisini birincisinin
 *      üzerine yazıp renk geçişini düşürürdü.
 *
 * ── YENİDEN KURULMA (REMOUNT) YOK ───────────────────────────────────────────
 * React `key`i etiket kodudur ("tr"/"en") ve aktif dile BAĞLI DEĞİLDİR. Anahtar
 * `lang` olsaydı her basışta iki düğüm de yeniden kurulur, kutu bir kare boş
 * görünürdü (flash) — kullanıcının "yeniden çizilmiş gibi" dediği şeyin bir
 * parçası da bu olurdu. Sabit anahtar sayesinde AYNI DOM düğümü yeniden
 * kullanılır; dil değişimi yalnızca metin ve renk güncellemesidir.
 *
 * ── SAYFA YENİLENMESİ / GEZİNME YOK ─────────────────────────────────────────
 * KULLANICI GERİ BİLDİRİMİ: "TR'ye basınca sayfa neden yenileniyor?"
 *
 * Dil değiştirici PAYLAŞILAN bir bileşendir ve dört ayrı başlık şeridinde
 * kullanılır (ana sayfa, seri, izleme, kök 404/hata ekranları); birinde
 * düğümün bir `<form>` ya da `<a>` içine alınması yeterdi ve tıklama ÖRTÜK
 * FORM GÖNDERİMİ / bağlantı varsayılanı ile sayfayı baştan yüklerdi. Bu yüzden:
 *   · `type="button"` — düğme hiçbir zaman "submit" değildir (varsayılan
 *     `type` "submit"tir; form içinde sayfayı yeniler).
 *   · İşleyici açıkça `preventDefault()` + `stopPropagation()` çağırır —
 *     böylece üstündeki bir form/bağlantı varsayılanı ya da dış tıklama
 *     dinleyicisi devreye giremez.
 * Sonuç: dil değişimi SAF istemci metin değişimidir. Gezinme, tam sayfa
 * yenileme, hash değişimi ve kaydırma sıçraması OLMAZ; kaydırma konumu ile açık
 * paneller (arama paneli, mobil menü) olduğu gibi korunur.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useLang();

  // "TR"/"EN" kısa kodları çevrilmez (dil kodları her dilde aynı yazılır); yalnızca
  // ekran okuyucular için uzun ad çevrilir.
  const ariaFor = (code: Lang) => (code === "tr" ? t("lang.trLabel") : t("lang.enLabel"));

  return (
    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * ANİKOTO GÖRÜNÜMÜ (kullanıcı, 28.09.2026: "TR EN butonunu anikoto'daki gibi
     * yaparmısın, aynısı direkt").
     *
     * Referanstaki biçim: üst şeritte KÜÇÜK, DİKDÖRTGEN (hap değil) bir kutu; içinde
     * iki minik çip yan yana; AKTİF olanın arkasında açık tonlu bir dolgu var,
     * pasif olan yalnızca soluk yazı. Yazı çok küçük ve büyük harf.
     *
     * ESKİ GÖRÜNÜM: tam yuvarlak hap (`rounded-full`), kırmızı `bg-primary` dolgu,
     * 11 px kalın yazı. Renk bizim temamızdan geliyordu; referansta ise dolgu
     * TEMA RENGİ DEĞİL, nötr açık bir ton. Bu yüzden dolgu `bg-white/25` yapıldı:
     * kırmızıyla boyanınca düğme sayfadaki "oynat" gibi AKSİYON öğeleriyle
     * yarışıyordu ve dil seçimi bir eylem gibi görünüyordu.
     *
     * KORUNANLAR (bunlar davranış, görünüm değil — bozulmamalı):
     *   · `w-7` sabit çip genişliği → dil değişince kutu KAYMAZ (eski şikâyet).
     *   · `type="button"` + preventDefault/stopPropagation → sayfa YENİLENMEZ.
     *   · `key={code}` → dil değişince düğüm yeniden kurulmaz (flash olmaz).
     *   · `bg-white/5` — `backdrop-blur` BİLEREK YOK: üst şeritte kaydırma
     *     sırasında her karede yeniden bulanıklaştırma maliyeti çıkarıyordu
     *     (performans turunda tüm tekrarlayan blur'lar kaldırıldı).
     * ═══════════════════════════════════════════════════════════════════════════
     */
    <div
      role="group"
      aria-label={t("lang.groupLabel")}
      className={cn(
        // Köşe AÇIK değerle sabitlendi (`rounded-[6px]`): `rounded-md` ile ölçümde
        // 14 px (yani tam yuvarlak/hap) okundu ve dış kutu hap gibi görünüyordu.
        // Referansta dış kutu KÖŞELİ durur; açık değer başka bir `rounded-*`
        // sınıfının ezmesini de imkânsız kılar.
        "inline-flex shrink-0 items-center gap-[3px] rounded-[6px] border border-white/10 bg-white/5 p-[3px]",
        className,
      )}
    >
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
            className={cn(
              // Sabit kutu (`w-7`) + ortalama → TR ve EN birebir aynı yeri kaplar.
              "inline-flex h-5 w-7 items-center justify-center rounded-[4px] text-[10px] font-bold uppercase tracking-wider",
              // Basma animasyonu yalnızca transform + renkler; düzeni oynatmaz.
              "transition-[color,background-color,transform] duration-150 motion-safe:active:scale-95",
              active
                ? "bg-white/25 text-white"
                : "text-white/45 hover:bg-white/10 hover:text-white/80",
            )}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
