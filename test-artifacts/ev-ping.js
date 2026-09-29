(async () => {
  const out = { href: location.href, title: document.title };
  try {
    const r = await fetch(location.origin + "/", { cache: "no-store" });
    out.homeStatus = r.status;
  } catch (e) {
    out.homeErr = String(e);
  }
  try {
    const r2 = await fetch("http://127.0.0.1:8080/admin", { cache: "no-store" });
    out.admin127Status = r2.status;
  } catch (e) {
    out.admin127Err = String(e);
  }
  const keys = Object.keys(localStorage);
  out.lsKeys = keys;
  out.hasAuth = keys.some((k) => k.includes("auth-token"));
  return out;
})()
