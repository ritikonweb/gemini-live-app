// AudioWorklet processor for streaming audio playback
// Receives Float32 audio chunks and plays them back smoothly
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.currentChunk = null;
    this.readOffset = 0;
    this.isPlaying = false;

    this.port.onmessage = (e) => {
      if (e.data === 'clear') {
        this.chunks = [];
        this.currentChunk = null;
        this.readOffset = 0;
        return;
      }
      this.chunks.push(new Float32Array(e.data));
      if (!this.isPlaying) {
        this.isPlaying = true;
        this.port.postMessage('playing');
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;

    let written = 0;

    while (written < output.length) {
      // Get next chunk if needed
      if (!this.currentChunk || this.readOffset >= this.currentChunk.length) {
        if (this.chunks.length === 0) {
          // Silence for the rest
          for (let i = written; i < output.length; i++) {
            output[i] = 0;
          }
          if (this.isPlaying) {
            this.isPlaying = false;
            this.port.postMessage('stopped');
          }
          return true;
        }
        this.currentChunk = this.chunks.shift();
        this.readOffset = 0;
      }

      const available = this.currentChunk.length - this.readOffset;
      const needed = output.length - written;
      const toWrite = Math.min(available, needed);

      for (let i = 0; i < toWrite; i++) {
        output[written + i] = this.currentChunk[this.readOffset + i];
      }

      written += toWrite;
      this.readOffset += toWrite;
    }

    return true;
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
