import { Recorder } from './recorder.js';
import { Analyzer }  from './analyzer.js';
import { Waveform }  from './waveform.js';

const SILENCE_THRESHOLD_DB_DISPLAY = -50;

// ── State ──────────────────────────────────────────────────
const recorder = new Recorder();
const analyzer  = new Analyzer();

let audioContext   = null;
let isRecording    = false;
let elapsedMs      = 0;
let timerInterval  = null;
let marks          = [];
let recordingBlob  = null;
let audioBuffer    = null;
let segments       = [];
let activeSegIdx   = 0;
let previewSource  = null;
let waveform       = null;

// ── DOM ────────────────────────────────────────────────────
const screenRecord = document.getElementById('screen-record');
const screenReview = document.getElementById('screen-review');

const btnRec      = document.getElementById('btn-rec');
const timeDisplay = document.getElementById('time-display');
const meterFill   = document.getElementById('meter-fill');
const markLog     = document.getElementById('mark-log');

const waveCanvas  = document.getElementById('waveform-canvas');
const segLabel    = document.getElementById('seg-label');
const trimInfo    = document.getElementById('trim-info');
const btnPlay     = document.getElementById('btn-play');
const btnPrev     = document.getElementById('btn-prev');
const btnNext     = document.getElementById('btn-next');
const btnSave     = document.getElementById('btn-save');
const btnBack     = document.getElementById('btn-back');
const btnReview   = document.getElementById('btn-review');

// ── Recording screen ───────────────────────────────────────
btnRec.addEventListener('click', async () => {
  if (!isRecording) await startRecording();
  else              await stopRecording();
});

async function startRecording() {
  btnReview.style.display = 'none';
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

    analyzer.onMark = (timeS) => {
      marks.push(timeS);
      appendMarkItem(timeS);
    };
    analyzer.onLevelUpdate = (db) => updateMeter(db);

    recorder.start(stream);
    analyzer.start(audioContext, stream);

    isRecording = true;
    btnRec.classList.add('recording');
    btnRec.textContent = 'STOP';

    timerInterval = setInterval(() => {
      elapsedMs += 100;
      updateTimeDisplay(elapsedMs);
    }, 100);
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
  btnReview.style.display = 'block';
}

// ── Review screen ──────────────────────────────────────────
async function enterReviewScreen() {
  // Decode audio
  const arrayBuf = await recordingBlob.arrayBuffer();
  audioBuffer = await audioContext.decodeAudioData(arrayBuf);

  // Build segments from marks
  const totalDur = audioBuffer.duration;
  const boundaries = [0, ...marks, totalDur];
  segments = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end   = boundaries[i + 1];
    const trimStart = findSoundStart(audioBuffer, start, end);
    segments.push({ start, end, trimStart });
  }
  // Drop segments shorter than 0.3s (likely noise at edges)
  const meaningful = segments.filter(s => s.end - s.trimStart >= 0.3);
  segments = meaningful.length > 0 ? meaningful : segments;

  activeSegIdx = 0;

  // Show review screen
  screenRecord.style.display = 'none';
  screenReview.style.display = 'flex';

  // Init waveform
  if (!waveform) {
    waveform = new Waveform(waveCanvas);
    waveform.onTrimChange = (s, e) => updateTrimInfo(s, e);
  }
  waveform.load(audioBuffer, marks);
  waveform.setActive(activeSegIdx, segments);

  updateSegLabel();
  const { start: ts, end: te } = waveform.getTrim();
  updateTrimInfo(ts, te);
  updateNavButtons();

  // Kick off draw loop
  drawLoop();
}

let rafDraw = null;
function drawLoop() {
  if (rafDraw) cancelAnimationFrame(rafDraw);
  function tick() {
    if (waveform && segments.length > 0) waveform.draw(segments);
    rafDraw = requestAnimationFrame(tick);
  }
  tick();
}

// ── Playback ───────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  if (previewSource) {
    stopPreview();
    btnPlay.textContent = '▶';
  } else {
    const { start, end } = waveform.getTrim();
    playPreview(start, end);
    btnPlay.textContent = '■';
  }
});

function playPreview(startSec, endSec) {
  stopPreview();
  const src = audioContext.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(audioContext.destination);
  src.start(0, startSec, endSec - startSec);
  src.onended = () => {
    previewSource = null;
    btnPlay.textContent = '▶';
  };
  previewSource = src;
}

function stopPreview() {
  if (previewSource) {
    try { previewSource.stop(); } catch (_) {}
    previewSource = null;
  }
}

// ── Navigation / Save ─────────────────────────────────────
btnPrev.addEventListener('click', () => {
  if (activeSegIdx === 0) return;
  stopPreview();
  moveToSegment(activeSegIdx - 1);
});

btnNext.addEventListener('click', () => {
  stopPreview();
  if (activeSegIdx >= segments.length - 1) {
    exitReviewScreen();
  } else {
    moveToSegment(activeSegIdx + 1);
  }
});

btnSave.addEventListener('click', () => {
  stopPreview();
  const { start, end } = waveform.getTrim();
  const wavBlob = encodeWAV(audioBuffer, start, end);
  downloadBlob(wavBlob, makeFileName());
  if (activeSegIdx >= segments.length - 1) {
    exitReviewScreen();
  } else {
    moveToSegment(activeSegIdx + 1);
  }
});

btnBack.addEventListener('click', () => {
  stopPreview();
  if (rafDraw) { cancelAnimationFrame(rafDraw); rafDraw = null; }
  screenReview.style.display = 'none';
  screenRecord.style.display = 'flex';
  if (audioBuffer) btnReview.style.display = 'block';
});

btnReview.addEventListener('click', () => {
  screenRecord.style.display = 'none';
  screenReview.style.display = 'flex';
  drawLoop();
});

function moveToSegment(idx) {
  activeSegIdx = idx;
  waveform.setActive(activeSegIdx, segments);
  updateSegLabel();
  const { start, end } = waveform.getTrim();
  updateTrimInfo(start, end);
  updateNavButtons();
  btnPlay.textContent = '▶';
}

function exitReviewScreen() {
  if (rafDraw) { cancelAnimationFrame(rafDraw); rafDraw = null; }
  screenReview.style.display = 'none';
  screenRecord.style.display = 'flex';
  btnReview.style.display = 'block';
}

// ── UI helpers ─────────────────────────────────────────────
function updateSegLabel() {
  segLabel.textContent = `${activeSegIdx + 1} / ${segments.length}`;
}

function updateNavButtons() {
  btnPrev.disabled = activeSegIdx === 0;
  btnNext.textContent = activeSegIdx >= segments.length - 1 ? '完了' : '次へ ▶';
}

function updateTrimInfo(start, end) {
  trimInfo.textContent = `${fmtSec(start)} → ${fmtSec(end)}  (${fmtSec(end - start)})`;
}

function fmtSec(s) {
  const m  = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1);
  return m > 0 ? `${m}:${String(Math.floor(s % 60)).padStart(2,'0')}.${((s % 1)*10).toFixed(0)}` : `${ss}s`;
}

function updateTimeDisplay(ms) {
  const total = Math.floor(ms / 1000);
  const min = String(Math.floor(total / 60)).padStart(2, '0');
  const sec = String(total % 60).padStart(2, '0');
  const cs  = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
  timeDisplay.textContent = `${min}:${sec}.${cs}`;
}

function updateMeter(db) {
  const pct = ((Math.max(-70, Math.min(0, db)) + 70) / 70) * 100;
  meterFill.style.width = `${pct}%`;
  meterFill.style.backgroundColor =
    db < SILENCE_THRESHOLD_DB_DISPLAY ? '#444' :
    db < -20 ? '#4caf50' :
    db < -6  ? '#ff9800' : '#f44336';
}

function appendMarkItem(timeS) {
  const item = document.createElement('div');
  item.className = 'mark-item';
  item.textContent = `● MARK  t = ${timeS.toFixed(1)}s`;
  markLog.prepend(item);
}

// ── WAV encoder ────────────────────────────────────────────
function encodeWAV(buffer, startSec, endSec) {
  const sr         = buffer.sampleRate;
  const startSamp  = Math.round(startSec * sr);
  const endSamp    = Math.min(Math.round(endSec * sr), buffer.length);
  const samples    = endSamp - startSamp;
  const pcm        = buffer.getChannelData(0).slice(startSamp, endSamp);

  const int16 = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
  }

  const headerSize = 44;
  const dataSize   = int16.byteLength;
  const wav        = new ArrayBuffer(headerSize + dataSize);
  const view       = new DataView(wav);

  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0,  'RIFF');
  view.setUint32(4,  36 + dataSize, true);
  writeStr(8,  'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);       // PCM chunk size
  view.setUint16(20, 1,  true);       // PCM format
  view.setUint16(22, 1,  true);       // mono
  view.setUint32(24, sr, true);       // sample rate
  view.setUint32(28, sr * 2, true);   // byte rate
  view.setUint16(32, 2,  true);       // block align
  view.setUint16(34, 16, true);       // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  new Int16Array(wav, headerSize).set(int16);
  return new Blob([wav], { type: 'audio/wav' });
}

function makeFileName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const d = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `licketch_${d}_${t}.wav`;
}

// Scan forward using 20ms RMS windows.
// Requires SUSTAIN_COUNT consecutive windows above threshold to confirm sound onset,
// preventing single-sample noise spikes from triggering early.
function findSoundStart(audioBuffer, fromSec, toSec) {
  const THRESHOLD_RMS = Math.pow(10, -45 / 20); // -45 dB RMS (stricter than silence threshold)
  const WINDOW_SEC    = 0.02;  // 20ms per window
  const SUSTAIN_COUNT = 3;     // 3 consecutive windows = 60ms sustained sound required
  const PREROLL_SEC   = 0.08;  // 80ms pre-roll to capture attack transient

  const sr         = audioBuffer.sampleRate;
  const data       = audioBuffer.getChannelData(0);
  const windowSamp = Math.round(WINDOW_SEC * sr);
  const from       = Math.round(fromSec * sr);
  const to         = Math.min(Math.round(toSec * sr), data.length);

  let streak         = 0;
  let streakStartSec = fromSec;

  for (let i = from; i + windowSamp <= to; i += windowSamp) {
    let sum = 0;
    for (let j = 0; j < windowSamp; j++) {
      const v = data[i + j];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / windowSamp);

    if (rms >= THRESHOLD_RMS) {
      if (streak === 0) streakStartSec = i / sr;
      streak++;
      if (streak >= SUSTAIN_COUNT) {
        return Math.max(fromSec, streakStartSec - PREROLL_SEC);
      }
    } else {
      streak = 0;
    }
  }
  return fromSec;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
