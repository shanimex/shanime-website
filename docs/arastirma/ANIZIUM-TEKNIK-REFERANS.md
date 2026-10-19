# Anizium — teknik referans (ileride kendi oynatıcımızı kurarken bakmak için)

> **DURUM: ŞU AN UYGULANMAYACAK.**
> Kullanıcı kararı (25.09.2026): anizium'un kalitesi ve oynatıcısı çok iyi ama
> dosyalarını doğrudan kullanmak **dikkat çeker**. Site önce tutmalı; risk
> alınmayacak. Bu belge, "bir gün kendi oynatıcımızı/boru hattımızı kurarsak
> nasıl yapılır" sorusunun cevabı olarak **referans** amaçlı tutuluyor.
>
> Buradaki hiçbir adres/anahtar `src/` içine girmeyecek.

## 1. Mimari — işi üç alan adı bölüşmüş

| Alan adı | İşi |
|---|---|
| `api.anizium.co` | Veri: dizi/bölüm/kullanıcı API'si (`/anime/get?id=`, `/user/get`) |
| `x.anizium.co` | Oynatıcı + **altyazı servisi** + kapaklar |
| `x.aniziumserver.site` / `.sbs` | **Video dosyaları** (iki alan adı birbirinin aynası) |

- Oynatıcı: **Artplayer** (`art-video-player`, `art-setting-panel`).
- Ana site (`anizium.co`) hiç medya tutmuyor; oynatıcıyı `<iframe>` ile gömüyor.
- Anti-bot: `user-session`, `user-profile`, `Cf-Control` (imzalı, `CLIENT_KEY`'den).
  `u=` parametresi **kullanıcı kimliği**, token değil.

## 2. Medya adresi kalıbı (ölçüldü, çalışıyor)

```
https://x.aniziumserver.{site|sbs}/{tmdb_id}/{sezon}/{bölüm}/{kalite}.{ses}.mp4
```

- `{ses}`: `trdub` · `endub` · `original`  ← oynatıcıdaki **Türkçe / İngilizce / Japonca**
- `{kalite}`: `2160p` · `1440p` · `1080p` · `720p` · `480p`

**Kalite matrisi — JJK S1B1, ölçülen boyutlar:**

| Kalite | `original` (Japonca) | `trdub` (Türkçe) |
|---|---|---|
| 2160p | 1605 MB | 1008 MB |
| 1440p | 695 MB | 541 MB |
| 1080p | 445 MB | 411 MB |
| 720p | 222 MB | 242 MB |
| 480p | 117 MB | 128 MB |

Bölüm aralığı JJK S1: `1..24` var, `25/26` yok. Sezonlar: S1, S2, S3 var, S4 yok.

**Önemli:** kalite geçişi **HLS değil** — her kalite ayrı bir MP4 dosyası
(`Accept-Ranges: bytes`, progressive). Yani sunucuda tek bir master playlist yok;
dosya başına bir kalite var.

## 3. Oynatıcı menüsü (JJK S1B1'de gözlemlendi)

```
Aspect Ratio        Default
Hız                 Normal
Kalite              2160p(4K) · 1440p(2K) · 1080p · 720p · 480p     [1080p seçili]
Ses                 Türkçe · Japonca · İngilizce                     [Japonca varsayılan]
Alt Yazı Grubu      Türkçe
Alt Yazı            Ayarları
Oynatıcı Ayarları   Yönet
Video Filtre        Yönet
```

Ek düğmeler: İntroyu atla · Endingi atla · Sonraki bölüm.
Sunucu listesi (kaynak grupları): `alfa_player_2_v1` (Alfa) · `alfa_player_v1` (Anizium)
· `server_v1` (Standart) · `beta_player_v1` (Beta). Site notu: *"Donma veya takılma
yaşıyorsanız, Alfa'yı tercih edebilirsiniz."*

**Kopyalanacak fikir:** "orijinal dil" tüm serilerde **varsayılan**, dublajlar ayrı
kodlanmış dosyalar. Kalite seçimi kullanıcıya açık, tek dosya içinde çoklu iz değil.

## 4. Altyazı servisi — gerçek `.vtt`, istenildiğinde kapanıyor

```
GET https://x.anizium.co/api/subtitle/get/file.vtt?id={anime}&name={s1_b1_...}&season=1&episode=1&type=json
```

İçeriği (JJK S1B1, ölçüldü):

```vtt
WEBVTT

00:00:06.000 --> 00:00:09.000
<line r="1" style="">Bu çeviri Anizium için hazırlanmıştır.
Çevirmen:Howaku-shin</line>
```

Dikkat: standart olmayan `<line r="1" style="">` etiketi var. Yani düz VTT
ayrıştırıcımız (`parseSubtitles`) bu satırı **metin olarak** basar — kendi
sistemimize alırsak bu etiketleri temizlemek gerekir.

## 5. Erişim kontrolü — duvar nerede, nerede değil

| Katman | Durum |
|---|---|
| Premium kapısı (ana site) | **Yalnızca istemci tarafı** (`_klaus.user.subscription`, `episode_data.free`) |
| Oynatıcı embed (`x.anizium.co/embed`) | **Referer kilitli** — `Referer: https://anizium.co/` yoksa `{"isError":true,"msg":"Video açılamaz."}` |
| Medya dosyası | **Korumasız** — Referer yok/farklı → 200, tam dosya. Token yok. |

## 6. Kapsama — kalıp TÜM katalogda geçerli değil

10 dizi test edildi (S1B1, 5 varyant, iki alan adı, Referer'lı/Referer'sız):

| Bulunan (200) | Bulunmayan (404) |
|---|---|
| Jujutsu Kaisen `95479` | Re:Zero `65942` |
| Mushoku Tensei `94664` | Attack on Titan `1429` |
| Erased `65249` | One Piece `37854` |
| Frieren `209867` | Naruto `46260` |
| Death Note `13916` | Demon Slayer `85937` |

404'ler için denenenler: AniList/MAL kimlikleri, anizium'un **kendi** watch kimliği,
`.sbs` aynası, `Referer` ekleme, `.m3u8` yolları → **hepsi 404**.
Gerçek yolu (doğru sayısal kimlik mi, yoksa dosya o CDN'de hiç yok mu) yalnızca
**giriş yapılmış bir oynatıcı oturumu** gösterebilir; denenmedi.

## 7. Neden şimdi uygulamıyoruz

1. Bölüm başına 277–445 MB, tamamı onların sunucusundan gider.
2. Ücretli, lisanslı bir platform (Türkçe dublajı kendileri üretiyor).
3. Dosya korumasız **bugün**; Referer kontrolü eklemek tek satır.
4. Erişim oynatıcı oturumuna bağlı: aynı JJK sayfası bir oturumda oynatıcıyı
   açtı, sonraki oturumda premium duvarı gösterdi → **kararsız**.
5. Kapsama doğrulanmış 5/10; "tüm animeler" garantisi yok.

## 8. İleride kendi oynatıcımızı kurarken alınacak dersler

- Ayrı kodlanmış dosyalar + basit çoklu kalite menüsü, HLS'e gerek kalmadan
  yeterli bir deneyim veriyor (progressive MP4 + `Accept-Ranges`).
- Altyazı **ayrı bir VTT servisi** olarak tutulursa dil eklemek/çıkarmak
  video dosyalarına dokunmadan mümkün oluyor.
- "Orijinal ses varsayılan, dublaj opsiyonel" yaklaşımı bizim de hedefimiz.
- Yedek alan adları (`.site` / `.sbs`) tek nokta arızasını azaltıyor.
- Bizde bunun karşılığı zaten var: `src/data/episode-embeds.json` +
  `SubtitleOverlay` (kendi altyazı katmanımız). Oynatıcıyı kendimiz yaparsak
  `FluidPlayer` + `<track>` yeterli olur.
