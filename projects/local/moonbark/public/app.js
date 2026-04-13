const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const dogNameEl = document.getElementById('dogName');
const humanMessageEl = document.getElementById('humanMessage');
const voiceSelectEl = document.getElementById('voiceSelect');
const metricsEl = document.getElementById('metrics');
const replyEl = document.getElementById('reply');
const intentEl = document.getElementById('intent');
const adviceEl = document.getElementById('advice');
const monologueEl = document.getElementById('monologue');
const replyAudio = document.getElementById('replyAudio');
const canvas = document.getElementById('waveform');
const ctx = canvas.getContext('2d');

let mediaRecorder;
let chunks = [];
let audioContext;
let analyser;
let dataArray;
let animationFrame;
let stream;

function drawWaveform() {
  if (!analyser) return;
  analyser.getByteTimeDomainData(dataArray);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#9be7ff');
  gradient.addColorStop(1, '#d2a8ff');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 3;
  ctx.beginPath();
  const sliceWidth = canvas.width / dataArray.length;
  let x = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();
  animationFrame = requestAnimationFrame(drawWaveform);
}

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function setLoadingState(isLoading, text) {
  statusEl.textContent = text;
  recordBtn.disabled = isLoading || !!mediaRecorder?.state && mediaRecorder.state === 'recording';
  stopBtn.disabled = !mediaRecorder || mediaRecorder.state !== 'recording';
}

function renderMetrics(features) {
  metricsEl.className = 'metrics';
  metricsEl.innerHTML = `
    <div class="metrics-grid">
      <div class="metric"><span>Excitement</span><strong>${features.excitement}</strong></div>
      <div class="metric"><span>Urgency</span><strong>${features.urgency}</strong></div>
      <div class="metric"><span>Bark bursts</span><strong>${features.barkBursts}</strong></div>
      <div class="metric"><span>Mood hint</span><strong>${features.moodHint}</strong></div>
    </div>
  `;
}

recordBtn.addEventListener('click', async () => {
  chunks = [];
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (event) => chunks.push(event.data);
  mediaRecorder.start();

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);
  source.connect(analyser);
  drawWaveform();

  setLoadingState(true, 'Listening to your dog...');
  recordBtn.disabled = true;
  stopBtn.disabled = false;
});

stopBtn.addEventListener('click', async () => {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  setLoadingState(true, 'Interpreting with Venice...');
  stopBtn.disabled = true;

  mediaRecorder.onstop = async () => {
    cancelAnimationFrame(animationFrame);
    stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const wavBlob = blob;
    const audioBase64 = await blobToBase64(wavBlob);

    const res = await fetch('/api/converse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        dogName: dogNameEl.value,
        humanMessage: humanMessageEl.value,
        transcriptText: 'Recorded live dog vocalization from browser microphone.',
        voice: voiceSelectEl?.value || 'am_echo'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || 'Something went wrong.';
      return;
    }

    renderMetrics(data.features);
    replyEl.className = 'reply';
    replyEl.textContent = data.interpretation.dogReplyText || '...';
    intentEl.textContent = `${data.interpretation.intentSummary} · tone: ${data.interpretation.emotionalTone}`;
    adviceEl.textContent = data.interpretation.humanAdvice || '—';
    monologueEl.textContent = data.interpretation.dogInnerMonologue || '—';

    replyAudio.src = `data:${data.replyAudioMimeType};base64,${data.replyAudioBase64}`;
    replyAudio.hidden = false;
    replyAudio.play().catch(() => {});
    statusEl.textContent = 'Conversation ready.';
    recordBtn.disabled = false;
  };
});

ctx.fillStyle = '#9be7ff';
ctx.font = '20px sans-serif';
ctx.fillText('Press record to begin.', 32, 110);
