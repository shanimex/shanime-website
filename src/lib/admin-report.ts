/**
 * Admin panelinin "yazılamayan kaynaklar" raporunu OKUNUR kılan yardımcılar.
 *
 * NEDEN GEREKLİ (kullanıcı şikâyeti, 27.09.2026): çözülemeyen her bölüm için ayrı
 * bir "sebep" metni üretiliyordu ve bu metinler bölüm başına yalnızca NUMARADA
 * farklılaşıyordu. Sonuç ekranda şuydu:
 *
 *   "Anizm: 11 bölümde yazılamadı (bölümler: 13,14,…,23) — sebep:
 *    puffytr'da 13. bölüm yok / puffytr'da 14. bölüm yok / … / puffytr'da 23. bölüm yok"
 *
 * Aynı cümle 11 kez tekrarlanıyordu. Bu dosya tekrarları BİR satıra indirir ama
 * bilgi kaybı YOKTUR: bölüm numaraları bir kez, tam liste hâlinde (aralık olarak
 * sıkıştırılmış) verilir ve sebep şablonu korunur:
 *
 *   "Anizm: 13–23. bölümler puffytr'da yok (11 bölüm)"
 *
 * Farklı sebepler (ör. bir bölüm "puffytr adresi çözülemedi") varsa hepsi yine
 * TEK satırda, şablonları hâlinde listelenir — hiçbiri yutulmaz.
 */

/** Ardışık numaraları "13–23" gibi aralıklara sıkıştırır; kopuklarda "13, 15". */
export function numberRangeText(numbers: number[]): string {
  const nums = [...new Set(numbers)]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (nums.length === 0) return "";
  const parts: string[] = [];
  let start = nums[0] ?? 0;
  let previous = start;
  for (let index = 1; index <= nums.length; index += 1) {
    const current = nums[index];
    if (current !== undefined && current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}–${previous}`);
    if (current === undefined) break;
    start = current;
    previous = current;
  }
  return parts.join(", ");
}

/**
 * Bölüm bölüm tekrarlanan sebepleri TEK satıra indirger.
 *
 * KURAL: sebep metinlerindeki SAYILAR "#" ile değiştirilir. Tüm sebepler aynı
 * şablona uyuyorsa numara kısmı cümlenin başına taşınır ("puffytr'da #. bölüm yok"
 * → "13–23. bölümler puffytr'da yok"). Şablon birden çoksa hepsi bir kez yazılır.
 *
 * @param numbers çözülemeyen bölüm numaraları (tekrarlı olabilir; tekilleştirilir)
 * @param reasons bölüm başına sebep metinleri (numarada farklılaşan tekrarlar)
 */
export function collapseEpisodeReasons(numbers: number[], reasons: string[]): string {
  const nums = [...new Set(numbers)]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const count = nums.length;
  if (count === 0) return "sebep yok";
  const list = numberRangeText(nums);

  const uniqueReasons = [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))];
  if (uniqueReasons.length === 0) return `${list}. bölümler çözülemedi`;

  // Tek bölüm: tekrar yok, sebebi olduğu gibi bırak.
  if (count === 1) return `${list}. bölüm: ${uniqueReasons[0] ?? "çözülemedi"}`;

  // Şablon = sebepteki sayıların "#" ile gizlenmiş hâli.
  const templates = [...new Set(uniqueReasons.map((reason) => reason.replace(/\d+/g, "#")))];
  if (templates.length === 1) {
    const template = templates[0] ?? "";
    // "puffytr'da #. bölüm yok" → "#" + ". bölüm" kısmı çıkarılır: "puffytr'da yok"
    const stripped = template.replace(/#\s*[.,]?\s*b[oö]l[uü]m\w*/i, "");
    const moved = stripped !== template ? stripped.replace(/\s+/g, " ").trim() : "";
    return moved
      ? `${list}. bölümler ${moved} (${count} bölüm)`
      : `${list}. bölümler (${count} bölüm): ${template}`;
  }

  // Birden çok sebep: her şablon BİR kez yazılır (bölüm başına tekrar edilmez).
  return `${list}. bölümler (${count} bölüm) — sebepler: ${templates.join(" · ")}`;
}
