const SUPPORTED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export class Recorder {
  constructor() {
    this._mediaRecorder = null;
    this._chunks = [];
    this._stream = null;
  }

  async getStream() {
    if (this._stream) return this._stream;
    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return this._stream;
  }

  start(stream) {
    this._chunks = [];
    const mimeType = SUPPORTED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const options = mimeType ? { mimeType } : {};

    this._mediaRecorder = new MediaRecorder(stream, options);
    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._mediaRecorder.start(100);

    console.log(`[REC] start — mimeType: ${this._mediaRecorder.mimeType}`);
  }

  stop() {
    return new Promise((resolve) => {
      this._mediaRecorder.onstop = () => {
        const type = this._mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(this._chunks, { type });
        this._chunks = [];
        console.log(`[REC] stop — ${type}, ${blob.size} bytes`);
        resolve(blob);
      };
      this._mediaRecorder.stop();
    });
  }
}
