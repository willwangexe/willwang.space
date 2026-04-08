const canvas = document.getElementById("starfield");
const ctx = canvas.getContext("2d");
const cursorGlow = document.querySelector(".cursor-glow");
const revealItems = document.querySelectorAll(".reveal");

const state = {
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  mouseX: window.innerWidth / 2,
  mouseY: window.innerHeight / 2,
  glowX: window.innerWidth / 2,
  glowY: window.innerHeight / 2,
  stars: [],
  ripples: [],
  bodies: [],
  blackHole: null,
  time: 0,
};

const STAR_LAYERS = [
  {
    countFactor: 0.05,
    minSize: 0.45,
    maxSize: 1.05,
    drift: 0.016,
    radial: 0.00022,
    parallax: 0.008,
    alphaMin: 0.18,
    alphaMax: 0.42,
    glowScale: 3.6,
  },
  {
    countFactor: 0.026,
    minSize: 0.9,
    maxSize: 1.8,
    drift: 0.032,
    radial: 0.00038,
    parallax: 0.016,
    alphaMin: 0.28,
    alphaMax: 0.62,
    glowScale: 4.8,
  },
  {
    countFactor: 0.011,
    minSize: 1.5,
    maxSize: 2.8,
    drift: 0.052,
    radial: 0.00058,
    parallax: 0.026,
    alphaMin: 0.42,
    alphaMax: 0.88,
    glowScale: 6.4,
  },
];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function resizeCanvas() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = state.width * state.dpr;
  canvas.height = state.height * state.dpr;
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  createStars();
  createBodies();
  createBlackHole();
}

function createStars() {
  state.stars = [];

  STAR_LAYERS.forEach((layer, layerIndex) => {
    const count = Math.round(
      Math.min(170, Math.max(22, state.width * layer.countFactor))
    );

    for (let i = 0; i < count; i += 1) {
      const x = Math.random() * state.width;
      const y = Math.random() * state.height;
      const dx = x - state.width / 2;
      const dy = y - state.height / 2;

      state.stars.push({
        layerIndex,
        x,
        y,
        originX: x,
        originY: y,
        baseRadius: Math.max(40, Math.hypot(dx, dy)),
        angle: Math.atan2(dy, dx),
        size: randomBetween(layer.minSize, layer.maxSize),
        alphaBase: randomBetween(layer.alphaMin, layer.alphaMax),
        driftX: (Math.random() - 0.5) * layer.drift,
        driftY: (Math.random() - 0.5) * layer.drift + layer.drift * 0.16,
        radialSpeed: randomBetween(layer.radial * 0.7, layer.radial * 1.35),
        parallax: layer.parallax,
        glowScale: layer.glowScale,
        twinkleSpeed: randomBetween(0.35, 1.15),
        twinkleOffset: Math.random() * Math.PI * 2,
        tint: Math.random() > 0.8 ? "cool" : "white",
        pulse: 0,
        pulseDecay: randomBetween(0.92, 0.965),
        pushX: 0,
        pushY: 0,
      });
    }
  });
}

function createBodies() {
  const base = Math.min(state.width, state.height);

  state.bodies = [
    {
      x: state.width * 0.17,
      y: state.height * 0.26,
      radius: base * 0.16,
      parallax: 0.006,
      driftX: 0.006,
      driftY: 0.002,
      glow: "rgba(78, 115, 255, 0.1)",
      inner: "rgba(58, 75, 132, 0.92)",
      outer: "rgba(16, 18, 26, 0.04)",
      rim: "rgba(153, 176, 255, 0.15)",
    },
    {
      x: state.width * 0.84,
      y: state.height * 0.72,
      radius: base * 0.1,
      parallax: 0.01,
      driftX: -0.004,
      driftY: 0.003,
      glow: "rgba(110, 220, 210, 0.07)",
      inner: "rgba(52, 88, 99, 0.88)",
      outer: "rgba(10, 14, 18, 0.03)",
      rim: "rgba(194, 241, 233, 0.12)",
    },
  ];
}

function createBlackHole() {
  state.blackHole = {
    x: state.width * 0.68,
    y: state.height * 0.34,
    radius: Math.min(state.width, state.height) * 0.055,
    influence: Math.min(state.width, state.height) * 0.22,
    parallax: 0.012,
  };
}

function wrapStar(star) {
  const margin = 60;

  if (star.x < -margin) star.x = state.width + margin;
  if (star.x > state.width + margin) star.x = -margin;
  if (star.y < -margin) star.y = state.height + margin;
  if (star.y > state.height + margin) star.y = -margin;
}

function drawNebula() {
  const driftX = (state.mouseX - state.width / 2) * 0.01;
  const driftY = (state.mouseY - state.height / 2) * 0.01;

  const nebulaA = ctx.createRadialGradient(
    state.width * 0.2 + driftX,
    state.height * 0.18 + driftY,
    0,
    state.width * 0.2 + driftX,
    state.height * 0.18 + driftY,
    state.width * 0.46
  );
  nebulaA.addColorStop(0, "rgba(66, 95, 255, 0.08)");
  nebulaA.addColorStop(0.35, "rgba(76, 58, 162, 0.045)");
  nebulaA.addColorStop(0.72, "rgba(8, 22, 38, 0.02)");
  nebulaA.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = nebulaA;
  ctx.fillRect(0, 0, state.width, state.height);

  const nebulaB = ctx.createRadialGradient(
    state.width * 0.76 - driftX * 0.75,
    state.height * 0.68 - driftY * 0.75,
    0,
    state.width * 0.76 - driftX * 0.75,
    state.height * 0.68 - driftY * 0.75,
    state.width * 0.4
  );
  nebulaB.addColorStop(0, "rgba(29, 174, 171, 0.06)");
  nebulaB.addColorStop(0.38, "rgba(26, 88, 110, 0.032)");
  nebulaB.addColorStop(0.7, "rgba(30, 16, 70, 0.022)");
  nebulaB.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = nebulaB;
  ctx.fillRect(0, 0, state.width, state.height);

  const nebulaC = ctx.createLinearGradient(0, 0, 0, state.height);
  nebulaC.addColorStop(0, "rgba(20, 18, 46, 0.14)");
  nebulaC.addColorStop(0.5, "rgba(0, 0, 0, 0)");
  nebulaC.addColorStop(1, "rgba(0, 10, 20, 0.12)");
  ctx.fillStyle = nebulaC;
  ctx.fillRect(0, 0, state.width, state.height);
}

function drawBodies() {
  const offsetX = state.mouseX - state.width / 2;
  const offsetY = state.mouseY - state.height / 2;

  state.bodies.forEach((body, index) => {
    body.x += body.driftX;
    body.y += body.driftY;

    const margin = body.radius * 1.5;
    if (body.x < -margin) body.x = state.width + margin;
    if (body.x > state.width + margin) body.x = -margin;
    if (body.y < -margin) body.y = state.height + margin;
    if (body.y > state.height + margin) body.y = -margin;

    const renderX = body.x + offsetX * body.parallax;
    const renderY = body.y + offsetY * body.parallax;

    const aura = ctx.createRadialGradient(
      renderX,
      renderY,
      body.radius * 0.8,
      renderX,
      renderY,
      body.radius * 2.8
    );
    aura.addColorStop(0, body.glow);
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(renderX, renderY, body.radius * 2.8, 0, Math.PI * 2);
    ctx.fill();

    const gradient = ctx.createRadialGradient(
      renderX - body.radius * 0.32,
      renderY - body.radius * 0.34,
      body.radius * 0.12,
      renderX,
      renderY,
      body.radius
    );
    gradient.addColorStop(0, body.rim);
    gradient.addColorStop(0.24, body.inner);
    gradient.addColorStop(0.78, "rgba(12, 14, 20, 0.9)");
    gradient.addColorStop(1, body.outer);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(renderX, renderY, body.radius, 0, Math.PI * 2);
    ctx.fill();

    if (index === 0) {
      ctx.strokeStyle = "rgba(180, 196, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(
        renderX,
        renderY + body.radius * 0.05,
        body.radius * 1.34,
        body.radius * 0.28,
        -0.3,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  });
}

function drawBlackHole() {
  const hole = state.blackHole;
  const offsetX = (state.mouseX - state.width / 2) * hole.parallax;
  const offsetY = (state.mouseY - state.height / 2) * hole.parallax;
  const x = hole.x + offsetX;
  const y = hole.y + offsetY;

  const halo = ctx.createRadialGradient(x, y, hole.radius * 0.6, x, y, hole.influence);
  halo.addColorStop(0, "rgba(24, 24, 34, 0.85)");
  halo.addColorStop(0.22, "rgba(55, 83, 148, 0.08)");
  halo.addColorStop(0.45, "rgba(92, 58, 161, 0.05)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, hole.influence, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(170, 192, 255, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, hole.radius * 1.95, hole.radius * 0.68, 0.18, 0, Math.PI * 2);
  ctx.stroke();

  const core = ctx.createRadialGradient(x, y, 0, x, y, hole.radius);
  core.addColorStop(0, "rgba(0, 0, 0, 0.98)");
  core.addColorStop(0.72, "rgba(4, 4, 8, 0.96)");
  core.addColorStop(1, "rgba(16, 18, 26, 0.2)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, hole.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawRipples() {
  state.ripples = state.ripples.filter((ripple) => ripple.life > 0.02);

  state.ripples.forEach((ripple) => {
    ripple.radius += ripple.speed;
    ripple.life *= 0.963;

    ctx.strokeStyle = `rgba(170, 195, 255, ${ripple.life * 0.18})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function updateStar(star) {
  const centerX = state.width / 2;
  const centerY = state.height / 2;
  const hole = state.blackHole;

  star.x += star.driftX;
  star.y += star.driftY;

  const dxCenter = star.x - centerX;
  const dyCenter = star.y - centerY;
  const radius = Math.hypot(dxCenter, dyCenter) + star.radialSpeed * Math.min(state.width, state.height);
  const angle = Math.atan2(dyCenter, dxCenter);
  star.x = centerX + Math.cos(angle) * radius;
  star.y = centerY + Math.sin(angle) * radius;

  star.pushX *= 0.93;
  star.pushY *= 0.93;
  star.pulse *= star.pulseDecay;

  wrapStar(star);

  const parallaxX = (state.mouseX - centerX) * star.parallax;
  const parallaxY = (state.mouseY - centerY) * star.parallax;
  let renderX = star.x + parallaxX + star.pushX;
  let renderY = star.y + parallaxY + star.pushY;

  const holeX = hole.x + (state.mouseX - centerX) * hole.parallax;
  const holeY = hole.y + (state.mouseY - centerY) * hole.parallax;
  const dxHole = renderX - holeX;
  const dyHole = renderY - holeY;
  const distHole = Math.hypot(dxHole, dyHole);

  if (distHole < hole.influence && distHole > hole.radius * 0.85) {
    const pull = 1 - distHole / hole.influence;
    const tangentX = -dyHole / distHole;
    const tangentY = dxHole / distHole;
    const warp = pull * pull * (star.layerIndex + 1) * 5.2;
    renderX += tangentX * warp - (dxHole / distHole) * pull * 1.2;
    renderY += tangentY * warp - (dyHole / distHole) * pull * 1.2;
    star.pulse = Math.max(star.pulse, pull * 0.25);
  }

  return { renderX, renderY };
}

function drawStars() {
  state.stars.forEach((star) => {
    const { renderX, renderY } = updateStar(star);
    const twinkle = 0.84 + Math.sin(state.time * star.twinkleSpeed + star.twinkleOffset) * 0.16;
    const pulseBoost = 1 + star.pulse;
    const alpha = Math.min(1, star.alphaBase * twinkle * pulseBoost);
    const glowRadius = star.size * star.glowScale * (1 + star.pulse * 0.8);

    const glow = ctx.createRadialGradient(renderX, renderY, 0, renderX, renderY, glowRadius);
    glow.addColorStop(0, `rgba(255,255,255,${alpha * 0.34})`);
    glow.addColorStop(
      0.42,
      star.tint === "cool"
        ? `rgba(156,188,255,${alpha * 0.16})`
        : `rgba(255,235,204,${alpha * 0.12})`
    );
    glow.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(renderX, renderY, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle =
      star.tint === "cool"
        ? `rgba(232,240,255,${alpha})`
        : `rgba(255,248,240,${alpha})`;
    ctx.beginPath();
    ctx.arc(renderX, renderY, star.size * pulseBoost, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawStarfield() {
  state.time += 0.016;
  ctx.clearRect(0, 0, state.width, state.height);

  drawNebula();
  drawBodies();
  drawStars();
  drawBlackHole();
  drawRipples();

  requestAnimationFrame(drawStarfield);
}

function updateCursorGlow() {
  state.glowX += (state.mouseX - state.glowX) * 0.14;
  state.glowY += (state.mouseY - state.glowY) * 0.14;

  if (cursorGlow) {
    cursorGlow.style.transform = `translate3d(${state.glowX}px, ${state.glowY}px, 0) translate(-50%, -50%)`;
  }

  requestAnimationFrame(updateCursorGlow);
}

function createRipple(x, y) {
  state.ripples.push({
    x,
    y,
    radius: 10,
    speed: 2.9,
    life: 1,
  });

  state.stars.forEach((star) => {
    const dx = star.x - x;
    const dy = star.y - y;
    const distance = Math.hypot(dx, dy);

    if (distance < 170) {
      const angle = Math.atan2(dy, dx);
      const force = Math.min(8, ((170 - distance) / 170) * (star.layerIndex + 1) * 3.2);
      star.pushX += Math.cos(angle) * force;
      star.pushY += Math.sin(angle) * force;
      star.pulse = Math.max(star.pulse, 0.7 - distance / 280);
    }
  });
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.16,
    rootMargin: "0px 0px -8% 0px",
  }
);

revealItems.forEach((item) => revealObserver.observe(item));

window.addEventListener("mousemove", (event) => {
  state.mouseX = event.clientX;
  state.mouseY = event.clientY;
});

window.addEventListener("click", (event) => {
  createRipple(event.clientX, event.clientY);
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
drawStarfield();
updateCursorGlow();
