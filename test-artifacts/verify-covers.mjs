/**
 * Bölüm kapağı doğrulaması — CDP (Edge/Chromium, port 9222).
 *
 * Ne yapar: verilen sayfaları AÇAR, TÜM ağ isteklerini/yanıtlarını toplar,
 * `/static/episode-covers/*` isteği sayısını, 2xx olmayan istekleri, konsol
 * hatalarını ve sayfadaki kapak <img>'lerinin gerçekten yüklenip yüklenmediğini
 * (naturalWidth>0) raporlar. Ekran görüntüsü kaydeder.
 *
 * Kullanım: node test-artifacts/verify-covers.mjs <url> [pngYolu]
 */

const BASE = "http://127.0.0.1:9222";
const url = process.argv[2] ?? "http://localhost:8080/anime/cyberpunk-edgerunners/season/1/episode/1";
const png = process.argv[3] ?? "test-artifacts/verify-cover.png";

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          id += 1;
          const myId = id;
          return new Promise((res, rej) => {
            pending.set(myId, { res, rej });
            ws.send(JSON.stringify({ id: myId, method, params }));
            setTimeout(() => {
              if (pending.has(myId)) {
                pending.delete(myId);
                rej(new Error(`timeout: ${method}`));
              }
            }, 60000);
          });
        },
        on(fn) {
          listeners.push(fn);
        },
        close() {
          ws.close();
        },
      }),
    );
    ws.addEventListener("error", (e) => reject(new Error("ws error: " + (e.message || "?"))));
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
        return;
      }
      if (msg.method) for (const fn of listeners) fn(msg);
    });
  });
}

const created = await (await fetch(`${BASE}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
const client = await connect(created.webSocketDebuggerUrl);

const requests = new Map(); // requestId -> {url, type, method}
const responses = []; // {url, status, type}
const consoleErrors = [];

client.on((msg) => {
  if (msg.method === "Network.requestWillBeSent") {
    requests.set(msg.params.requestId, {
      url: msg.params.request.url,
      type: msg.params.type,
      method: msg.params.request.method,
    });
  } else if (msg.method === "Network.responseReceived") {
    responses.push({
      url: msg.params.response.url,
      status: msg.params.response.status,
      type: msg.params.type,
    });
  } else if (msg.method === "Network.loadingFailed") {
    const req = requests.get(msg.params.requestId);
    if (req) responses.push({ url: req.url, status: 0, type: req.type, error: msg.params.errorText });
  } else if (msg.method === "Runtime.consoleAPICalled" && /error|warning/i.test(msg.params.type)) {
    consoleErrors.push(
      `${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    );
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(
      "exception: " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text),
    );
  }
});

await client.send("Network.enable");
await client.send("Page.enable");
await client.send("Runtime.enable");
await client.send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

await client.send("Page.navigate", { url });
await new Promise((r) => setTimeout(r, 8000)); // SSR + hydration bekle

// Lazy yüklenen kapaklar için sayfayı bir kez aşağı süpür, sonra başa dön.
await client.send("Runtime.evaluate", {
  expression: `(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 220));
    }
    window.scrollTo(0, 0);
  })()`,
  awaitPromise: true,
});
await new Promise((r) => setTimeout(r, 3500));

// Sayfadaki kapak görsellerini incele (sadece episode kartlarındaki <img>).
const evalJs = `(() => {
  const imgs = [...document.querySelectorAll('img')].map((i) => ({
    src: i.currentSrc || i.src || '',
    loaded: i.complete && i.naturalWidth > 0,
    w: i.naturalWidth,
    h: i.naturalHeight,
  }));
  const covers = imgs.filter((i) => /mangacix\\.net|thetvdb\\.com|image\\.tmdb\\.org|voe\\.sx|pixibay|anilist\\.co|puffytr|vmwesa|vmbox|supabase/i.test(i.src));
  const links = [...document.querySelectorAll('a[href*="/episode/"]')].length;
  return { totalImgs: imgs.length, coverImgs: covers, episodeLinks: links, title: document.title };
})()`;
const pageInfo = (await client.send("Runtime.evaluate", { expression: evalJs, returnByValue: true })).result.value;

const shot = await client.send("Page.captureScreenshot", { format: "png" });
const fs = await import("node:fs/promises");
await fs.writeFile(png, Buffer.from(shot.data, "base64"));
// TÜM SAYFA: bölüm listesinin tamamı görünsün (kanıt).
try {
  const full = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await fs.writeFile(png.replace(/\.png$/i, "-full.png"), Buffer.from(full.data, "base64"));
} catch {
  /* tam sayfa alınamazsa sorun değil */
}

// ---- Rapor ----
const all = responses.length ? responses : [];
const staticCovers = all.filter((r) => r.url.includes("/static/episode-covers/"));
const AD = /(vstserv|doubleclick|googlesyndication|googleads|adsystem|adservice|2mdn|mybid)/i;
const non2xx = all.filter((r) => (r.status < 200 || r.status >= 300) && !AD.test(r.url));
const coverResponses = all.filter((r) => /mangacix\.net|thetvdb\.com|image\.tmdb\.org|anilist\.co|puffytr|voe\.sx|pixibay/i.test(r.url));

console.log(`\n========== ${url} ==========`);
console.log("Screenshot ->", png);
console.log("Başlık:", pageInfo?.title);
console.log("Toplam ağ yanıtı:", all.length, "| episode linki:", pageInfo?.episodeLinks);
console.log("\n[1] /static/episode-covers/* istek sayısı:", staticCovers.length);
if (staticCovers.length) for (const r of staticCovers) console.log("    !", r.status, r.url);
console.log("\n[2] Kapak görselleri (sayfada bulunan, kaynak hostlarına göre):");
const coverSrc = (pageInfo?.coverImgs ?? []).map((c) => c.src);
console.log("    toplam kapak <img>:", coverSrc.length, "| yüklendi:", pageInfo?.coverImgs.filter((c) => c.loaded).length);
for (const c of pageInfo?.coverImgs ?? []) {
  console.log(`    ${c.loaded ? "OK " : "X  "} ${c.w}x${c.h}  ${c.src}`);
}
console.log("\n[3] Kapak ağ yanıtları (reklam hariç):");
for (const r of coverResponses) console.log(`    ${r.status} ${r.url}`);
console.log("\n[4] 2xx OLMAYAN istekler (reklam ağları hariç):", non2xx.length);
for (const r of non2xx) console.log(`    ${r.status} ${r.type} ${r.url}${r.error ? " (" + r.error + ")" : ""}`);
console.log("\n[5] Konsol hata/uyarıları:", consoleErrors.length);
for (const e of consoleErrors.slice(0, 20)) console.log("    " + e);

client.close();
process.exit(0);
