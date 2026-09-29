// `src/lib/mal-search.ts` GERÇEK modülünü Node tip-sıyırmasıyla çalıştırır.
import { malIdMissText, mapGenres, searchMal } from "../src/lib/mal-search.ts";

const line = (label: string, value: unknown) => console.log(label, "=>", JSON.stringify(value));

// 1) MAL 42310 (Cyberpunk: Edgerunners)
const a = await searchMal({ malId: 42310 });
line("42310 hits", a);
line("42310 slug-basi", a[0]?.title);

// 2) MAL 61990 (Cyberpunk: Edgerunners 2)
const b = await searchMal({ malId: 61990 });
line("61990 hits", b);

// 3) Var olmayan kimlik -> 404 hatası fırlatır
try {
  await searchMal({ malId: 999999999 });
  line("999999999", "HATA: fırlatmadı");
} catch (e) {
  line("999999999 throws", (e as Error).message);
}

// 4) Tür eşlemesi (mevcut seçenek yok)
line("mapGenres(42310, [])", mapGenres(a[0]?.genres ?? [], []));
// 5) Tür eşlemesi (mevcut seçeneklerin YAZIMI korunur)
line("mapGenres(42310, [aksiyon,Dram])", mapGenres(a[0]?.genres ?? [], ["aksiyon", "Dram"]));
// 6) Sözlükte olmayan ad aynen kalır
line("mapGenres(bilinmeyen)", mapGenres(["Made Up"], []));

// 7) Adla arama
const byName = await searchMal({ title: "Cyberpunk Edgerunners" });
line("ad ile hit sayısı", byName.length);
line("ad ile ilk 3", byName.slice(0, 3).map((h) => [h.malId, h.title, h.format, h.year]));

// 8) 404 yönlendirme metni
line("malIdMissText(55818) içerir 404/51179", [
  malIdMissText(55818).includes("404"),
  malIdMissText(55818).includes("51179"),
]);
