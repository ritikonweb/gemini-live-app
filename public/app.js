// ========================================
// GEMINI LIVE APP — Frontend Logic
// Browser connects directly to Gemini Live API WebSocket
// Image generation via /api/generate-image
// ========================================

const $ = (sel) => document.querySelector(sel);
const app = $('#app');
const micBtn = $('#micBtn');
const micIcon = $('#micIcon');
const stopIcon = $('#stopIcon');
const orbWrapper = $('#orbWrapper');
const orbLabel = $('#orbLabel');
const statusPill = $('#statusPill');
const statusText = $('#statusText');
const imagePanel = $('#imagePanel');
const imageLoader = $('#imageLoader');
const generatedImage = $('#generatedImage');
const imageCaption = $('#imageCaption');
const transcriptContent = $('#transcriptContent');
const transcriptArea = $('#transcriptArea');

// ---- State ----
let geminiWs = null;
let captureCtx = null;
let playbackCtx = null;
let captureNode = null;
let playbackNode = null;
let mediaStream = null;
let isActive = false;
let apiKey = null;

const GEMINI_MODEL = 'models/gemini-2.0-flash-exp';
const VOICE = 'Puck';
const SYSTEM_INSTRUCTION = `You are a friendly, warm, and creative AI assistant with the ability to generate images. 
When a user asks you to draw, create, sketch, illustrate, paint, or generate any kind of image, picture, or illustration, 
you MUST call the generate_image function with a detailed, vivid prompt that captures exactly what the user wants.
Always acknowledge image requests warmly and naturally, like "Oh sure, let me create that for you!" or "Great idea, I'm drawing that now!"
After calling the function, describe what you created in a natural, conversational way.
Keep all your responses conversational, warm, and human-like. Be enthusiastic about creative requests.`;

const IMAGE_TOOL = {
  functionDeclarations: [{
    name: 'generate_image',
    description: 'Generate an image based on a text description. Call this whenever the user asks to draw, create, sketch, illustrate, paint, design, or generate any image, picture, artwork, or illustration.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'A detailed, vivid description of the image to generate. Include style, colors, composition, lighting, mood, and all specific details the user mentioned.'
        }
      },
      required: ['prompt']
    }
  }]
};

// ---- UI Helpers ----
function setState(state) {
  app.className = 'app ' + state;
  switch (state) {
    case '':
      statusPill.className = 'status-pill';
      statusText.textContent = 'Ready';
      orbLabel.textContent = 'Tap to start';
      break;
    case 'connecting':
      statusPill.className = 'status-pill';
      statusText.textContent = 'Connecting...';
      orbLabel.textContent = 'Connecting...';
      break;
    case 'listening':
      statusPill.className = 'status-pill connected listening';
      statusText.textContent = 'Listening';
      orbLabel.textContent = 'Listening...';
      break;
    case 'speaking':
      statusPill.className = 'status-pill connected speaking';
      statusText.textContent = 'Speaking';
      orbLabel.textContent = 'Speaking...';
      break;
    case 'connected':
      statusPill.className = 'status-pill connected';
      statusText.textContent = 'Connected';
      orbLabel.textContent = 'Speak anytime';
      break;
  }
}

function addTranscript(text, role) {
  if (!text.trim()) return;
  const last = transcriptContent.lastElementChild;
  if (last && last.dataset.role === role) {
    last.textContent += text;
  } else {
    const div = document.createElement('div');
    div.className = `transcript-msg ${role}`;
    div.dataset.role = role;
    div.textContent = text;
    transcriptContent.appendChild(div);
  }
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

// ---- Encoding Helpers ----
function int16ToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToInt16(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function int16ToFloat32(int16Array) {
  const float32 = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32[i] = int16Array[i] / 32768.0;
  }
  return float32;
}

// ---- Fetch API Key ----
async function fetchApiKey() {
  const res = await fetch('/api/config');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.apiKey;
}

// ---- Audio Setup ----
async function setupCapture() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  });

  captureCtx = new AudioContext({ sampleRate: 16000 });
  await captureCtx.audioWorklet.addModule('capture-processor.js');

  const source = captureCtx.createMediaStreamSource(mediaStream);
  captureNode = new AudioWorkletNode(captureCtx, 'capture-processor');

  captureNode.port.onmessage = (e) => {
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN && isActive) {
      const base64 = int16ToBase64(e.data);
      geminiWs.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/pcm;rate=16000',
            data: base64
          }]
        }
      }));
    }
  };

  source.connect(captureNode);
  captureNode.connect(captureCtx.destination);
}

async function setupPlayback() {
  playbackCtx = new AudioContext({ sampleRate: 24000 });
  await playbackCtx.audioWorklet.addModule('playback-processor.js');

  playbackNode = new AudioWorkletNode(playbackCtx, 'playback-processor');
  playbackNode.connect(playbackCtx.destination);

  playbackNode.port.onmessage = (e) => {
    if (e.data === 'playing') {
      setState('speaking');
    } else if (e.data === 'stopped') {
      if (isActive) setState('listening');
    }
  };
}

// ---- Image Generation via API Route ----
async function generateImage(prompt, callId) {
  showImageLoading(prompt);

  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await res.json();

    if (data.success && data.data) {
      showImage(data.data, data.mimeType, prompt);
      // Tell Gemini the image was generated
      sendToolResponse(callId, 'Image was generated and displayed to the user successfully.');
    } else {
      hideImageLoader();
      addTranscript(`[Could not generate image]`, 'assistant');
      sendToolResponse(callId, 'Image generation failed.');
    }
  } catch (err) {
    hideImageLoader();
    addTranscript(`[Image error: ${err.message}]`, 'assistant');
    sendToolResponse(callId, `Image generation failed: ${err.message}`);
  }
}

function sendToolResponse(callId, result) {
  if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
    geminiWs.send(JSON.stringify({
      toolResponse: {
        functionResponses: [{
          response: { result },
          id: callId
        }]
      }
    }));
  }
}

// ---- Connect Directly to Gemini Live API ----
function connectGemini() {
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  geminiWs = new WebSocket(wsUrl);

  geminiWs.onopen = () => {
    console.log('[✓] Connected to Gemini Live API');

    // Send setup message
    geminiWs.send(JSON.stringify({
      setup: {
        model: GEMINI_MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: VOICE }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        tools: [IMAGE_TOOL]
      }
    }));
  };

  geminiWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);

      // Setup complete
      if (msg.setupComplete) {
        console.log('[✓] Gemini setup complete');
        setState('listening');
        return;
      }

      // Tool calls (image generation)
      if (msg.toolCall) {
        for (const call of msg.toolCall.functionCalls) {
          if (call.name === 'generate_image') {
            console.log(`[🎨] Image requested: "${call.args.prompt}"`);
            generateImage(call.args.prompt, call.id);
          }
        }
        return;
      }

      // Server content (audio, transcripts)
      if (msg.serverContent) {
        const sc = msg.serverContent;

        if (sc.modelTurn && sc.modelTurn.parts) {
          for (const part of sc.modelTurn.parts) {
            if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
              // Play audio
              const int16 = base64ToInt16(part.inlineData.data);
              const float32 = int16ToFloat32(int16);
              playbackNode.port.postMessage(float32.buffer, [float32.buffer]);
            } else if (part.text) {
              addTranscript(part.text, 'assistant');
            }
          }
        }

        if (sc.turnComplete) {
          if (isActive) setState('listening');
        }

        if (sc.inputTranscription && sc.inputTranscription.text) {
          addTranscript(sc.inputTranscription.text, 'user');
        }

        if (sc.outputTranscription && sc.outputTranscription.text) {
          addTranscript(sc.outputTranscription.text, 'assistant');
        }
      }
    } catch (err) {
      console.error('[✗] Error processing Gemini message:', err);
    }
  };

  geminiWs.onerror = (err) => {
    console.error('[✗] Gemini WS error:', err);
    addTranscript('[Connection error]', 'assistant');
  };

  geminiWs.onclose = (e) => {
    console.log(`[–] Gemini WS closed: ${e.code}`);
    if (isActive) {
      // Reconnect
      setTimeout(() => { if (isActive) connectGemini(); }, 2000);
    }
  };
}

// ---- Image Display ----
function showImageLoading(prompt) {
  imagePanel.classList.add('visible');
  imageLoader.classList.add('active');
  generatedImage.classList.remove('loaded');
  imageCaption.classList.remove('visible');
}

function hideImageLoader() {
  imageLoader.classList.remove('active');
}

function showImage(base64Data, mimeType, prompt) {
  hideImageLoader();
  generatedImage.src = `data:${mimeType};base64,${base64Data}`;
  generatedImage.classList.add('loaded');
  imageCaption.textContent = prompt;
  imageCaption.classList.add('visible');
  imagePanel.classList.add('visible');
}

// ---- Start / Stop ----
async function start() {
  isActive = true;
  setState('connecting');
  micBtn.classList.add('active');
  micIcon.classList.add('hidden');
  stopIcon.classList.remove('hidden');

  try {
    // 1. Get API key
    if (!apiKey) {
      apiKey = await fetchApiKey();
    }

    // 2. Setup audio
    await setupCapture();
    await setupPlayback();

    // 3. Connect to Gemini directly
    connectGemini();
  } catch (err) {
    console.error('Start error:', err);
    alert('Failed to start: ' + err.message);
    stop();
  }
}

function stop() {
  isActive = false;
  setState('');
  micBtn.classList.remove('active');
  micIcon.classList.remove('hidden');
  stopIcon.classList.add('hidden');

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (captureCtx) {
    captureCtx.close();
    captureCtx = null;
    captureNode = null;
  }
  if (playbackCtx) {
    playbackCtx.close();
    playbackCtx = null;
    playbackNode = null;
  }
  if (geminiWs) {
    geminiWs.close();
    geminiWs = null;
  }
}

// ---- Event Listeners ----
micBtn.addEventListener('click', () => {
  if (isActive) stop(); else start();
});

orbWrapper.addEventListener('click', () => {
  if (!isActive) start();
});

// Wake lock
if ('wakeLock' in navigator) {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && isActive) {
      try { await navigator.wakeLock.request('screen'); } catch (e) {}
    }
  });
}

console.log('Gemini Live App loaded');
