import { mountJourney } from './scene.js';

const articles = [...document.querySelectorAll('.chapter')];
const names = ['I · THE BEGINNING', 'II · THE UNKNOWN', 'III · A WORLD OF OUR OWN'];
const labels = ['첫 프로젝트', '다음 프로젝트', '마지막 장면'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const initial = Number(new URLSearchParams(location.search).get('p') ?? 0.08);
let journey;
let progress = 0;
let frame = 0;
let playback = 0;
let playStart = 0;
let playFrom = 0;

const clamp = value => Math.max(0, Math.min(1, value));

function showSceneFailure(error) {
  journey?.dispose();
  journey = undefined;
  document.body.classList.add('failed');
  document.querySelector('.fallback').hidden = false;
  console.error('Journey scene failed:', error.message);
  update();
}

try {
  journey = mountJourney(document.querySelector('#world'));
  journey.ready?.then(report => {
    if (report.failedAssets && report.failedAssets !== 'none') {
      showSceneFailure(new Error(`Generated assets failed: ${report.failedAssets}`));
    }
  }).catch(showSceneFailure);
} catch (error) {
  showSceneFailure(error);
}

function range() {
  return Math.max(1, document.documentElement.scrollHeight - innerHeight);
}

function stopPlayback() {
  cancelAnimationFrame(playback);
  playback = 0;
}

function update() {
  frame = 0;
  progress = clamp(scrollY / range());
  if (!reducedMotion.matches) journey?.setProgress(progress);
  let active = 0;
  for (const [index, article] of articles.entries()) {
    const offset = progress - Number(article.dataset.at);
    const visibility = clamp((0.18 - Math.abs(offset)) / 0.07);
    // ponytail: DOM scale conveys text depth; the scene owns actual camera travel.
    const scale = Math.exp(offset * 2.8);
    article.style.opacity = String(visibility);
    article.style.visibility = visibility > 0 ? 'visible' : 'hidden';
    article.style.transform = `translate(${offset * -170}px, ${offset * 35}px) scale(${scale})`;
    article.style.pointerEvents = visibility > 0.65 ? 'auto' : 'none';
    article.inert = visibility <= 0.65 && !reducedMotion.matches && Boolean(journey);
    if (Math.abs(offset) < Math.abs(progress - Number(articles[active].dataset.at))) active = index;
  }
  document.querySelector('#current-number').textContent = `0${active + 1}`;
  document.querySelector('#chapter-name').textContent = names[active];
  document.querySelector('#track-fill').style.transform = `translateY(${progress * 103}px)`;
  const travelling = Math.abs(progress - Number(articles[active].dataset.at)) > 0.13;
  parent.postMessage({
    type: 'state',
    progress,
    playing: Boolean(playback),
    label: travelling ? '길을 따라 전진 중' : labels[active],
  }, location.origin);
}

function scheduleUpdate() {
  if (!frame) frame = requestAnimationFrame(update);
}

function seek(value) {
  const next = clamp(Number.isFinite(value) ? value : 0);
  window.scrollTo({ top: next * range(), behavior: 'instant' });
  update();
}

function animate(time) {
  if (document.hidden) {
    stopPlayback();
    update();
    return;
  }
  const next = playFrom + (time - playStart) / 34000;
  playback = requestAnimationFrame(animate);
  seek(next);
  if (next >= 1) {
    stopPlayback();
    update();
  }
}

function play() {
  if (reducedMotion.matches) return;
  playFrom = progress > 0.97 ? 0 : progress;
  playStart = performance.now();
  playback = requestAnimationFrame(animate);
}

window.addEventListener('scroll', scheduleUpdate, { passive: true });
window.addEventListener('resize', scheduleUpdate);
for (const input of ['wheel', 'touchstart', 'keydown']) {
  window.addEventListener(input, stopPlayback, { passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPlayback();
  else scheduleUpdate();
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  const { type, progress: position } = event.data;
  if (type === 'seek') {
    stopPlayback();
    seek(position);
  } else if (type === 'replay') {
    stopPlayback();
    seek(0);
    play();
  } else if (type === 'play') {
    if (playback) {
      stopPlayback();
      update();
    } else play();
  }
});

document.querySelectorAll('a[href^="#project-"]').forEach(link => {
  link.addEventListener('click', event => {
    if (reducedMotion.matches) return;
    event.preventDefault();
    stopPlayback();
    seek(Number(document.querySelector(link.hash).dataset.at));
  });
});
document.querySelector('.nav-end').addEventListener('click', event => {
  if (reducedMotion.matches) return;
  event.preventDefault();
  stopPlayback();
  seek(0.19);
});
reducedMotion.addEventListener('change', () => {
  stopPlayback();
  journey?.setProgress(0.18);
  scheduleUpdate();
});
window.addEventListener('pagehide', () => {
  stopPlayback();
  cancelAnimationFrame(frame);
  journey?.dispose();
}, { once: true });

if (reducedMotion.matches) journey?.setProgress(0.18);
else seek(Number.isFinite(initial) ? initial : 0.08);
update();
console.info('Mock ready: cartoon forest journey; placeholder project copy; no production integration.');
