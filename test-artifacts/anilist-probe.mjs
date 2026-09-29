// Geçici doğrulama betiği — AniList by-id sorgusu + kapak CORS başlıkları.
const mk = (id) => ({
  query:
    "query($id:Int){Media(idMal:$id,type:ANIME){idMal title{romaji english} format startDate{year} genres coverImage{extraLarge large}}}",
  variables: { id },
});

for (const id of [42310, 61990, 999999999]) {
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(mk(id)),
    });
    const j = await r.json();
    console.log("MAL", id, "status", r.status, JSON.stringify(j.data?.Media ?? j.errors));
  } catch (e) {
    console.log("MAL", id, "ERR", e.message);
  }
}

// Kapak görselinin CORS başlıkları (tarayıcıdan indirilebilir mi?).
const coverRes = await fetch("https://graphql.anilist.co", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(mk(42310)),
});
const coverJson = await coverRes.json();
const coverUrl = coverJson.data?.Media?.coverImage?.extraLarge;
console.log("coverUrl", coverUrl);
if (coverUrl) {
  const head = await fetch(coverUrl, { method: "GET" });
  console.log("cover status", head.status, "type", head.headers.get("content-type"));
  console.log("ACAO", head.headers.get("access-control-allow-origin"));
}
