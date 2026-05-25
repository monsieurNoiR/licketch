export class Waveform {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._peaks = [];
    this._marks = [];
    this._duration = 0;
    this._activeIndex = 0;
    this._trimStart = 0;
    this._trimEnd = 0;
    this._pxPerSec = 0;
    this._offsetX = 0; // scroll offset in px
    this._dragState = null; // { type: 'start'|'end'|'scroll', startX, startOffset }

    this.onTrimChange = null;

    this._canvas.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this._canvas.addEventListener('touchmove',  this._onTouchMove.bind(this),  { passive: false });
    this._canvas.addEventListener('touchend',   this._onTouchEnd.bind(this),   { passive: false });
    this._canvas.addEventListener('mousedown',  this._onMouseDown.bind(this));
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup',   this._onMouseUp.bind(this));
  }

  // ── Public API ────────────────────────────────────────────

  load(audioBuffer, marks) {
    this._duration = audioBuffer.duration;
    this._marks = marks.slice();
    this._peaks = this._calcPeaks(audioBuffer, 2000);
    this._resize();
  }

  setActive(index, segments) {
    this._activeIndex = index;
    const seg = segments[index];
    this._trimStart = seg.trimStart ?? seg.start;
    this._trimEnd   = seg.end;
    this._scrollToSegment(seg);
    this.draw(segments);
  }

  getTrim() {
    return { start: this._trimStart, end: this._trimEnd };
  }

  draw(segments) {
    const c = this._ctx;
    const W = this._canvas.width;
    const H = this._canvas.height;
    c.clearRect(0, 0, W, H);

    const pps = this._pxPerSec;
    const off = this._offsetX;

    // ── Background ──
    c.fillStyle = '#111';
    c.fillRect(0, 0, W, H);

    // ── Active segment background ──
    const seg = segments[this._activeIndex];
    const ax = seg.start * pps - off;
    const aw = (seg.end - seg.start) * pps;
    c.fillStyle = 'rgba(229,57,53,0.08)';
    c.fillRect(ax, 0, aw, H);

    // ── Trim region ──
    const tx = this._trimStart * pps - off;
    const tw = (this._trimEnd - this._trimStart) * pps;
    c.fillStyle = 'rgba(229,57,53,0.18)';
    c.fillRect(tx, 0, tw, H);

    // ── Waveform ──
    const mid = H / 2;
    const peakLen = this._peaks.length;
    c.fillStyle = '#4a4a4a';
    for (let i = 0; i < peakLen; i++) {
      const x = (i / peakLen) * this._duration * pps - off;
      if (x < -2 || x > W + 2) continue;
      const h = this._peaks[i] * mid * 0.9;
      c.fillRect(x, mid - h, 1.5, h * 2);
    }

    // Waveform tint for active segment
    c.fillStyle = '#888';
    for (let i = 0; i < peakLen; i++) {
      const tSec = (i / peakLen) * this._duration;
      if (tSec < seg.start || tSec > seg.end) continue;
      const x = tSec * pps - off;
      if (x < -2 || x > W + 2) continue;
      const h = this._peaks[i] * mid * 0.9;
      c.fillRect(x, mid - h, 1.5, h * 2);
    }

    // ── Mark lines ──
    this._marks.forEach((m, i) => {
      const x = m * pps - off;
      c.strokeStyle = i === this._activeIndex - 1 ? '#e53935' : '#555';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    });

    // ── Trim handles ──
    this._drawHandle(this._trimStart * pps - off, H, '#e53935');
    this._drawHandle(this._trimEnd   * pps - off, H, '#e53935');

    // ── Time ruler ──
    this._drawRuler(W, H, pps, off);
  }

  // ── Private ───────────────────────────────────────────────

  _resize() {
    const W = this._canvas.clientWidth  * window.devicePixelRatio;
    const H = this._canvas.clientHeight * window.devicePixelRatio;
    this._canvas.width  = W;
    this._canvas.height = H;
    // fit entire recording if it's short; otherwise 100px/sec min
    this._pxPerSec = Math.max(W / this._duration, 80) * window.devicePixelRatio;
  }

  _calcPeaks(audioBuffer, numPeaks) {
    const data = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(data.length / numPeaks);
    const peaks = new Float32Array(numPeaks);
    for (let i = 0; i < numPeaks; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        const v = Math.abs(data[start + j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  }

  _scrollToSegment(seg) {
    const W = this._canvas.width;
    const pps = this._pxPerSec;
    const segMid = (seg.start + seg.end) / 2 * pps;
    this._offsetX = Math.max(0, segMid - W / 2);
  }

  _drawHandle(x, H, color) {
    const c = this._ctx;
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, H);
    c.stroke();
    // Triangle grip
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x - 8, 0);
    c.lineTo(x + 8, 0);
    c.lineTo(x, 16);
    c.closePath();
    c.fill();
  }

  _drawRuler(W, H, pps, off) {
    const c = this._ctx;
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(0, H - 20, W, 20);
    c.fillStyle = '#666';
    c.font = `${10 * window.devicePixelRatio}px -apple-system, sans-serif`;
    c.textBaseline = 'middle';

    const step = this._rulerStep(pps);
    const startSec = Math.floor(off / pps / step) * step;
    for (let t = startSec; t < this._duration; t += step) {
      const x = t * pps - off;
      if (x > W) break;
      c.fillStyle = '#444';
      c.fillRect(x, H - 20, 1, 6);
      c.fillStyle = '#666';
      c.fillText(this._fmtTime(t), x + 3, H - 10);
    }
  }

  _rulerStep(pps) {
    const steps = [0.5, 1, 2, 5, 10, 30, 60];
    const minPx = 60 * window.devicePixelRatio;
    return steps.find(s => s * pps >= minPx) ?? 60;
  }

  _fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 ? `${m}:${String(s).padStart(2,'0')}` : `${s}s`;
  }

  // ── Touch / Mouse ─────────────────────────────────────────

  _pointerX(e) {
    const rect = this._canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return (clientX - rect.left) * window.devicePixelRatio;
  }

  _hitHandle(px) {
    const threshold = 16 * window.devicePixelRatio;
    const ts = this._trimStart * this._pxPerSec - this._offsetX;
    const te = this._trimEnd   * this._pxPerSec - this._offsetX;
    if (Math.abs(px - ts) < threshold) return 'start';
    if (Math.abs(px - te) < threshold) return 'end';
    return 'scroll';
  }

  _onTouchStart(e) { e.preventDefault(); this._startDrag(this._pointerX(e)); }
  _onTouchMove(e)  { e.preventDefault(); this._moveDrag(this._pointerX(e)); }
  _onTouchEnd(e)   { this._endDrag(); }
  _onMouseDown(e)  { this._startDrag(this._pointerX(e)); }
  _onMouseMove(e)  { if (this._dragState) this._moveDrag(this._pointerX(e)); }
  _onMouseUp()     { this._endDrag(); }

  _startDrag(px) {
    const type = this._hitHandle(px);
    this._dragState = { type, startX: px, startOffset: this._offsetX,
                        startTrimStart: this._trimStart, startTrimEnd: this._trimEnd };
  }

  _moveDrag(px) {
    if (!this._dragState) return;
    const dx = px - this._dragState.startX;
    const ds = dx / this._pxPerSec;

    if (this._dragState.type === 'scroll') {
      this._offsetX = Math.max(0, this._dragState.startOffset - dx);
    } else if (this._dragState.type === 'start') {
      this._trimStart = Math.max(0,
        Math.min(this._trimEnd - 0.1, this._dragState.startTrimStart + ds));
      if (this.onTrimChange) this.onTrimChange(this._trimStart, this._trimEnd);
    } else {
      this._trimEnd = Math.min(this._duration,
        Math.max(this._trimStart + 0.1, this._dragState.startTrimEnd + ds));
      if (this.onTrimChange) this.onTrimChange(this._trimStart, this._trimEnd);
    }
  }

  _endDrag() { this._dragState = null; }
}
