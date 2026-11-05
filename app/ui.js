// Ortak arayüz yardımcıları: modal, toast, panoya kopyalama, kurallar
import { esc } from './fmt.js';

export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), ms);
}
export function modal(html, onMount) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="sheet">${html}<div class="btns"><button class="btn" data-close>Kapat</button></div></div>`;
  m.classList.remove('hidden');
  const close = () => { m.classList.add('hidden'); m.innerHTML = ''; };
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); };
  onMount?.(m.querySelector('.sheet'), close);
  return close;
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Panoya kopyalandı'); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    toast(ok ? 'Panoya kopyalandı' : 'Kopyalanamadı — metni elle seçin');
    return ok;
  }
}
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const h = (s) => esc(s);
