const asciiElement = document.getElementById("ascii-portrait");
const contactWordmarkText = document.getElementById("contact-wordmark-text");
const animationFrames = window.contactAnimationFrames ?? [];
const FPS = 24;
const INVERSION_RAMP =
  " .,:;i!lI~+_-?][}{)(|\\/tfrjxnuvczXYUJCLQO0mwqpdbkhao*#MW&8%B@";
const CONTACT_PREFIX = "Hi there! Send a pithy thought or two, and I’ll send one back to you: ";
const CONTACT_EMAIL = "wykwang@gmail.com";
const CONTACT_MESSAGE = `${CONTACT_PREFIX}${CONTACT_EMAIL}`;

let animationFrameId = 0;
let currentFrame = 0;
let lastFrameAt = 0;
let typingTimeoutId = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeAsciiFontSize() {
  if (!asciiElement || !animationFrames.length) return;

  const frameLines = animationFrames[0].split("\n");
  const columns = Math.max(...frameLines.map((line) => line.length));
  const rows = frameLines.length;
  const charWidthFactor = 0.6;
  const lineHeightFactor = 1;
  const verticalFont = window.innerHeight / (rows * lineHeightFactor);
  const horizontalFont = window.innerWidth / (columns * charWidthFactor);
  const fontSize = clamp(Math.min(verticalFont, horizontalFont) * 0.91, 2.1, 9.4);

  document.documentElement.style.setProperty("--ascii-font-size", `${fontSize}px`);
}

function displayFrame(index) {
  if (!asciiElement || !animationFrames.length) return;
  asciiElement.textContent = invertFrameTones(animationFrames[index]);
}

function invertFrameTones(frame) {
  let output = "";

  for (const char of frame) {
    const rampIndex = INVERSION_RAMP.indexOf(char);

    if (rampIndex === -1) {
      output += char;
      continue;
    }

    output += INVERSION_RAMP[INVERSION_RAMP.length - 1 - rampIndex];
  }

  return output;
}

function renderAnimation(now) {
  if (!asciiElement || !animationFrames.length) return;

  if (!lastFrameAt) lastFrameAt = now;
  if (now - lastFrameAt < 1000 / FPS) {
    animationFrameId = window.requestAnimationFrame(renderAnimation);
    return;
  }
  lastFrameAt = now;

  currentFrame = (currentFrame + 1) % animationFrames.length;
  displayFrame(currentFrame);
  animationFrameId = window.requestAnimationFrame(renderAnimation);
}

function initAsciiAnimation() {
  if (!asciiElement || !animationFrames.length) return;
  displayFrame(0);
  computeAsciiFontSize();
  animationFrameId = window.requestAnimationFrame(renderAnimation);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTypedWordmark(index) {
  if (!contactWordmarkText) return;

  const visiblePrefix = CONTACT_MESSAGE.slice(0, Math.min(index, CONTACT_PREFIX.length));
  const emailCount = Math.max(0, index - CONTACT_PREFIX.length);
  const visibleEmail = CONTACT_EMAIL.slice(0, emailCount);

  contactWordmarkText.innerHTML =
    `${escapeHtml(visiblePrefix)}<span class="contact-wordmark-email">${escapeHtml(visibleEmail)}</span>`;
}

function startContactTyping() {
  if (!contactWordmarkText) return;

  renderTypedWordmark(0);

  const typeNextCharacter = (index) => {
    renderTypedWordmark(index);

    if (index >= CONTACT_MESSAGE.length) {
      return;
    }

    const nextDelay =
      CONTACT_MESSAGE[index] === " "
        ? 32
        : /[,:@.]/.test(CONTACT_MESSAGE[index])
          ? 84
          : 46;

    typingTimeoutId = window.setTimeout(() => {
      typeNextCharacter(index + 1);
    }, nextDelay);
  };

  typeNextCharacter(0);
}

window.addEventListener("resize", computeAsciiFontSize);

initAsciiAnimation();
startContactTyping();

window.addEventListener("beforeunload", () => {
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId);
  }

  if (typingTimeoutId) {
    window.clearTimeout(typingTimeoutId);
  }
});
