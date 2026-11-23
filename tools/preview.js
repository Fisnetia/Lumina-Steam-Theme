// Swap Lumina condition stylesheets live (preview only; a reload restores the saved settings).
// Usage: set window.__lm = {backdrop:'aurora', tint:'balanced', blur:'medium', radius:'medium'} first.
(() => {
  const want = window.__lm || {};
  const out = [];
  for (const link of document.querySelectorAll('link[href*="/lumina/css/conditions/"]')) {
    const m = link.href.match(/\/conditions\/(backdrop|tint|blur|radius)-([\w-]+)\.css/);
    if (!m) continue;
    const [, group, value] = m;
    if (want[group] && want[group] !== value) {
      link.href = link.href.replace(`${group}-${value}.css`, `${group}-${want[group]}.css`);
    }
    out.push(link.href.split('/conditions/')[1]);
  }
  return out.join(', ');
})()
