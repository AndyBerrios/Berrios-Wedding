// =============================================================
//  IMAGE CONFIGURATION
//  Replace the placeholder URLs with your actual image paths.
//  e.g. "images/front-1.jpg"  or a full URL from Canva export.
// =============================================================

const FRONT_IMAGES = [
  "images/front-1.JPG",   // shown first (index 0)
];

const BACK_IMAGE = "images/back.jpg";

// =============================================================
//  Setup
// =============================================================

const card     = document.getElementById("card");
const frontImg = document.getElementById("frontImg");
const backImg  = document.getElementById("backImg");

// Load the fixed back image once
backImg.src = BACK_IMAGE;

// Track which front image is currently shown
let frontIndex = 0;
frontImg.src = FRONT_IMAGES[frontIndex];

// How many full clockwise 360s have been completed (can be negative for CCW)
let cumulativeTurns = 0;

function setFrontImage(newIndex) {
  if (newIndex === frontIndex) return;
  frontIndex = newIndex;

  // Brief opacity dip for a smooth swap feel
  frontImg.classList.add("swap");
  setTimeout(() => {
    frontImg.src = FRONT_IMAGES[frontIndex];
    frontImg.classList.remove("swap");
  }, 120);
}

// =============================================================
//  Physics State
// =============================================================

let rotationY   = 0;      // current card Y rotation in degrees
let velocityY   = 0;      // degrees per frame
let pointerDown = false;
let animFrame   = null;

let lastX    = 0;
let lastTime = 0;
let samples  = [];        // recent {x, time} for flick detection

// Tuning
const DRAG_SENSITIVITY = 0.55;   // px → degrees while dragging
const FLICK_MULTIPLIER = 22;     // flick px/ms → degrees/frame spin
const FRICTION         = 0.275;  // momentum decay (higher = glides longer)
const SNAP_STRENGTH    = 0.09;   // pull toward nearest face when slow
const SNAP_THRESHOLD   = 1.8;    // velocity below this triggers snap pull
const STOP_THRESHOLD   = 0.04;   // velocity below this → hard stop
const TILT_MAX         = 12;     // max X tilt during drag (degrees)

// =============================================================
//  Helpers
// =============================================================

function applyTransform(tiltX = 0) {
  card.style.transform = `rotateX(${tiltX}deg) rotateY(${rotationY}deg)`;
}

// Returns the nearest "face" angle (multiple of 180) to the current rotation
function nearestFaceAngle(angle) {
  return Math.round(angle / 180) * 180;
}

// True when card is showing the front (rotationY near an even multiple of 360)
function isFrontVisible() {
  const n = ((rotationY % 360) + 360) % 360;
  return n < 90 || n >= 270;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function stopAnim() {
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
}

function pushSample(x, time) {
  samples.push({ x, time });
  const cutoff = time - 100;
  samples = samples.filter(s => s.time >= cutoff);
}

function flickVelocity() {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last  = samples[samples.length - 1];
  const dt    = last.time - first.time;
  if (dt <= 0) return 0;
  return (last.x - first.x) / dt; // px/ms
}

function getClientX(e) {
  if (e.touches?.length)        return e.touches[0].clientX;
  if (e.changedTouches?.length) return e.changedTouches[0].clientX;
  return e.clientX;
}

// =============================================================
//  Turn tracking — updates front image index
// =============================================================

// We track how many half-turns (180° crossings) have been made in each
// direction.  A full CW 360 = +2 half-turns; a full CCW 360 = -2 half-turns.
// Whenever the cumulative half-turns reach a new even number (full revolution),
// we advance or retreat the front image index.

let halfTurnCount = 0;           // net count of 180° crossings
let lastHalfTurnAngle = 0;       // last angle at which we registered a crossing

function checkTurnProgress() {
  // Number of half-turns completed from origin
  const newHalfTurns = Math.round(rotationY / 180);

  if (newHalfTurns === halfTurnCount) return;

  const delta = newHalfTurns - halfTurnCount;
  halfTurnCount = newHalfTurns;

  // A full revolution = 2 half-turns.  Every 2 CW half-turns → next image.
  // Every 2 CCW half-turns → previous image.
  // We use the cumulative half-turn count parity to determine when a full
  // revolution has completed and landed back on the FRONT face.

  // Only change image when landing on a front face (even multiple of 360)
  const fullTurns = Math.floor(newHalfTurns / 2);
  if (fullTurns !== cumulativeTurns) {
    const direction = fullTurns > cumulativeTurns ? 1 : -1;
    cumulativeTurns = fullTurns;

    const count = FRONT_IMAGES.length;
    const newIndex = ((frontIndex + direction) % count + count) % count;
    setFrontImage(newIndex);
  }
}

// =============================================================
//  Drag Handlers
// =============================================================

function onStart(e) {
  pointerDown = true;
  stopAnim();

  const now = performance.now();
  lastX    = getClientX(e);
  lastTime = now;
  samples  = [{ x: lastX, time: now }];

  if (card.setPointerCapture && e.pointerId != null) {
    card.setPointerCapture(e.pointerId);
  }
}

function onMove(e) {
  if (!pointerDown) return;
  e.preventDefault();

  const x   = getClientX(e);
  const now = performance.now();
  const dx  = x - lastX;
  const dt  = (now - lastTime) || 1;

  rotationY += dx * DRAG_SENSITIVITY;
  checkTurnProgress();

  // Subtle X tilt based on drag speed
  const tiltX = clamp(-(dx / dt) * 5, -TILT_MAX, TILT_MAX);
  applyTransform(tiltX);

  lastX    = x;
  lastTime = now;
  pushSample(x, now);
}

function onEnd() {
  if (!pointerDown) return;
  pointerDown = false;

  const fv = flickVelocity();          // px/ms
  velocityY = fv * FLICK_MULTIPLIER;

  // Tiny flick — ease gently to nearest face
  if (Math.abs(velocityY) < 0.8) {
    const target = nearestFaceAngle(rotationY);
    velocityY = (target - rotationY) * 0.1;
  }

  animateInertia();
}

// =============================================================
//  Inertia Animation
// =============================================================

function animateInertia() {
  stopAnim();

  function frame() {
    if (pointerDown) return;

    rotationY += velocityY;
    velocityY *= FRICTION;

    checkTurnProgress();

    // When slow enough, begin snapping to nearest face
    if (Math.abs(velocityY) < SNAP_THRESHOLD) {
      const target = nearestFaceAngle(rotationY);
      const diff   = target - rotationY;
      velocityY   += diff * SNAP_STRENGTH;

      // Critically damp once very close to avoid oscillation
      if (Math.abs(diff) < 0.5 && Math.abs(velocityY) < 0.15) {
        rotationY = target;
        velocityY = 0;
        applyTransform(0);
        return; // done
      }
    }

    applyTransform(0);

    if (Math.abs(velocityY) > STOP_THRESHOLD) {
      animFrame = requestAnimationFrame(frame);
    } else {
      rotationY = nearestFaceAngle(rotationY);
      velocityY = 0;
      applyTransform(0);
    }
  }

  animFrame = requestAnimationFrame(frame);
}

// =============================================================
//  Event Listeners
// =============================================================

card.addEventListener("pointerdown",  onStart);
window.addEventListener("pointermove",  onMove,  { passive: false });
window.addEventListener("pointerup",    onEnd);
window.addEventListener("pointercancel", onEnd);

// Touch fallback (iOS Safari)
card.addEventListener("touchstart", onStart, { passive: true });
window.addEventListener("touchmove",  onMove,  { passive: false });
window.addEventListener("touchend",   onEnd);
window.addEventListener("touchcancel", onEnd);

// Initial render
applyTransform(0);
