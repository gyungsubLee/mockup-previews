const preview = document.querySelector('#preview');
const panel = document.querySelector('#controls');
const toggle = document.querySelector('#panel-toggle');
const play = document.querySelector('#play');
const slider = document.querySelector('#progress');
const stateButtons = [...document.querySelectorAll('[data-progress]')];
const mobile = matchMedia('(max-width: 900px)');

function setPanel(open) {
  panel.dataset.open = String(open);
  panel.inert = mobile.matches && !open;
  toggle.setAttribute('aria-expanded', String(open));
}

function closePanel() {
  if (!mobile.matches) return;
  setPanel(false);
  toggle.focus();
}

function send(type, progress) {
  preview.contentWindow.postMessage({ type, progress }, location.origin);
}

for (const button of stateButtons) {
  button.addEventListener('click', () => {
    send('seek', Number(button.dataset.progress));
    closePanel();
  });
}

slider.addEventListener('input', () => send('seek', Number(slider.value) / 1000));
play.addEventListener('click', () => send('play'));
document.querySelector('#replay').addEventListener('click', () => send('replay'));
toggle.addEventListener('click', () => setPanel(panel.dataset.open !== 'true'));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closePanel();
});
mobile.addEventListener('change', () => setPanel(false));

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== preview.contentWindow) return;
  if (event.data.type !== 'state') return;
  const progress = event.data.progress;
  slider.value = String(Math.round(progress * 1000));
  document.querySelector('#position').value = `${Math.round(progress * 100)}%`;
  document.querySelector('#full-preview').href = `journey.html?p=${progress.toFixed(3)}`;
  document.querySelector('#scene-state').textContent = event.data.label;
  play.innerHTML = event.data.playing ? '일시 정지 <span>Ⅱ</span>' : '자동 시연 <span>▶</span>';
  let nearest = stateButtons[0];
  for (const button of stateButtons) {
    if (Math.abs(Number(button.dataset.progress) - progress) < Math.abs(Number(nearest.dataset.progress) - progress)) nearest = button;
    button.removeAttribute('aria-current');
  }
  nearest.setAttribute('aria-current', 'page');
});
setPanel(false);
