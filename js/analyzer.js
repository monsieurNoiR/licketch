const SILENCE_THRESHOLD_DB = -50;
const SILENCE_DURATION_MS = 1500;

export class Analyzer {
  constructor() {
    this._analyser = null;
    this._source = null;
    this._rafId = null;
    this._silenceStartMs = null;
    this._marked = false;
    this._recordingStartMs = null;

    this.onMark = null;
    this.onLevelUpdate = null;
  }

  start(audioContext, stream) {
    this._recordingStartMs = performance.now();
    this._silenceStartMs = null;
    this._marked = false;

    this._analyser = audioContext.createAnalyser();
    this._analyser.fftSize = 1024;
    this._analyser.smoothingTimeConstant = 0.3;

    this._source = audioContext.createMediaStreamSource(stream);
    this._source.connect(this._analyser);

    const bufferLength = this._analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

    const tick = () => {
      this._analyser.getFloatTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;

      if (this.onLevelUpdate) this.onLevelUpdate(db);

      const now = performance.now();

      if (db < SILENCE_THRESHOLD_DB) {
        if (this._silenceStartMs === null) {
          this._silenceStartMs = now;
          this._marked = false;
        } else if (!this._marked && now - this._silenceStartMs >= SILENCE_DURATION_MS) {
          const markTimeS = (this._silenceStartMs - this._recordingStartMs) / 1000;
          console.log(`[MARK] t=${markTimeS.toFixed(1)}s`);
          if (this.onMark) this.onMark(markTimeS);
          this._marked = true;
        }
      } else {
        this._silenceStartMs = null;
        this._marked = false;
      }

      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._source) {
      this._source.disconnect();
      this._source = null;
    }
    this._analyser = null;
    this._silenceStartMs = null;
    this._marked = false;
    this._recordingStartMs = null;
  }
}
