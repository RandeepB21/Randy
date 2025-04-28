const canvas = document.getElementById("waveformCanvas");
const ctx = canvas.getContext("2d");

const amplitude = 100;
const frequency = 0.02;
const speed = 0.05;
let phaseShift = 0;

function drawWaveform() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#3498db";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);

  for (let x = 0; x < canvas.width; x++) {
    let y = amplitude * Math.sin(frequency * x + phaseShift) + canvas.height / 2;
    ctx.lineTo(x, y);
  }

  ctx.stroke();
  phaseShift += speed;
}

function animate() {
  drawWaveform();
  requestAnimationFrame(animate);
}

animate();
