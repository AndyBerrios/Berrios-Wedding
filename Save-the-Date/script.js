const card = document.getElementById("card");
const cardWrap = document.getElementById("cardWrap");

// -----------------------------
// State
// -----------------------------
let rotationY = 0;      // current card rotation in degrees
let velocityY = 0;      // rotational velocity
let pointerDown = false;
let animationFrame = null;

let lastX = 0;
let lastTime = 0;

// For flick velocity sampling
let samples = [];

// Tuning values
const DRAG_SENSITIVITY = 0.65;   // px to degrees while dragging
const FLICK_MULTIPLIER = 18;     // how much swipe speed turns into spin
const FRICTION = 0.965;          // lower = stops faster
const MIN_VELOCITY = 0.08;       // stop threshold
const TILT_MAX = 10;             // visual X tilt while dragging
const SNAP_SPEED = 0.12;         // how aggressively it settles at the end

// -----------------------------
// Helpers
// -----------------------------
function setTransform(tiltX = 0) {
  card.style.transform = `rotateX(${tiltX}deg) rotateY(${rotationY}deg)`;
}

function normalizeAngle(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

function shortestAngleDiff(from, to) {
  let diff = (to - from + 540) % 360 - 180;
  return diff;
}

function getNearestFaceAngle(angle) {
  const normalized = normalizeAngle(angle);
  const candidates = [0, 180, 360];
  let nearest = candidates[0];
  let bestDiff = Infinity;

  for (const candidate of candidates) {
    const diff = Math.abs(shortestAngleDiff(normalized, candidate));
    if (diff < bestDiff) {
      bestDiff = diff;
      nearest = candidate;
    }
  }

  // Return target in the same "rotation neighborhood"
  const baseTurns = Math.round(angle / 360) * 360;
  const options = [baseTurns, baseTurns + 180, baseTurns - 180, baseTurns + 360];
  let best = options[0];
  let min = Infinity;

  for (const option of options) {
    const diff = Math.abs(option - angle);
    if (diff < min) {
      min = diff;
      best = option;
    }
  }

  // Snap to nearest face among local 0/180 multiples
  const faceCandidates = [
    Math.round(angle / 360) * 360,
    Math.round((angle - 180) / 360) * 360 + 180
  ];

  let bestFace = faceCandidates[0];
  let bestFaceDiff = Infinity;

  for (const c of faceCandidates) {
    const diff = Math.abs(c - angle);
    if (diff < bestFaceDiff) {
      bestFaceDiff = diff;
      bestFace = c;
    }
  }

  return bestFace;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stopAnimation() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}

function pushSample(x, time) {
  samples.push({ x, time });

  // Keep only recent motion samples
  const cutoff = time - 120;
  samples = samples.filter((s) => s.time >= cutoff);
}

function getFlickVelocity() {
  if (samples.length < 2) return 0;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const dx = last.x - first.x;
  const dt = last.time - first.time;

  if (dt <= 0) return 0;
  return dx / dt; // px per ms
}

function animateInertia() {
  stopAnimation();

  function frame() {
    if (pointerDown) return;

    rotationY += velocityY;

    // natural slowing
    velocityY *= FRICTION;

    // once it's slow, gently settle to front/back
    if (Math.abs(velocityY) < 1.2) {
      const target = getNearestFaceAngle(rotationY);
      const diff = target - rotationY;
      velocityY += diff * SNAP_SPEED;
    }

    setTransform(0);

    if (Math.abs(velocityY) > MIN_VELOCITY) {
      animationFrame = requestAnimationFrame(frame);
    } else {
      // final snap
      rotationY = getNearestFaceAngle(rotationY);
      velocityY = 0;
      setTransform(0);
      stopAnimation();
    }
  }

  animationFrame = requestAnimationFrame(frame);
}

function getClientX(event) {
  if (event.touches && event.touches.length > 0) {
    return event.touches[0].clientX;
  }
  if (event.changedTouches && event.changedTouches.length > 0) {
    return event.changedTouches[0].clientX;
  }
  return event.clientX;
}

// -----------------------------
// Pointer / touch events
// -----------------------------
function startDrag(event) {
  pointerDown = true;
  stopAnimation();

  const now = performance.now();
  lastX = getClientX(event);
  lastTime = now;
  samples = [{ x: lastX, time: now }];

  if (card.setPointerCapture && event.pointerId !== undefined) {
    card.setPointerCapture(event.pointerId);
  }
}

function moveDrag(event) {
  if (!pointerDown) return;

  const x = getClientX(event);
  const now = performance.now();
  const dx = x - lastX;
  const dt = now - lastTime || 1;

  // update rotation based on drag
  rotationY += dx * DRAG_SENSITIVITY;

  // temporary tilt based on drag speed
  const tiltX = clamp(-(dx / dt) * 6, -TILT_MAX, TILT_MAX);
  setTransform(tiltX);

  lastX = x;
  lastTime = now;
  pushSample(x, now);

  // prevent page interaction while dragging
  event.preventDefault();
}

function endDrag(event) {
  if (!pointerDown) return;
  pointerDown = false;

  const flickVelocity = getFlickVelocity(); // px/ms
  velocityY = flickVelocity * FLICK_MULTIPLIER;

  // tiny flicks should still feel nice
  if (Math.abs(velocityY) < 0.6) {
    const target = getNearestFaceAngle(rotationY);
    velocityY = (target - rotationY) * 0.08;
  }

  animateInertia();
}

// Pointer events
card.addEventListener("pointerdown", startDrag);
window.addEventListener("pointermove", moveDrag, { passive: false });
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

// Touch fallback
card.addEventListener("touchstart", startDrag, { passive: true });
window.addEventListener("touchmove", moveDrag, { passive: false });
window.addEventListener("touchend", endDrag);
window.addEventListener("touchcancel", endDrag);

// Initial render
setTransform(0);