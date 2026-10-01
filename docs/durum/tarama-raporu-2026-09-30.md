# shanime — Tam Tarama Raporu

**Tarih:** 30.09.2026 · **Kapsam:** tüm kaynak kod (`src/`, 87 dosya), tüm sayfalar (18 rota), tüm klasörler, canlı geliştirme günlükleri, veritabanı (salt-okuma), R2/Supabase altyapısı.

---

## Özet — kötü haber yok

Projeye zarar vermemişsin. **Derleme çalışıyor, tipler temiz, tüm görseller sağlam, yeni Supabase hesabı ve R2 deposu sorunsuz.** Bulunan şeylerin çoğu kozmetik ya da kalıntı; yalnızca **2 tanesi gerçek davranış hatası** ve ikisi de küçük.

| Alan | Sonuç |
| --- | --- |
| Tip kontrolü (`tsc --noEmit`) | ✅ **0 hata** |
| Üretim derlemesi (`vite build`) | ✅ **Başarılı** (istemci + SSR + Cloudflare worker) |
| ESLint | ⚠️ 0 hata, **1 uyarı** (aşağıda 2 numaralı bulgu) |
| Görseller (9/9 seri) | ✅ **Hepsi açılıyor** — 4 yerel dosya + 5 R2 adresi HTTP 200 |
| R2 deposu + `cdn.shanime.xyz` | ✅ Çalışıyor (canlı test edildi) |
| Yeni Supabase projesi | ✅ Çalışıyor — tablolar okunuyor, veri dolu |
| Canlı günlük (`.dev-log.jsonl`, 2559 kayıt) | ✅ Yalnızca **1** hata kaydı (bayat, aşağıda) |
| Git çalışma alanı | ✅ Temiz (commit'lenmemiş değişiklik yok) |
| `.env` / `.dev.vars` sırları | ✅ Git'te **takipli değil** (güvende) |

---

## 1) Görsel denetimi — istediğin kontrol

Veritabanındaki **her** görsel yolu tek tek doğrulandı:

| Seri | Yol türü | Sonuç |
| --- | --- | --- |
| erased | yerel `static/` | ✅ 44,7 KB diskte var |
| jujutsu-kaisen | yerel `static/` | ✅ 83,4 KB diskte var |
| mushoku-tensei | yerel `static/` | ✅ 90,5 KB diskte var |
| re-zero | yerel `static/` | ✅ 74,1 KB diskte var |
| cyberpunk-edgerunners | R2 `cdn.shanime.xyz` | ✅ HTTP 200 |
| death-note | R2 `cdn.shanime.xyz` | ✅ HTTP 200 |
| jujutsu-kaisen-0 | R2 `cdn.shanime.xyz` | ✅ HTTP 200 |
| solo-leveling | R2 `cdn.shanime.xyz` | ✅ HTTP 200 |
| spy-x-family | R2 `cdn.shanime.xyz` | ✅ HTTP 200 |

**Kırık görsel yok.** R2'ye geçiş başarılı olmuş: kapakların yarısı artık `cdn.shanime.xyz` üzerinden geliyor ve egress ücretsiz — eski "33 GB kota patlaması" sorununun çözümü buydu (`content.ts:316-319`, yorumda yazılı).

### Dikkat: `images` bucket'ı yok
Yeni Supabase projesinde **hiç bucket görünmüyor** (`GET /storage/v1/bucket` → `[]`). Bu şu an **zarar vermiyor**, çünkü tüm görseller ya yerel ya R2'ye taşınmış. Ama kodda hâlâ eski Supabase yollarını imzalamaya çalışan kalıntı var — bu, 1 numaralı bulgunun sebebi.

---

## 2) Gerçek hatalar (2 tane)

### 🔴 Hata 1 — Panelde banner yükleyince önizleme boşalıyor

**Yer:** `src/lib/content.ts:220-225` + `src/components/admin/ShowEditor.tsx:212`

```ts
// content.ts — tekil sürüm
export async function signImagePath(path: string): Promise<string> {
  if (!path) return "";
  if (isStaticPath(path)) return staticUrl(path);
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? "";        // ← R2 adresi buraya düşerse null → ""
}
```

**Sebep:** R2'ye geçildikten sonra yükleme fonksiyonu `https://cdn.shanime.xyz/banners/...` gibi **tam adres** döndürüyor. Toplu sürüm (`signImagePaths`, satır 242) bu durumu doğru yakalıyor:

```ts
else if (/^https?:\/\//i.test(path)) result.set(path, path);   // R2/dış adres geçer
```

Ama **tekil** sürümde bu satır yok. Dolayısıyla tam adres `createSignedUrl`'e gidiyor, hata veriyor, sonuç `""` oluyor.

**Etki:** Panelde vitrin banner'ı yüklediğinde önizleme boş görünür; sayfayı yenileyince düzelir. (Kapak yüklemede aynı sorun yok — o yol farklı işliyor.)

**Düzeltme:** Toplu sürümdeki satırı tekil sürüme eklemek. Tek satır.

---

### 🟠 Hata 2 — `formatAirdate` bir bileşen dosyasından export ediliyor

**Yer:** `src/components/site/EpisodeCard.tsx:53` (export) · kullanan: `src/routes/anime.$slug.index.tsx:19`

ESLint uyarısı:
```
53:17  warning  Fast refresh only works when a file only exports components.
       Use a new file to share constants or functions between components
       react-refresh/only-export-components
```

**Bununla bağlantılı gerçek olay:** `.dev-log.jsonl`'deki **tek hata kaydı** bu:

```
08:41:23  Switched to client rendering because the server rendering errored:
          (0 , __vite_ssr_import_8__.formatAirdate) is not a function
```

Yani `EpisodeCard.tsx` hem bileşen hem yardımcı fonksiyon dışa aktardığı için geliştirme sunucusunda SSR bir an fonksiyonu bulamadı ve sayfa istemci tarafına düştü. Hata geçici (sonraki yüklemede düzeldi) ama sebebi kalıcı: bu dosya yapısı HMR ile çakışıyor.

**Etki:** Geliştirme sırasında ara ara sayfa "istemci tarafına düşer", ani bozulma gibi görünür. Üretim derlemesini etkilemez.

**Düzeltme:** `formatAirdate`'i `src/lib/format-airdate.ts` gibi ayrı bir dosyaya taşı, iki yerden oradan import et. Uyarı da, SSR çakışması da biter.

---

## 3) Çöp / kalıntı (kod değil, dosya)

| Yol | Boyut | Durum |
| --- | --- | --- |
| `image_generate/` (2 JSON önbellek) | 0,01 MB | **Hiçbir yerde referansı yok** — eski bir görsel üretim oturumundan kalmış |
| `test-artifacts/dev-err.log` | 116 KB | Dev sunucusu günlüğü — `09:12`'de yazılmış (canlıydı) |
| `test-artifacts/dev-out.log` | 64 KB | Aynı |

`test-artifacts/` günlükleri **bugün 09:12'de** yazılmış: dev sunucusu `.env` değişince yeniden başlamış, ardından "Re-optimizing dependencies because lockfile has changed" → "server restarted". Yani R2/Supabase değişikliğin sağlıklı şekilde uygulanmış.

**İçlerindeki hatalar bayat mı?** `dev-err.log`'da 118 eşleşme var ama hepsi eski düzenleme anlarına ait:
- `Cannot find module '@/data/anime-logo-files.json'` → **dosya artık var** (204 byte, geçerli JSON) → çözülmüş
- `[PARSE_ERROR] 'export' modifier cannot appear on a type member` / `Unterminated string` → yazma anındaki geçici sözdizimi hataları
- `.tanstack\tmp\...` `ENOENT` → geçici HMR dosyası

**Karar senin:** `image_generate/` bence çöp (referanssız). `test-artifacts/` canlı dev aracı, silmesem daha iyi.

---

## 4) Diğer kalıntılar (zararsız, bilgi)

- **`episode-cover-files.json` boş** (`[]`, 3 byte) — yerel bölüm kapağı üretilmemiş. Kod bunu **düzgün karşılıyor** (`localCoverFiles` boş küme → uzak kapağa düşüyor). Hata değil.
- **`signImagePath` tekil sürümü** dışında eski Supabase imzalama yolu hâlâ duruyor — `images` bucket'ı artık yok.
- **Vitrin işareti 0/9** — hiçbir seri "vitrinde göster" işaretli değil. Migration notuna göre işaretli yoksa ilk seriler gösteriliyor.
- `src/routes/README.md` — rota klasöründe açıklama dosyası (bilinçli).

---

## 5) Açık işler — `sorun-analizi-2026-09-29.md`'den

Bunlar koddan değil, önceki oturumun analizinden geliyor ve **hâlâ açık**:

| # | Sorun | Durum |
| --- | --- | --- |
| 1 | **TauVideo kaynağı hiç çözülmüyor** (tek bölümde bile) — kullanıcının gördüğü "kaynak yok" hatalarının tamamı bu | ❌ Açık, kök neden bulunmuş, düzeltilmemiş |
| 2 | Geçerli MAL kimliğinde 404 (AniList) | ⚠️ Mesaj düzeltildi, arama yolu açık |
| 3 | Part bölümleri yanlış numaralandırıldı (23–34) — **kod düzeltildi, veri bekliyor** | ⚙️ Panelden yeniden yazım gerekiyor |
| 4 | Sarı uyarı kutusu "hata" gibi görünüyor (UX) | ⏳ Planlı |

**En kritik:** 1 numara. Önerilen ilk adım teşhis logu eklemek — başarısızlıkta ham yanıtın ilk ~200 karakteri + HTTP durumu günlüğe yazılsın, böylece "upstream engelledi" ile "ayrıştırıcı bozuk" ayrılabilsin. Şu an ikisi de aynı mesajı üretiyor.

---

## 6) Bekleyen istek (bu oturumdan, yapılmadı)

**Hover animasyonlarını yok et + eski animasyonları geri getir.** En son istediğin buydu, sonra tam taramaya geçtik. Envanter hazır: `styles.css`'te **9 hover kuralı, 5 farklı süre, 4 farklı hareket** var ve "zıplama" hissi `scale(1.05/1.06/1.08)` büyümelerinden geliyor. Uygulanmadı — hangi hâlin "eski" olduğunu doğrulamadan silmek istemedim.

---

## Önerilen sıra

1. **Hata 1** (banner önizleme) — tek satır, riski yok
2. **Hata 2** (`formatAirdate` taşıma) — küçük dosya, ESLint uyarısını da kapatır
3. **`image_generate/` sil** — referanssız çöp
4. **Hover animasyonları** — sen "eski" hâlin nasıl olduğunu söyle, birebir geri koyayım
5. **TauVideo** (1 numara) — teşhis logu ekle, canlı tek bölümle test et
6. **Veri yeniden yazımı** (3 numara) — panelden, 3 adım

Hangisinden başlayalım? 1–3'ü tek turda bitirebilirim.

---

# Düzeltme turu — sonuç (30.09.2026, aynı gün)

## Doğrulama (her değişiklikten sonra tekrarlandı)

| Kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit` | ✅ **0 hata** |
| `npx eslint .` | ✅ **0 sorun** — (öncesi: 1 uyarı, artık kapandı) |
| `npx vite build` | ✅ **Başarılı** (istemci 1.32s + SSR 1.18s + worker 0.46s) |

## Yapılan değişiklikler (git diff: 16 ekleme, 29 silme)

| Dosya | Değişiklik |
| --- | --- |
| `src/lib/content.ts` | +5 · `signImagePath` (tekil) artık R2/dış adresleri geçiriyor → **banner önizleme hatası kapandı** |
| `src/lib/format-airdate.ts` | **YENİ** · `formatAirdate` buraya taşındı |
| `src/components/site/EpisodeCard.tsx` | −19 · fonksiyon çıkarıldı, import eklendi |
| `src/routes/anime.$slug.index.tsx` | import kaynağı değişti |
| `src/lib/mal-search.ts` | +9 · AniList hata **gövdesi** artık hataya ekleniyor (404'ün sebebi görünür) |
| `image_generate/` | **SİLİNDİ** (2 dosya, geri dönüşüm kutusunda) |

## 1 ve 3 numaralı açık işler — ikisi de ZATEN ÇÖZÜLMÜŞ

### TauVideo (analizdeki "kritik" madde) — çalışıyor

Upstream **doğrudan** test edildi (`animecix.tv/secure/episode-videos`), aynı başlıklarla:

| Seri / Sezon | İlk bölüm | HTTP | Kayıt | TauVideo embed | Sonuç |
| --- | --- | --- | --- | --- | --- |
| cyberpunk-edgerunners S1 | B1 | 200 | 8 | 2 | ✅ |
| death-note S1 | B1 | 200 | 5 | 2 | ✅ |
| erased S1 | B1 | 200 | 7 | 2 | ✅ |
| jujutsu-kaisen S1 / S2 / S3 | B1 | 200 | 23 / 25 / 33 | 11 / 7 / 9 | ✅ |
| mushoku-tensei S1 / S2 / S3 | B1 | 200 | 15 / 12 / 24 | 6 / 6 / 8 | ✅ |
| re-zero S1 / S2 | B1 | 200 | 5 / 6 | 2 / 3 | ✅ |
| solo-leveling S2 | B1 | 200 | 22 | 11 | ✅ |
| spy-x-family S1 / S2 / S3 | B1 | 200 | 4 / 1 / 12 | 3 / 1 / 4 | ✅ |
| **jujutsu-kaisen-0** (film) | B1 | 200 | **0** | **0** | ⚠️ upstream'de kayıt yok |

**16 kombinasyondan 15'i çözülüyor.** Veritabanında da `animecix` (TauVideo) sağlayıcısıyla **279 kaynak satırı** yazılı (toplam 828: megaplay 281, animecix 279, anizm 268).

Tek istisna **film**: animecix'te `id=8718 Jujutsu Kaisen 0 Movie`, `title_type=movie`, `season_count=0`, `episode_count=0` — yani animecix bu film için **hiç video kaydı yayınlamıyor** (`episode-videos` her parametreyle `[]` dönüyor). Bu bir kod hatası değil, **upstream veri boşluğu**.

**Sonuç:** analizdeki "TauVideo hiç çözülmüyor" tespiti artık geçerli değil. O günkü hatalar geçiciydi (kod zaten Cloudflare 502 için `temporary` yeniden-deneme yolunu eklemiş) ve/veya `animecix_id` kolonu dolmadan önce alınmıştı.

### Part bölüm numaraları — düzelmiş

`mushoku-tensei` veritabanı durumu (id ile birlikte çekildi):

```
S1: 23 bölüm → 1..23  (kesintisiz)
S2: 24 bölüm → 1..24  (kesintisiz)
S3: 14 bölüm → 1..14
```

Başlıklar da sıralı: `S1 B23 "Wake Up and Take a Step"`, `S2 B1 "The Brokenhearted Mage"`, `S2 B24 "Succession"`.

Analizde "S1 B12–B22 BOŞ, B23–B34 yanlış" yazıyordu; **veri yeniden yazımı yapılmış.** Yeniden yazıma gerek yok.

## MAL 404 — önerilen çözümün bir kısmı UYGULANMADI (gerekçeli)

Analiz "404 gövdesini günlüğe yaz **+** `idMal` yerine doğrudan AniList kimliğini de dene" diyordu.

**Birinci kısım yapıldı** (hata gövdesi artık hataya ekleniyor).

**İkinci kısım yapılmadı** — çünkü ölçüm onu çürüttü:

```
id=31043  MAL karşılığı: Boku dake ga Inai Machi        AniList id karşılığı: (yok)
id=31240  MAL karşılığı: Re:Zero …                      AniList id karşılığı: (yok)
id=39535  MAL karşılığı: Mushoku Tensei …               AniList id karşılığı: (yok)
id=51179  MAL karşılığı: Mushoku Tensei II …            AniList id karşılığı: (yok)
id=58567  MAL karşılığı: Ore dake Level Up na Ken S2 …  AniList id karşılığı: (yok)
```

Yani `Media(id: <MAL kimliği>)` yolu **hiçbir sonuç vermiyor** (faydası yok). Dahası zararlı olabilir: MAL kimlikleri (30.000–60.000 bandı) AniList'in kendi kimlik aralığıyla **çakışıyor**, dolayısıyla bu numaraya denk gelen bir AniList kaydı varsa **tamamen başka bir anime** dönerdi. Projenin kendi notlarında bu tuzağın örneği zaten var (animecix aramasında "ada güvenmek ileride sessizce başka bir seriye bölüm yazma riski" — bkz. `supabase/migrations/20260927_animecix_id.sql`).

**Doğru davranış:** kimlik eşlenmiyorsa `malIdMissText` mesajı kullanıcıyı sezonun KENDİ kimliğiyle aramaya yönlendiriyor. Bu zaten uygulanmış ve doğru.

## Animasyonlar

**Dokunulmadı.** İstek doğrultusunda tamamen kapsam dışı bırakıldı.
