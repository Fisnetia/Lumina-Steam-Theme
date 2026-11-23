// Describe the library's left game list: how section headers and game rows
// are laid out (virtualized absolute rows vs. normal flow), so animations can
// be keyed correctly. Used with: python tools/cdp.py evalf tools/gamelist.js
(() => {
  const readable = (e) => [...e.classList].filter(c => !/\d/.test(c) || /^[A-Z][a-z]/.test(c)).join('.');
  const desc = (e) => {
    if (!e) return 'null';
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    return `${e.tagName.toLowerCase()}[${readable(e)}] y=${Math.round(r.top)} h=${Math.round(r.height)} pos=${cs.position}` +
      `${e.style.transform ? ' transform=' + e.style.transform : ''}${e.style.top ? ' top=' + e.style.top : ''}${e.style.height ? ' styleH=' + e.style.height : ''} kids=${e.childElementCount}`;
  };
  const headers = [...document.querySelectorAll('[class*="SectionHeader"]')]
    .filter(e => e.getBoundingClientRect().left < 400 && e.getBoundingClientRect().height > 10);
  const h = headers[0];
  if (!h) return 'no section header found';
  const out = ['header count (visible, left list): ' + headers.length, 'first header: ' + desc(h), 'ancestors:'];
  let a = h.parentElement;
  for (let i = 0; i < 6 && a; i++, a = a.parentElement) out.push('  ' + desc(a));
  // The row-level element: walk up until the parent has many children (the list).
  let row = h;
  while (row.parentElement && row.parentElement.childElementCount < 4) row = row.parentElement;
  out.push('row element: ' + desc(row), 'list element: ' + desc(row.parentElement), 'list children (first 14):');
  [...row.parentElement.children].slice(0, 14).forEach(c => out.push('  ' + desc(c) + ' | ' + c.textContent.trim().slice(0, 24)));
  return out.join('\n');
})()
