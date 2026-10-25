const video = document.querySelector('#backgroundVideo');
const motionButton = document.querySelector('#motionButton');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function syncVideoButton() {
  motionButton.textContent = video.paused ? 'Включить видео ▷' : 'Пауза видео Ⅱ';
  motionButton.setAttribute('aria-pressed', String(!video.paused));
}
function playVideo() { video.play().catch(() => syncVideoButton()); }
if (reduced.matches) video.pause(); else playVideo();
video.addEventListener('play', syncVideoButton);
video.addEventListener('pause', syncVideoButton);
reduced.addEventListener('change', event => { if (event.matches) video.pause(); });
motionButton.addEventListener('click', () => {
  if (video.paused) { video.style.display = 'block'; playVideo(); } else video.pause();
});
syncVideoButton();

async function loadUpdates() {
  const list = document.querySelector('#updateList');
  const source = 'https://raw.githubusercontent.com/daniil179828/Changelog/refs/heads/main/changelog.json';
  try {
    const response = await fetch(source, {cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) throw new Error('Empty changelog');
    const fragment = document.createDocumentFragment();
    data.slice(0, 2).forEach(entry => {
      const article = document.createElement('article'); article.className = 'update';
      const head = document.createElement('div'); head.className = 'update-title';
      const title = document.createElement('h3'); title.textContent = entry.version || 'Обновление';
      const date = document.createElement('span'); date.style.cssText = 'font-size:12px;color:var(--muted)'; date.textContent = entry.date || '';
      head.append(title, date); article.append(head);
      const ul = document.createElement('ul');
      (Array.isArray(entry.items) ? entry.items : []).map(String).filter(text => /[\p{L}]/u.test(text)).slice(0, 3).forEach(text => {
        const li = document.createElement('li'); li.textContent = text.replace(/^\[\+\]\s*/, ''); ul.append(li);
      });
      article.append(ul); fragment.append(article);
    });
    list.replaceChildren(fragment);
  } catch {
    const p = document.createElement('p'); p.className = 'loading'; p.textContent = 'Обновления сейчас недоступны. Откройте чейнджлог на GitHub ↗';
    const a = document.createElement('a'); a.href = 'https://github.com/daniil179828/Changelog'; a.append(p); list.replaceChildren(a);
  }
}
loadUpdates();
