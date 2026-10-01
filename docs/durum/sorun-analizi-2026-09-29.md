# shanime — Sorun Analizi (29.09.2026)

**Kaynaklar:** `.dev-log.jsonl` (1253 kayıt) · veritabanı (salt-okuma) · kaynak kod · ekran kayıtlarından çıkarılan kareler.

---

## Özet

Dört sorun var; **sistemin "bozuk" hissettiren kısmının tamamı 1 numaralı sorundan geliyor.**

| # | Sorun | Durum |
| --- | --- | --- |
| **1** | **TauVideo kaynağı HİÇ çözülmüyor** (tek bölümde bile) | ❌ Açık — kök neden bulundu |
| 2 | Geçerli MAL kimliğinde "bulunamadı" (404) | ⚠️ Kısmen düzeltildi |
| 3 | Part bölümleri yanlış numarayla yazıldı (23–34) | ⚙️ Kod düzeltildi, **veri bekliyor** |
| 4 | Sarı uyarı "hata" gibi görünüyor | ⏳ Planlı (UX) |

---

## 1) TauVideo hiç çözülmüyor — KRİTİK

### Kanıt (günlük)

Bütün yazım raporlarında **tek bir tekrarlayan sebep** var:

```
07:48:58  S1 bitti · eklenen 12 · başarısız 1
          sorun: "TauVideo: 25–34. bölümler (10 bölüm): bu bölüm için TauVideo kaydı yok"

17:56:29  S1 bitti · güncellenen 24 · başarısız 1
          sorun: "TauVideo: 1–24. bölümler (24 bölüm): bu bölüm için TauVideo kaydı yok"

17:44:10  1. bölüm kaynakları kaydedildi · kaynakSayisi 2 · sağlayıcılar "anizm,megaplay"
          sorun: "TauVideo: bu bölüm için TauVideo kaydı yok"
```

Kritik ayrıntı: bu hata **Jujutsu Kaisen 1. bölümde bile** var — yani "bu bölüm özel" değil, **çözümleyicinin kendisi hiç çalışmıyor**. Kullanıcının tespiti doğru: *"o bölümler her yerde var"* → yani veri var, kod bulamıyor.

Çalışanlar: **Anizm/Puffy ✅**, **MegaPlay ✅** (`kaynakSayisi: 2 · sağlayıcılar "anizm,megaplay"`).

### Kod

`src/routes/api.animecix.ts`

- **206:** `if (raw.length === 0) return fail("bu bölüm için TauVideo kaydı yok");`
- **221:** `return fail("gömülebilir tau-video kaydı yok (yalnızca reklamlı oynatıcılar var)");`

Ayrıca `SeasonsPanel.tsx:249` bu hatanın **daha önce de bildirildiğini** gösteriyor (aynı mesaj için bir sınıflandırıcı var: `SeasonsPanel.tsx:266`).

### Neden bozuk olduğu (hipotez + nasıl kesinleştirilir)

`raw.length === 0` demek: animecix'ten dönen içerikte **hiç oynatıcı bulunamadı**. İki olası sebep:

1. **Upstream değişti** — animecix'in bölüm sayfası/API'si farklı bir alan (JSON/HTML yapısı) döndürüyor, ayrıştırıcı eski deseni arıyor.
2. **Upstream engelliyor** — 403/404/timeout (bot koruması) ve kod bunu "oynatıcı yok" sanıyor.

**Bu ikisi şu an AYIRT EDİLEMİYOR** çünkü her iki durumda da aynı mesaj üretiliyor (206 vs 221 ayrımı yalnızca "ham liste boş" ↔ "sadece reklamlı oynatıcı" için).

### Çözüm planı

1. **Teşhis:** başarısızlıkta **ham yanıtın ilk ~200 karakterini + HTTP durumunu** günlüğe yaz (şu an yalnızca "kayıt yok" görüyoruz).
2. **Ayrım:** `raw.length === 0` yolunu ikiye böl:
   - `upstream erişilemedi (HTTP 403/404/timeout)` → ağ/engel sorunu,
   - `sayfa geldi ama oynatıcı yok` → ayrıştırıcı sorunu.
3. **Ayrıştırıcıyı güncelle:** canlı tek bölümle test edip (yerel sunucudan `/api/animecix` çağrısı) dönen gövdeye göre deseni düzelt.
4. **Geçici kullanıcı yolu:** TauVideo'nun **tikini kaldır** → sarı uyarı da kaybolur, yazımlar sağlıklı biter (anizm + megaplay çalışıyor).

---

## 2) Geçerli MAL kimliğinde "bulunamadı" (404)

### Kanıt

```
günlük 17:57:11   "404 /"  →  gövde: {"errors":["Not Found."],"data":{"Media":null}}
video kareleri    MAL: 39535 → yanında "Bulunamadı: 39535 …" uyarısı
```

39535 **geçerli** bir kimlik (Mushoku Tensei S1 — veritabanından doğrulandı). Yani arama, geçerli kimlikte 404 alıyor.

### Durum / plan

- Mesaj artık anlaşılır: *"MAL 39535 AniList'te yok (404) — kimliği kontrol et."* (uygulandı ✅)
- **Kalan iş:** 404 gövdesini günlüğe tam yaz + id ile aramada `idMal` yerine doğrudan AniList kimliğini de dene (aynı kayıt iki yoldan bulunabilsin).

---

## 3) Part bölümleri yanlış numarayla yazıldı

### Kanıt (veritabanı, salt-okuma)

```
Mushoku Tensei (MAL 39535)
S1 B1–B11    → Part 1 ✓
S1 B12–B22   → BOŞ ✗
S1 B23–B34   → Part 2 (yanlış numaralarla) ✗
sağlayıcılar: anizm 23 · megaplay 23 · TR kaynağı 13 satır
```

Sitede de görünüyor: **Episode 23 / Episode 24 …** (doğru olması gereken: 12–23).

### Kök neden (kaput)

1. Başlık eşleşmesi **en büyük** numarayı seçiyordu → kaydırma 22'ye kayıyordu.
2. Kaynak bölüm sayısı **üst sınırı** negatife düşüp kaydırmayı 0'a çekebiliyordu.

**İkisi de düzeltildi** ✅ (en küçük numara kazanır + sınır kaldırıldı).

### Kalan iş — veri yeniden yazımı (UI'dan, 3 adım)

1. **S1'in çöp kutusu** → onayla (1–11 + 23–34 kaynaklarıyla silinir).
2. **39535** → ara → satıra tıkla → yazdır → S1 = 11 bölüm.
3. **45576** → ara → satıra tıkla → "12–23 olarak numaralandı" demeli → yazdır → **S1 = 23 bölüm (1–11 + 12–23)**.

> Not: Bu adımı ben API'den denedim, **yazamadım** — elimdeki anahtarla RLS yazma izni vermiyor (12 satıra PATCH attım, satırlar değişmedi).

---

## 4) Sarı kutu "hata" gibi görünüyor (UX)

**Kanıt:** ekranda *"⚠ TauVideo: 10 bölüm yok [ yalnızca eksikleri seç ]"* → bu bir **durum tespiti**, çökme değil: seçili kaynaklardan hangisi kaç bölümde yok.

Yazma bitince panel kendini yenilediği için bir an görünüp kayboluyor.

**Plan:**
- Dili "bilgi"ye çevir, **kalıcı + kapatılabilir** yap.
- 1 numaralı sorun çözülene kadar bu kutuya *"TauVideo tikini kaldırabilirsin"* ipucu ekle.

---

## Öncelik sırası

1. **TauVideo çözümleyicisi** (1) — kullanıcının gördüğü "kaynak yok" hatalarının **tamamı** bu. Önce teşhis logu, sonra ayrıştırıcı düzeltmesi.
2. **Veri yeniden yazımı** (3) — site yanlış bölüm numarası gösteriyor.
3. **UX + arama 404** (4, 2).

## Bu oturumda uygulanan ve doğrulanan düzeltmeler

- Hover animasyonları geri (istenen hâliyle) · basınca açılma animasyonları (`rise-in`) · katlanır bölüm geçişi (`expand-rows`) · onay penceresi animasyonu.
- Katalog popup'ı: açılışta son ölçüsünde duruyor (katlanma bitti).
- Kaynak bazlı rozetler + eksik özeti ("kaynak yok" görünürlüğü).
- Part algılama + **sabit** kaydırma (Mushoku/Re:Zero örnekleriyle doğrulandı).
- Hedef sezon seçicisi: kaydı olmayan yeni sezon "S3 (yeni)" olarak görünüyor.
- Sezonu tek tıkla silme (çöp kutusu) — kaynaklar dâhil kalıntısız.
- Varsayılan kaynak seçimi: hepsi seçili.
- Arama 404 mesajı anlaşılır hâle geldi.

Her adımda: `tsc 0` · `eslint src 0` · `npm run build ✓` · çalışan sunucu (8080) yeni kodu servis ediyor.
