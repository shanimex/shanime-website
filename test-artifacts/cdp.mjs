// Basit CDP sürücüsü — 9222 portundaki (Edge/Chromium) sekmeyi yönetir.
// Kullanım:
//   node cdp.mjs list
//   node cdp.mjs new <url>                 -> yeni sekme açar, id yazdırır
//   node cdp.mjs nav <tabId> <url>         -> sekmede gezinir
//   node cdp.mjs ev  <tabId> <jsDosyasi>   -> dosyadaki JS ifadesini sayfada koşar
//   node cdp.mjs sh  <tabId> <pngYolu>     -> ekran görüntüsü
//   node cdp.mjs html <tabId>              -> sayfa metni (innerText)

const BASE = "http://127.0.0.1:9222";

async function targets() {
  const r = await fetch(`${BASE}/json/list`);
  return r.json();
}

function pick(list, idOrUrl) {
  if (!idOrUrl) {
    const page = list.find((t) => t.type === "page" && t.url.includes("localhost:8080"));
    if (page) return page;
    return list.find((t) => t.type === "page");
  }
  return (
    list.find((t) => t.id === idOrUrl) ||
    list.find((t) => t.url.includes(idOrUrl)) ||
    null
  );
}

async function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("open", () => resolve({ ws, send }));
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
      }
    });
    function send(method, params = {}) {
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
        }, 30000);
      });
    }
  });
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "list") {
  const list = await targets();
  for (const t of list) {
    if (t.type !== "page") continue;
    console.log(t.id, "|", t.title, "|", t.url);
  }
  process.exit(0);
}

if (cmd === "new") {
  const url = rest[0];
  const r = await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const j = await r.json();
  console.log(j.id);
  process.exit(0);
}

const list = await targets();
const tab = pick(list, cmd === "ev" || cmd === "sh" || cmd === "nav" || cmd === "html" ? rest[0] : null);
if (!tab) {
  console.error("sekme bulunamadı");
  process.exit(1);
}

const { ws, send } = await connect(tab.webSocketDebuggerUrl);
await send("Runtime.enable");

if (cmd === "nav") {
  await send("Page.enable");
  await send("Page.navigate", { url: rest[1] });
  console.log("navigated", rest[1]);
} else if (cmd === "ev") {
  const fs = await import("node:fs/promises");
  const expr = await fs.readFile(rest[1], "utf8");
  const res = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    console.error("EXCEPTION:", JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails));
    process.exit(2);
  }
  console.log(JSON.stringify(res.result?.value ?? null, null, 2));
} else if (cmd === "sh") {
  await send("Page.enable");
  const res = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const fs = await import("node:fs/promises");
  await fs.writeFile(rest[1], Buffer.from(res.data, "base64"));
  console.log("shot ->", rest[1]);
} else if (cmd === "html") {
  const res = await send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  });
  console.log(res.result?.value ?? "");
} else {
  console.error("bilinmeyen komut:", cmd);
}

ws.close();
process.exit(0);
