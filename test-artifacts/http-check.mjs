// Yerel dev sunucusuna HTTP ile bakar: ana sayfa + yeni kapak vekil rotası.
const BASE = "http://localhost:8080";

async function probe(label, url, init) {
  try {
    const r = await fetch(url, { cache: "no-store", ...(init ?? {}) });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(
      label,
      "| status:",
      r.status,
      "| type:",
      r.headers.get("content-type"),
      "| bytes:",
      buf.length,
      "| head:",
      JSON.stringify(buf.subarray(0, 24).toString("latin1")),
    );
    return { status: r.status, buf };
  } catch (e) {
    console.log(label, "| ERR:", e.message);
    return null;
  }
}

await probe("HOME          ", `${BASE}/`);
await probe("ADMIN         ", `${BASE}/admin`);

const cover =
  "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx120377-ayZPoxiWt4Li.jpg";
await probe("COVER(vekil)  ", `${BASE}/api/anilist-cover?url=${encodeURIComponent(cover)}`);
await probe("COVER(guard)  ", `${BASE}/api/anilist-cover?url=${encodeURIComponent("https://evil.example/x.jpg")}`);
await probe("COVER(missing)", `${BASE}/api/anilist-cover`);
