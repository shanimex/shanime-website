(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setVal = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inp = document.querySelector('input[placeholder="ör. 48561"]');
  if (!inp) return { error: 'MAL input not found' };
  setVal(inp, '51179');
  await sleep(500);
  const ara = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith("MAL'de ara"));
  if (!ara) return { error: 'search button not found' };
  ara.click();
  await sleep(2500);
  const rows = [...document.querySelectorAll('button')].filter(
    (b) => b.textContent.includes('51179') && b.textContent.includes('Mushoku')
  );
  if (!rows.length)
    return {
      error: 'no result row',
      visibleButtons: [...document.querySelectorAll('button')]
        .map((b) => b.textContent.trim())
        .filter((t) => /51179|Mushoku|eşleşme|Sonuç/i.test(t))
        .slice(0, 20),
    };
  rows[0].click();
  await sleep(2000);
  const dlg = document.querySelector('[role="dialog"]');
  return {
    clickedRow: rows[0].textContent.trim(),
    dialogText: dlg ? dlg.innerText : '(no dialog)',
  };
})()
