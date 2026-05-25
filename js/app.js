import { Recorder } from './recorder.js';
import { Analyzer }  from './analyzer.js';
import { Waveform }  from './waveform.js';
import { Storage }   from './storage.js';

const SILENCE_THRESHOLD_DB_DISPLAY = -50;

// ── Instances ──────────────────────────────────────────────
const recorder = new Recorder();
const analyzer  = new Analyzer();
const storage   = new Storage();

// ── State ──────────────────────────────────────────────────
let audioContext  = null;
let isRecording   = false;
let elapsedMs     = 0;
let timerInterval = null;
let marks         = [];
let recordingBlob = null;
let audioBuffer   = null;
let segments      = [];
let activeSegIdx  = 0;
let previewSource = null;
let waveform      = null;

// ── DOM: 録音画面 ──────────────────────────────────────────
const screenRecord = document.getElementById('screen-record');
const btnRec       = document.getElementById('btn-rec');
const timeDisplay  = document.getElementById('time-display');
const meterFill    = document.getElementById('meter-fill');
const markLog      = document.getElementById('mark-log');

// ── DOM: フレーズ確認画面 ──────────────────────────────────
const screenReview = document.getElementById('screen-review');
const waveCanvas   = document.getElementById('waveform-canvas');
const segLabel     = document.getElementById('seg-label');
const trimInfo     = document.getElementById('trim-info');
const btnPlay      = document.getElementById('btn-play');
const btnPrev      = document.getElementById('btn-prev');
const btnNext      = document.getElementById('btn-next');
const btnSave      = document.getElementById('btn-save');

// ── DOM: 一覧画面 ──────────────────────────────────────────
const screenList    = document.getElementById('screen-list');
const phraseList    = document.getElementById('phrase-list');
const listCount     = document.getElementById('list-count');
const btnSelect     = document.getElementById('btn-select');
const bulkActions   = document.getElementById('bulk-actions');
const bulkCount     = document.getElementById('bulk-count');
const btnBulkDelete = document.getElementById('btn-bulk-delete');

// ── DOM: タブバー ──────────────────────────────────────────
const tabRecord = document.getElementById('tab-record');
const tabWave   = document.getElementById('tab-wave');
const tabList   = document.getElementById('tab-list');

// ── 選択モード状態 ─────────────────────────────────────────
let selectMode  = false;
const selectedIds = new Set();

// ── Init ───────────────────────────────────────────────────
(async () => {
  await storage.init();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
})();

// ══════════════════════════════════════════════════════════
// 録音画面
// ══════════════════════════════════════════════════════════
// ── タブバー ───────────────────────────────────────────────
tabRecord.addEventListener('click', () => showScreen('record'));
tabWave.addEventListener('click',   () => { if (audioBuffer) showScreen('review'); });
tabList.addEventListener('click',   () => showScreen('list'));

function showScreen(id) {
  if (id !== 'list' && selectMode) exitSelectMode();
  stopPreview();
  if (id !== 'list') stopListPreview();
  if (id !== 'review' && rafDraw) { cancelAnimationFrame(rafDraw); rafDraw = null; }

  screenRecord.style.display = id === 'record' ? 'flex' : 'none';
  screenReview.style.display = id === 'review' ? 'flex' : 'none';
  screenList.style.display   = id === 'list'   ? 'flex' : 'none';

  tabRecord.classList.toggle('active', id === 'record');
  tabWave.classList.toggle('active',   id === 'review');
  tabList.classList.toggle('active',   id === 'list');

  if (id === 'review') drawLoop();
  if (id === 'list')   renderList();
}

function updateWaveTab() {
  tabWave.disabled = !audioBuffer;
}

btnRec.addEventListener('click', async () => {
  if (!isRecording) await startRecording();
  else              await stopRecording();
});

async function startRecording() {
  try {
    const stream = await recorder.getStream();
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') await audioContext.resume();

    marks = [];
    elapsedMs = 0;
    markLog.innerHTML = '';
    updateTimeDisplay(0);

    analyzer.onMark        = (t) => { marks.push(t); appendMarkItem(t); };
    analyzer.onLevelUpdate = (db) => updateMeter(db);

    recorder.start(stream);
    analyzer.start(audioContext, stream);

    isRecording = true;
    btnRec.classList.add('recording');
    btnRec.textContent = 'STOP';
    timerInterval = setInterval(() => { elapsedMs += 100; updateTimeDisplay(elapsedMs); }, 100);
  } catch (err) {
    console.error('録音開始エラー:', err);
    alert('マイクへのアクセスが許可されていません。');
  }
}

async function stopRecording() {
  clearInterval(timerInterval);
  timerInterval = null;
  analyzer.stop();
  recordingBlob = await recorder.stop();
  isRecording = false;
  btnRec.classList.remove('recording');
  btnRec.textContent = 'REC';
  updateMeter(-100);
  console.log(`[STOP] ${(elapsedMs / 1000).toFixed(1)}s — marks: ${marks.length}個`);
  await enterReviewScreen();
}

// ══════════════════════════════════════════════════════════
// フレーズ確認画面
// ══════════════════════════════════════════════════════════
async function enterReviewScreen() {
  const arrayBuf = await recordingBlob.arrayBuffer();
  audioBuffer    = await audioContext.decodeAudioData(arrayBuf);

  const boundaries = [0, ...marks, audioBuffer.duration];
  segments = boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1];
    return { start, end, trimStart: findSoundStart(audioBuffer, start, end) };
  });
  const meaningful = segments.filter(s => s.end - s.trimStart >= 0.3);
  segments = meaningful.length > 0 ? meaningful : segments;

  activeSegIdx = 0;
  updateWaveTab();
  showScreen('review');  // canvas must be visible before _resize() reads clientWidth/Height

  if (!waveform) {
    waveform = new Waveform(waveCanvas);
    waveform.onTrimChange = (s, e) => updateTrimInfo(s, e);
  }
  waveform.load(audioBuffer, marks);
  waveform.setActive(activeSegIdx, segments);

  updateSegLabel();
  const { start, end } = waveform.getTrim();
  updateTrimInfo(start, end);
  updateNavButtons();
}

let rafDraw = null;
function drawLoop() {
  if (rafDraw) cancelAnimationFrame(rafDraw);
  const tick = () => {
    if (waveform && segments.length > 0) waveform.draw(segments);
    rafDraw = requestAnimationFrame(tick);
  };
  tick();
}

btnPlay.addEventListener('click', () => {
  if (previewSource) { stopPreview(); btnPlay.textContent = '▶'; }
  else { const { start, end } = waveform.getTrim(); playPreview(start, end); btnPlay.textContent = '■'; }
});

function playPreview(startSec, endSec) {
  stopPreview();
  const src = audioContext.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(audioContext.destination);
  src.start(0, startSec, endSec - startSec);
  src.onended = () => { previewSource = null; btnPlay.textContent = '▶'; };
  previewSource = src;
}

function stopPreview() {
  if (previewSource) { try { previewSource.stop(); } catch (_) {} previewSource = null; }
}

btnPrev.addEventListener('click', () => {
  if (activeSegIdx === 0) return;
  stopPreview();
  moveToSegment(activeSegIdx - 1);
});

btnNext.addEventListener('click', () => {
  stopPreview();
  if (activeSegIdx >= segments.length - 1) exitReviewScreen();
  else moveToSegment(activeSegIdx + 1);
});

btnSave.addEventListener('click', async () => {
  stopPreview();
  const { start, end } = waveform.getTrim();
  const wavBlob = encodeWAV(audioBuffer, start, end);
  const name    = makeFileName();
  const meta    = { name, date: new Date().toISOString(), duration: end - start, size: wavBlob.size };

  btnSave.disabled     = true;
  btnSave.textContent  = '保存中…';
  await storage.savePhrase(wavBlob, meta);
  btnSave.disabled     = false;
  btnSave.textContent  = '保存 ✓';
  setTimeout(() => { if (btnSave.textContent === '保存 ✓') btnSave.textContent = '保存'; }, 1200);

  if (activeSegIdx >= segments.length - 1) exitReviewScreen();
  else moveToSegment(activeSegIdx + 1);
});

function moveToSegment(idx) {
  activeSegIdx = idx;
  waveform.setActive(activeSegIdx, segments);
  updateSegLabel();
  const { start, end } = waveform.getTrim();
  updateTrimInfo(start, end);
  updateNavButtons();
  btnPlay.textContent = '▶';
  btnSave.textContent = '保存';
}

function exitReviewScreen() {
  showScreen('list');
}

function updateSegLabel()    { segLabel.textContent = `${activeSegIdx + 1} / ${segments.length}`; }
function updateNavButtons()  {
  btnPrev.disabled  = activeSegIdx === 0;
  btnNext.textContent = activeSegIdx >= segments.length - 1 ? '完了' : '次へ ▶';
}
function updateTrimInfo(s, e) {
  trimInfo.textContent = `${fmtSec(s)} → ${fmtSec(e)}  (${fmtSec(e - s)})`;
}

// ══════════════════════════════════════════════════════════
// 一覧画面
// ══════════════════════════════════════════════════════════

// ── 選択モード ─────────────────────────────────────────────
btnSelect.addEventListener('click', () => {
  if (selectMode) exitSelectMode();
  else            enterSelectMode();
});

btnBulkDelete.addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  if (!confirm(`${selectedIds.size}件のフレーズを削除しますか？`)) return;
  for (const id of selectedIds) await storage.deletePhrase(id);
  exitSelectMode();
  renderList();
});

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  btnSelect.textContent     = 'キャンセル';
  bulkActions.style.display = 'flex';
  updateBulkDeleteBtn();
  document.querySelectorAll('.phrase-item').forEach(el => el.classList.add('selectable'));
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  btnSelect.textContent     = '選択';
  bulkActions.style.display = 'none';
  document.querySelectorAll('.phrase-item').forEach(el => el.classList.remove('selectable', 'selected'));
}

function toggleItemSelect(id, el) {
  if (selectedIds.has(id)) { selectedIds.delete(id); el.classList.remove('selected'); }
  else                     { selectedIds.add(id);    el.classList.add('selected'); }
  updateBulkDeleteBtn();
}

function updateBulkDeleteBtn() {
  const n = selectedIds.size;
  bulkCount.textContent      = `${n}件選択中`;
  btnBulkDelete.disabled     = n === 0;
  btnBulkDelete.textContent  = n > 0 ? `削除（${n}件）` : '削除';
}

async function renderList() {
  const metas = storage.getAllMeta();
  listCount.textContent = `${metas.length}件`;
  phraseList.innerHTML  = '';

  if (metas.length === 0) {
    phraseList.innerHTML = '<div class="list-empty">保存済みのフレーズはありません</div>';
    return;
  }
  metas.forEach(meta => phraseList.appendChild(createListItem(meta)));
}

function createListItem(meta) {
  const el = document.createElement('div');
  el.className  = 'phrase-item';
  el.dataset.id = meta.id;
  el.innerHTML  = `
    <button class="phrase-play" aria-label="再生">▶</button>
    <div class="phrase-info">
      <div class="phrase-name">${escHtml(meta.name)}</div>
      <div class="phrase-meta">${fmtSec(meta.duration)} · ${fmtDate(meta.date)}</div>
    </div>
    <button class="phrase-dl" aria-label="ダウンロード">↓</button>
  `;

  el.querySelector('.phrase-play').addEventListener('click', (e) => {
    if (selectMode) { toggleItemSelect(meta.id, el); return; }
    e.stopPropagation();
    toggleListPlay(e.currentTarget, meta.id);
  });
  el.querySelector('.phrase-dl').addEventListener('click', async (e) => {
    if (selectMode) { toggleItemSelect(meta.id, el); return; }
    e.stopPropagation();
    const blob = await storage.getBlob(meta.id);
    if (blob) downloadBlob(blob, meta.name);
  });

  // アイテム本体タップ → 選択モード中は選択トグル
  el.addEventListener('click', () => {
    if (selectMode) toggleItemSelect(meta.id, el);
  });

  // Long-press (600ms) → 個別削除（選択モード外のみ）
  let timer;
  const start  = () => { if (!selectMode) timer = setTimeout(() => confirmDelete(meta), 600); };
  const cancel = () => clearTimeout(timer);
  el.addEventListener('touchstart', start,  { passive: true });
  el.addEventListener('touchend',   cancel);
  el.addEventListener('touchmove',  cancel);
  el.addEventListener('mousedown',  start);
  el.addEventListener('mouseup',    cancel);
  el.addEventListener('mouseleave', cancel);

  return el;
}

let listAudio   = null;
let listPlayBtn = null;

async function toggleListPlay(btn, id) {
  if (listAudio) {
    listAudio.pause();
    listAudio.currentTime = 0;
    if (listPlayBtn) listPlayBtn.textContent = '▶';
    const wasSame = listPlayBtn === btn;
    listAudio = null; listPlayBtn = null;
    if (wasSame) return;
  }
  const blob = await storage.getBlob(id);
  if (!blob) return;
  const url   = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => {
    btn.textContent = '▶';
    URL.revokeObjectURL(url);
    listAudio = null; listPlayBtn = null;
  };
  audio.play();
  btn.textContent = '■';
  listAudio = audio; listPlayBtn = btn;
}

function stopListPreview() {
  if (listAudio)   { listAudio.pause(); listAudio = null; }
  if (listPlayBtn) { listPlayBtn.textContent = '▶'; listPlayBtn = null; }
}

async function confirmDelete(meta) {
  if (!confirm(`「${meta.name}」を削除しますか？`)) return;
  await storage.deletePhrase(meta.id);
  renderList();
}

// ══════════════════════════════════════════════════════════
// 共通ユーティリティ
// ══════════════════════════════════════════════════════════
const pad2 = (n) => String(n).padStart(2, '0');

function fmtSec(s) {
  const m = Math.floor(s / 60);
  return m > 0
    ? `${m}:${pad2(Math.floor(s % 60))}.${Math.floor((s % 1) * 10)}`
    : `${(s % 60).toFixed(1)}s`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function updateTimeDisplay(ms) {
  const s = Math.floor(ms / 1000);
  timeDisplay.textContent =
    `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}.${pad2(Math.floor((ms % 1000) / 10))}`;
}

function updateMeter(db) {
  const pct = ((Math.max(-70, Math.min(0, db)) + 70) / 70) * 100;
  meterFill.style.width = `${pct}%`;
  meterFill.style.backgroundColor =
    db < SILENCE_THRESHOLD_DB_DISPLAY ? '#444' :
    db < -20 ? '#4caf50' : db < -6 ? '#ff9800' : '#f44336';
}

function appendMarkItem(t) {
  const el = document.createElement('div');
  el.className   = 'mark-item';
  el.textContent = `● MARK  t = ${t.toFixed(1)}s`;
  markLog.prepend(el);
}

// ── WAV encoder ────────────────────────────────────────────
function encodeWAV(buffer, startSec, endSec) {
  const sr   = buffer.sampleRate;
  const s0   = Math.round(startSec * sr);
  const s1   = Math.min(Math.round(endSec * sr), buffer.length);
  const pcm  = buffer.getChannelData(0).slice(s0, s1);
  const len  = pcm.length;

  const i16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    i16[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
  }

  const dataSize = i16.byteLength;
  const wav  = new ArrayBuffer(44 + dataSize);
  const v    = new DataView(wav);
  const str  = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

  str(0,  'RIFF'); v.setUint32(4, 36 + dataSize, true);
  str(8,  'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);  v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  new Int16Array(wav, 44).set(i16);
  return new Blob([wav], { type: 'audio/wav' });
}

function makeFileName() {
  const n = new Date();
  return `licketch_${n.getFullYear()}${pad2(n.getMonth()+1)}${pad2(n.getDate())}_${pad2(n.getHours())}${pad2(n.getMinutes())}${pad2(n.getSeconds())}.wav`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ── Sound start detection ──────────────────────────────────
function findSoundStart(audioBuffer, fromSec, toSec) {
  const THRESHOLD = Math.pow(10, -45 / 20);
  const WIN_SEC   = 0.02;
  const SUSTAIN   = 3;
  const PREROLL   = 0.08;

  const sr   = audioBuffer.sampleRate;
  const data = audioBuffer.getChannelData(0);
  const win  = Math.round(WIN_SEC * sr);
  const from = Math.round(fromSec * sr);
  const to   = Math.min(Math.round(toSec * sr), data.length);

  let streak = 0, streakStart = fromSec;
  for (let i = from; i + win <= to; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) { const v = data[i + j]; sum += v * v; }
    if (Math.sqrt(sum / win) >= THRESHOLD) {
      if (streak === 0) streakStart = i / sr;
      if (++streak >= SUSTAIN) return Math.max(fromSec, streakStart - PREROLL);
    } else { streak = 0; }
  }
  return fromSec;
}
