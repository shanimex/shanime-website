(() => {
  const ls = Object.keys(localStorage);
  const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent.trim());
  return {
    href: location.href,
    title: document.title,
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    hasAuthToken: ls.some((k) => k.startsWith("sb-") && k.includes("auth-token")),
    lsKeys: ls,
    bodyStart: document.body.innerText.slice(0, 400),
    buttons: buttons.slice(0, 25),
  };
})()
