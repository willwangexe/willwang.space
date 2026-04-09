import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const backgroundCanvas = document.getElementById("scene-canvas");
const planetCanvas = document.getElementById("planet-canvas");
const objectCanvas = document.getElementById("object-canvas");
const navAnnotations = document.getElementById("nav-annotations");
const overlay = document.getElementById("overlay");
const overlayClose = document.getElementById("overlay-close");
const overlayTitle = document.getElementById("overlay-title");
const overlayBody = document.getElementById("overlay-body");

const backgroundRenderer = new THREE.WebGLRenderer({
  canvas: backgroundCanvas,
  antialias: true,
  alpha: true,
});
backgroundRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
backgroundRenderer.setSize(window.innerWidth, window.innerHeight);

const planetRenderer = new THREE.WebGLRenderer({
  canvas: planetCanvas,
  antialias: true,
  alpha: true,
});
planetRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
planetRenderer.setSize(window.innerWidth, window.innerHeight);

const objectRenderer = new THREE.WebGLRenderer({
  canvas: objectCanvas,
  antialias: true,
  alpha: true,
});
objectRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
objectRenderer.setSize(window.innerWidth, window.innerHeight);

const backgroundScene = new THREE.Scene();
backgroundScene.fog = new THREE.FogExp2(0x050814, 0.00095);

const planetScene = new THREE.Scene();
planetScene.fog = new THREE.FogExp2(0x050814, 0.00095);

const objectScene = new THREE.Scene();
objectScene.fog = new THREE.FogExp2(0x050814, 0.00095);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  2200
);
camera.position.z = 6;

const mouse = { x: 0, y: 0 };
const pointer = { x: 0, y: 0 };
const pulse = { value: 0 };
const thrust = { value: 0, target: 0 };
const warp = { value: 0, target: 0 };
const pointerNdc = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const focusState = {
  active: false,
  amount: 0,
  targetAmount: 0,
  object: null,
};
const hoverCinematic = {
  amount: 0,
  object: null,
  releaseAt: 0,
};
const hoveredState = {
  object: null,
  annotationId: null,
};
const pointerState = {
  insideWindow: false,
  lastMoveAt: 0,
  clientX: window.innerWidth * 0.5,
  clientY: window.innerHeight * 0.5,
};

const starCount = 5000;
const starGeometry = new THREE.BufferGeometry();
const positions = new Float32Array(starCount * 3);
const scales = new Float32Array(starCount);
const baseX = new Float32Array(starCount);
const baseY = new Float32Array(starCount);
const driftOffset = new Float32Array(starCount);
const driftRadius = new Float32Array(starCount);
const depthLayer = new Float32Array(starCount);

function createGlowTexture(stops) {
  const size = 256;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const textureContext = textureCanvas.getContext("2d");
  const gradient = textureContext.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );

  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));

  textureContext.fillStyle = gradient;
  textureContext.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.needsUpdate = true;
  return texture;
}

function createPlanetTexture(palette) {
  const size = 768;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");

  context.fillStyle = palette.base;
  context.fillRect(0, 0, size, size);

  const bands = palette.bands ?? [];
  bands.forEach((band, index) => {
    const y = size * (0.08 + (index / Math.max(1, bands.length)) * 0.84);
    const bandHeight = size * (0.07 + (index % 3) * 0.018);
    const gradient = context.createLinearGradient(0, y - bandHeight, size, y + bandHeight);
    gradient.addColorStop(0, `${band}00`);
    gradient.addColorStop(0.18, band);
    gradient.addColorStop(0.5, palette.bandSoft ?? band);
    gradient.addColorStop(0.82, band);
    gradient.addColorStop(1, `${band}00`);
    context.fillStyle = gradient;
    context.fillRect(0, y - bandHeight, size, bandHeight * 2);
  });

  const spots = palette.spots ?? [];
  spots.forEach((spot) => {
    const gradient = context.createRadialGradient(
      size * spot.x,
      size * spot.y,
      0,
      size * spot.x,
      size * spot.y,
      size * spot.radius
    );
    gradient.addColorStop(0, spot.color);
    gradient.addColorStop(0.5, `${spot.color}99`);
    gradient.addColorStop(1, `${spot.color}00`);
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(size * spot.x, size * spot.y, size * spot.radius, 0, Math.PI * 2);
    context.fill();
  });

  const noise = context.getImageData(0, 0, size, size);
  for (let i = 0; i < noise.data.length; i += 4) {
    const grain = (Math.random() - 0.5) * palette.noise;
    noise.data[i] = Math.max(0, Math.min(255, noise.data[i] + grain));
    noise.data[i + 1] = Math.max(0, Math.min(255, noise.data[i + 1] + grain));
    noise.data[i + 2] = Math.max(0, Math.min(255, noise.data[i + 2] + grain));
  }
  context.putImageData(noise, 0, 0);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function blendColors(colorA, colorB, amount) {
  const a = new THREE.Color(colorA);
  const b = new THREE.Color(colorB);
  return a.lerp(b, amount);
}

function sampleNoise2D(x, y, seed) {
  return (
    Math.sin(x * 5.7 + seed * 1.13) * 0.5 +
    Math.cos(y * 6.3 - seed * 0.91) * 0.3 +
    Math.sin((x + y) * 9.8 + seed * 1.73) * 0.2
  );
}

function sampleFractalNoise(x, y, seed) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let totalAmplitude = 0;

  for (let i = 0; i < 4; i += 1) {
    value += sampleNoise2D(x * frequency, y * frequency, seed + i * 1.37) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / totalAmplitude;
}

function createEarthTexture() {
  const size = 768;
  const seed = Math.random() * 10;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  const imageData = context.createImageData(size, size);

  const deepOcean = new THREE.Color("#0b2f66");
  const shallowOcean = new THREE.Color("#1f5fa8");
  const coast = new THREE.Color("#7c8f55");
  const lowland = new THREE.Color("#5f8e47");
  const highland = new THREE.Color("#7a6a46");
  const mountain = new THREE.Color("#9b8d72");
  const ice = new THREE.Color("#dfe8ea");

  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    const latitude = Math.abs(v - 0.5) * 2;

    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const largeShape = sampleFractalNoise(u * 1.2, v * 1.2, seed);
      const terrain = sampleFractalNoise(u * 3.8, v * 3.8, seed + 10);
      const fineDetail = sampleFractalNoise(u * 9.5, v * 9.5, seed + 20);
      const heightValue = largeShape * 0.65 + terrain * 0.25 + fineDetail * 0.1;

      let color;

      if (heightValue < -0.05) {
        const oceanDepth = smoothstep(-0.55, -0.05, heightValue);
        color = deepOcean.clone().lerp(shallowOcean, oceanDepth);
      } else {
        const coastBlend = smoothstep(-0.02, 0.08, heightValue);
        const elevationBlend = smoothstep(0.08, 0.45, heightValue);
        color = coast.clone().lerp(lowland, coastBlend * 0.75);
        color.lerp(highland, elevationBlend * 0.7);
        color.lerp(mountain, smoothstep(0.35, 0.7, heightValue) * 0.6);
      }

      if (latitude > 0.72) {
        const iceBlend = smoothstep(0.72, 0.96, latitude) * 0.85;
        color.lerp(ice, iceBlend);
      }

      const warmth = sampleFractalNoise(u * 5.4, v * 2.8, seed + 30);
      color.lerp(blendColors("#2f4f28", "#8a6d42", 0.5), Math.max(0, warmth) * 0.06);

      const index = (y * size + x) * 4;
      imageData.data[index] = Math.round(color.r * 255);
      imageData.data[index + 1] = Math.round(color.g * 255);
      imageData.data[index + 2] = Math.round(color.b * 255);
      imageData.data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMarsTexture() {
  const size = 768;
  const seed = Math.random() * 10;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  const imageData = context.createImageData(size, size);

  const darkRust = new THREE.Color("#9d6038");
  const midRust = new THREE.Color("#c27846");
  const dustyOrange = new THREE.Color("#d98a4f");
  const paleDust = new THREE.Color("#e4b487");
  const shadowRock = new THREE.Color("#8a5938");

  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const largeShape = sampleFractalNoise(u * 1.8, v * 1.8, seed);
      const terrain = sampleFractalNoise(u * 5.4, v * 5.4, seed + 10);
      const fineDetail = sampleFractalNoise(u * 11.2, v * 11.2, seed + 20);
      const heightValue = largeShape * 0.52 + terrain * 0.33 + fineDetail * 0.15;

      const color = darkRust.clone().lerp(midRust, smoothstep(-0.45, 0.05, heightValue) * 0.95);
      color.lerp(dustyOrange, smoothstep(-0.05, 0.42, heightValue) * 0.92);
      color.lerp(paleDust, smoothstep(0.28, 0.72, heightValue) * 0.58);
      color.lerp(shadowRock, smoothstep(-0.65, -0.12, heightValue) * 0.08);

      const dustBands = sampleFractalNoise(u * 8.5, v * 2.4, seed + 30);
      color.lerp(dustyOrange, Math.max(0, dustBands) * 0.1);

      const index = (y * size + x) * 4;
      imageData.data[index] = Math.round(color.r * 255);
      imageData.data[index + 1] = Math.round(color.g * 255);
      imageData.data[index + 2] = Math.round(color.b * 255);
      imageData.data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createVenusTexture() {
  const size = 768;
  const seed = Math.random() * 10;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  const imageData = context.createImageData(size, size);

  const cream = new THREE.Color("#efe0bd");
  const paleYellow = new THREE.Color("#e4cf98");
  const warmHaze = new THREE.Color("#d7b17b");
  const lightOrange = new THREE.Color("#cfa273");
  const softShadow = new THREE.Color("#b58f68");

  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const broadClouds = sampleFractalNoise(u * 1.6, v * 1.6, seed);
      const softBands = sampleFractalNoise(u * 3.2, v * 1.4, seed + 10);
      const fineClouds = sampleFractalNoise(u * 6.4, v * 4.2, seed + 20);
      const cloudValue = broadClouds * 0.5 + softBands * 0.32 + fineClouds * 0.18;

      const color = cream.clone().lerp(paleYellow, smoothstep(-0.5, 0.15, cloudValue) * 0.6);
      color.lerp(warmHaze, smoothstep(-0.05, 0.45, cloudValue) * 0.4);
      color.lerp(lightOrange, smoothstep(0.2, 0.65, cloudValue) * 0.22);
      color.lerp(softShadow, smoothstep(-0.7, -0.15, cloudValue) * 0.18);

      const index = (y * size + x) * 4;
      imageData.data[index] = Math.round(color.r * 255);
      imageData.data[index + 1] = Math.round(color.g * 255);
      imageData.data[index + 2] = Math.round(color.b * 255);
      imageData.data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createNeptuneTexture() {
  const size = 768;
  const seed = Math.random() * 10;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  const imageData = context.createImageData(size, size);

  const deepBlue = new THREE.Color("#3466a8");
  const midBlue = new THREE.Color("#4e84c7");
  const paleBlue = new THREE.Color("#9cc7f2");
  const stormBlue = new THREE.Color("#5b8fcc");
  const cloudWhite = new THREE.Color("#d9ecff");

  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const broadBands = sampleFractalNoise(u * 0.6, v * 4.6, seed);
      const softFlow = sampleFractalNoise(u * 2.2, v * 7.2, seed + 10);
      const fineBands = sampleFractalNoise(u * 1.4, v * 12.0, seed + 20);
      const bandValue = broadBands * 0.52 + softFlow * 0.28 + fineBands * 0.2;

      const color = deepBlue.clone().lerp(midBlue, smoothstep(-0.5, 0.05, bandValue) * 0.82);
      color.lerp(paleBlue, smoothstep(0.08, 0.45, bandValue) * 0.42);
      color.lerp(stormBlue, smoothstep(-0.75, -0.2, bandValue) * 0.14);
      color.lerp(cloudWhite, smoothstep(0.22, 0.62, bandValue) * 0.16);

      const index = (y * size + x) * 4;
      imageData.data[index] = Math.round(color.r * 255);
      imageData.data[index + 1] = Math.round(color.g * 255);
      imageData.data[index + 2] = Math.round(color.b * 255);
      imageData.data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function centeredRandom(spread) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.pow(Math.random(), 1.35);

  return {
    x: Math.cos(angle) * spread.x * radius,
    y: Math.sin(angle) * spread.y * radius,
  };
}

function randomNavSpawnPosition(z) {
  const distance = Math.max(1, camera.position.z - z);
  const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
  const viewWidth = viewHeight * camera.aspect;
  const halfWidth = viewWidth * 0.5;
  const halfHeight = viewHeight * 0.5;
  const side = Math.random() < 0.5 ? -1 : 1;
  const x = side * THREE.MathUtils.lerp(halfWidth * 0.06, halfWidth * 0.2, Math.random());
  const y = isCompactViewport()
    ? THREE.MathUtils.lerp(halfHeight * 0.04, halfHeight * 0.28, Math.random())
    : (Math.random() - 0.5) * halfHeight * 0.24;

  return { x, y };
}

function randomDecorAsteroidPosition(z) {
  const distance = Math.max(1, camera.position.z - z);
  const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
  const viewWidth = viewHeight * camera.aspect;
  const halfWidth = viewWidth * 0.5;
  const halfHeight = viewHeight * 0.5;
  const side = Math.random() < 0.5 ? -1 : 1;

  return {
    x: side * THREE.MathUtils.lerp(halfWidth * 0.16, halfWidth * 0.34, Math.random()),
    y: (Math.random() - 0.5) * halfHeight * 0.22,
  };
}

function isCompactViewport() {
  return window.innerWidth <= 1024;
}

for (let i = 0; i < starCount; i += 1) {
  const i3 = i * 3;
  const x = (Math.random() - 0.5) * 900;
  const y = (Math.random() - 0.5) * 560;
  positions[i3] = x;
  positions[i3 + 1] = y;
  positions[i3 + 2] = -Math.random() * 2000;
  scales[i] = Math.random();
  baseX[i] = x;
  baseY[i] = y;
  driftOffset[i] = Math.random() * Math.PI * 2;
  driftRadius[i] = 0.4 + Math.random() * 2.2;
  depthLayer[i] = 0.35 + scales[i] * 0.9;
}

starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
starGeometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));

const starMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uViewportHeight: { value: window.innerHeight * Math.min(window.devicePixelRatio, 2) },
  },
  vertexShader: `
    attribute float aScale;
    uniform float uTime;
    uniform float uViewportHeight;
    varying float vAlpha;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      float pointScale = uViewportHeight * 0.23;
      gl_PointSize = min((2.0 + aScale * 3.6) * (pointScale / -mvPosition.z), 9.6);
      float viewDistance = -mvPosition.z;
      float twinkleBand = smoothstep(1250.0, 1850.0, viewDistance);
      float twinkleMask = step(
        0.825,
        fract(sin(dot(position.xy + vec2(aScale * 17.0, position.z * 0.01), vec2(12.9898, 78.233))) * 43758.5453)
      );
      float twinkle = sin(uTime * 0.42 + aScale * 12.0) * 0.08 * twinkleBand * twinkleMask;
      vAlpha = (0.3 + aScale * 0.36 + twinkle) * 1.44;
    }
  `,
  fragmentShader: `
    varying float vAlpha;

    void main() {
      vec2 coord = gl_PointCoord - vec2(0.5);
      float dist = length(coord);
      float glow = smoothstep(0.5, 0.0, dist);
      vec3 color = mix(vec3(0.72, 0.8, 1.0), vec3(1.0), 0.55);
      gl_FragColor = vec4(color, glow * vAlpha);
    }
  `,
});

const stars = new THREE.Points(starGeometry, starMaterial);
backgroundScene.add(stars);

const shootingStars = Array.from({ length: 4 }, () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xdbe5ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  backgroundScene.add(line);

  return {
    active: false,
    nextAt: 2.16 + Math.random() * 4.34,
    start: 0,
    duration: 0.55,
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    geometry,
    material,
  };
});
let lastShootingStarAt = -Infinity;
const clock = new THREE.Clock();
const backPlanetGroup = new THREE.Group();
const frontPlanetGroup = new THREE.Group();
const backDecorGroup = new THREE.Group();
const frontDecorGroup = new THREE.Group();
planetScene.add(backPlanetGroup);
planetScene.add(backDecorGroup);
objectScene.add(frontPlanetGroup);
objectScene.add(frontDecorGroup);

function createCelestialBody(definition) {
  const geometry = new THREE.IcosahedronGeometry(1, definition.detail);
  const positionAttribute = geometry.attributes.position;
  const colorBuffer = new Float32Array(positionAttribute.count * 3);
  const color = new THREE.Color();
  const baseColor = new THREE.Color(definition.baseColor);
  const darkColor = new THREE.Color(definition.darkColor);
  const lightColor = new THREE.Color(definition.lightColor);
  const scratchColor = new THREE.Color(definition.scratchColor);
  const vector = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const axisScale = definition.axisScale ?? { x: 1, y: 1, z: 1 };
  const ridgeStrength = definition.ridgeStrength ?? 0;
  const lobeStrength = definition.lobeStrength ?? 0;
  const pinchStrength = definition.pinchStrength ?? 0;
  const shapeProfile = definition.shapeProfile ?? "potato";
  const endBulgeStrength = definition.endBulgeStrength ?? 0;
  const waistPinchStrength = definition.waistPinchStrength ?? 0;
  const equatorBulgeStrength = definition.equatorBulgeStrength ?? 0;
  const polePinchStrength = definition.polePinchStrength ?? 0;
  const asymmetryStrength = definition.asymmetryStrength ?? 0;

  for (let i = 0; i < positionAttribute.count; i += 1) {
    vector.fromBufferAttribute(positionAttribute, i);
    vector.set(
      vector.x * axisScale.x,
      vector.y * axisScale.y,
      vector.z * axisScale.z
    );
    normal.copy(vector).normalize();

    const grain =
      Math.sin(normal.x * definition.noiseScaleA + definition.seed) *
        Math.cos(normal.y * definition.noiseScaleB - definition.seed * 0.7) *
        Math.sin(normal.z * definition.noiseScaleC + definition.seed * 1.3);
    const crater =
      Math.sin((normal.x + normal.y * 0.6 - normal.z * 0.4) * definition.craterScale + definition.seed * 2.1) *
      0.5 +
      0.5;
    const ridge =
      Math.sin((normal.x - normal.y * 0.45 + normal.z * 0.3) * (definition.craterScale * 0.75) + definition.seed) *
      ridgeStrength;
    const lobes =
      Math.sin((normal.x * 1.7 + normal.y * 0.9 - normal.z * 1.1) * (definition.craterScale * 0.52) + definition.seed * 1.4) *
      lobeStrength;
    const pinch =
      (Math.abs(normal.y) - 0.5) *
      pinchStrength;
    let profileWarp = 0;

    if (shapeProfile === "dogbone") {
      const alongBody = Math.abs(normal.z);
      const endBulge = smoothstep(0.18, 0.92, alongBody) * endBulgeStrength;
      const waistPinch = (1.0 - smoothstep(0.0, 0.45, alongBody)) * waistPinchStrength;
      profileWarp += endBulge - waistPinch;
    } else if (shapeProfile === "top") {
      const equatorBulge = (1.0 - Math.abs(normal.y)) * equatorBulgeStrength;
      const polePinch = Math.max(0, -normal.y) * polePinchStrength + Math.max(0, normal.y) * polePinchStrength * 0.4;
      profileWarp += equatorBulge - polePinch + normal.y * asymmetryStrength;
    } else {
      profileWarp +=
        Math.sin((normal.x * 2.2 - normal.z * 1.6 + normal.y) * definition.craterScale * 0.35 + definition.seed) *
        0.06;
    }
    const displacement =
      1 +
      grain * definition.bumpiness +
      (crater - 0.5) * definition.craterDepth +
      ridge +
      lobes -
      pinch +
      profileWarp;

    vector.multiplyScalar(displacement);
    positionAttribute.setXYZ(i, vector.x, vector.y, vector.z);

    color.copy(baseColor);
    color.lerp(darkColor, 0.38 + Math.max(0, -normal.y) * 0.24);
    color.lerp(lightColor, Math.max(0, normal.x) * 0.22 + Math.max(0, normal.z) * 0.14);
    color.lerp(scratchColor, Math.max(0, grain) * 0.12 + crater * 0.08);

    colorBuffer[i * 3] = color.r;
    colorBuffer[i * 3 + 1] = color.g;
    colorBuffer[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colorBuffer, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: definition.roughness,
    metalness: definition.metalness,
    flatShading: definition.flatShading,
    transparent: false,
    opacity: 1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    ...definition,
    hovered: 0,
    screen: new THREE.Vector3(),
    labelProgress: 0,
    labelReadyAt: 0,
    baseRotationX: (Math.random() - 0.5) * 0.8,
    baseRotationY: (Math.random() - 0.5) * 0.8,
    spinSpeedX: 0.05 + Math.random() * 0.08,
    spinSpeedY: 0.04 + Math.random() * 0.07,
  };

  mesh.rotation.set(
    mesh.userData.baseRotationX,
    mesh.userData.baseRotationY,
    Math.random() * Math.PI * 2
  );
  return mesh;
}

const planetPalettes = [
  {
    name: "earth",
    base: "#2f5578",
    bandSoft: "#7390a6",
    bands: ["#7aa273", "#3f6f8f", "#9fc0d1", "#446b44"],
    spots: [
      { x: 0.28, y: 0.34, radius: 0.18, color: "#7ba06f" },
      { x: 0.64, y: 0.58, radius: 0.2, color: "#6a8b5f" },
      { x: 0.55, y: 0.24, radius: 0.12, color: "#d5dfdf" },
    ],
    noise: 16,
  },
  {
    name: "mars",
    base: "#70423a",
    bandSoft: "#996255",
    bands: ["#8d5346", "#b37a62", "#6a3b31", "#c79272"],
    spots: [
      { x: 0.24, y: 0.28, radius: 0.16, color: "#bf8a6a" },
      { x: 0.68, y: 0.52, radius: 0.14, color: "#5b3028" },
      { x: 0.62, y: 0.18, radius: 0.1, color: "#d4b59d" },
    ],
    noise: 20,
  },
  {
    name: "venus",
    base: "#8f7860",
    bandSoft: "#c7ae8c",
    bands: ["#d1bc95", "#9d8568", "#e4cfaa", "#7f6951"],
    spots: [
      { x: 0.34, y: 0.42, radius: 0.18, color: "#ead8b6" },
      { x: 0.67, y: 0.3, radius: 0.12, color: "#78624e" },
      { x: 0.58, y: 0.66, radius: 0.1, color: "#d7c09a" },
    ],
    noise: 14,
  },
  {
    name: "neptune",
    base: "#365d8e",
    bandSoft: "#6d90c1",
    bands: ["#7ea1d5", "#2c4d74", "#5f84b7", "#9db3dd"],
    spots: [
      { x: 0.62, y: 0.44, radius: 0.16, color: "#aec4ea" },
      { x: 0.27, y: 0.6, radius: 0.14, color: "#274363" },
    ],
    noise: 10,
  },
];

function getPlanetPalette(type) {
  return (
    planetPalettes.find((planet) => planet.name === type) ??
    planetPalettes[0]
  );
}

function createPlanet(type) {
  const palette = getPlanetPalette(type);
  const geometry = new THREE.SphereGeometry(1, 48, 48);
  const materialSettings =
      type === "venus"
        ? { roughness: 0.82, emissive: new THREE.Color("#f3dfba"), emissiveIntensity: 0.06 }
        : type === "neptune"
          ? { roughness: 0.86, emissive: new THREE.Color("#234f9a"), emissiveIntensity: 0.03 }
      : { roughness: 0.92, emissive: new THREE.Color(0x000000), emissiveIntensity: 0 };
  const material = new THREE.MeshStandardMaterial({
    map:
      type === "earth"
        ? createEarthTexture()
        : type === "mars"
          ? createMarsTexture()
          : type === "venus"
            ? createVenusTexture()
            : type === "neptune"
              ? createNeptuneTexture()
          : createPlanetTexture(palette),
    roughness: materialSettings.roughness,
    metalness: 0.02,
    emissive: materialSettings.emissive,
    emissiveIntensity: materialSettings.emissiveIntensity,
    transparent: false,
    opacity: 1,
  });

  return new THREE.Mesh(geometry, material);
}

function createPlanetBody(definition) {
  const planetType = definition.planetType ?? "earth";
  const mesh = createPlanet(planetType);
  mesh.userData = {
    ...definition,
    bodyType: "planet",
    planetType,
    hovered: 0,
    screen: new THREE.Vector3(),
    labelProgress: 0,
    labelReadyAt: 0,
    baseRotationX: (Math.random() - 0.5) * 0.45,
    baseRotationY: (Math.random() - 0.5) * 0.45,
    spinSpeedX: 0.015 + Math.random() * 0.025,
    spinSpeedY: 0.025 + Math.random() * 0.03,
  };
  mesh.rotation.set(
    mesh.userData.baseRotationX,
    mesh.userData.baseRotationY,
    Math.random() * Math.PI * 2
  );
  return mesh;
}

const navDefinitions = [
  {
    id: "projects",
    title: "Projects",
    planetType: "venus",
    body: "Projects section. Add case studies, selected work, and deeper project breakdowns here.",
    baseColor: "#5e6673",
    darkColor: "#232830",
    lightColor: "#8e97a3",
    scratchColor: "#6f7a88",
    detail: 4,
    scale: 4.6875,
    bumpiness: 0.16,
    craterDepth: 0.11,
    noiseScaleA: 5.6,
    noiseScaleB: 6.8,
    noiseScaleC: 4.6,
    craterScale: 8.4,
    seed: 0.7,
    roughness: 0.94,
    metalness: 0.04,
    flatShading: false,
  },
  {
    id: "about",
    title: "About Me",
    planetType: "earth",
    body: "About Me section. Use this space for your background, point of view, and how you approach design and code.",
    baseColor: "#6a4f52",
    darkColor: "#26181d",
    lightColor: "#8f7277",
    scratchColor: "#7a5e62",
    detail: 3,
    scale: 4.40625,
    bumpiness: 0.12,
    craterDepth: 0.08,
    noiseScaleA: 4.8,
    noiseScaleB: 5.4,
    noiseScaleC: 6.6,
    craterScale: 7.1,
    seed: 1.9,
    roughness: 0.9,
    metalness: 0.03,
    flatShading: false,
  },
  {
    id: "contact",
    title: "Contact",
    planetType: "neptune",
    body: "Contact section. Place your preferred contact methods, social links, or collaboration details here.",
    baseColor: "#44505a",
    darkColor: "#161b22",
    lightColor: "#697684",
    scratchColor: "#53606b",
    detail: 2,
    scale: 4.21875,
    bumpiness: 0.2,
    craterDepth: 0.13,
    noiseScaleA: 7.2,
    noiseScaleB: 5.8,
    noiseScaleC: 6.2,
    craterScale: 9.2,
    seed: 3.1,
    roughness: 0.97,
    metalness: 0.02,
    flatShading: true,
  },
  {
    id: "music",
    title: "Music",
    planetType: "mars",
    body: "Music section. Add releases, listening links, performances, or the role music plays in your work here.",
    baseColor: "#5b6170",
    darkColor: "#1d2230",
    lightColor: "#8d95a6",
    scratchColor: "#70798a",
    detail: 3,
    scale: 4.5,
    bumpiness: 0.16,
    craterDepth: 0.1,
    noiseScaleA: 6.1,
    noiseScaleB: 5.9,
    noiseScaleC: 4.9,
    craterScale: 8.1,
    seed: 4.4,
    roughness: 0.94,
    metalness: 0.03,
    flatShading: false,
  },
];

const decorAsteroidDefinition = {
  id: "decor-asteroid",
  title: "",
  body: "",
  baseColor: "#565d67",
  darkColor: "#1b2028",
  lightColor: "#7f8894",
  scratchColor: "#69727e",
  detail: 3,
  scale: 3.2,
  bumpiness: 0.18,
  craterDepth: 0.12,
  noiseScaleA: 6.4,
  noiseScaleB: 5.6,
  noiseScaleC: 4.8,
  craterScale: 8.8,
  seed: 4.7,
  roughness: 0.96,
  metalness: 0.02,
  flatShading: false,
};

const decorAsteroidPalettes = [
  {
    baseColor: "#3c434d",
    darkColor: "#131920",
    lightColor: "#687382",
    scratchColor: "#515b68",
  },
  {
    baseColor: "#565d67",
    darkColor: "#1b2028",
    lightColor: "#7f8894",
    scratchColor: "#69727e",
  },
  {
    baseColor: "#747b84",
    darkColor: "#232932",
    lightColor: "#a2a9b1",
    scratchColor: "#8b919a",
  },
  {
    baseColor: "#7a6656",
    darkColor: "#2b2119",
    lightColor: "#ac9580",
    scratchColor: "#8d7868",
  },
  {
    baseColor: "#87584b",
    darkColor: "#311815",
    lightColor: "#bc7f6a",
    scratchColor: "#9f6d60",
  },
  {
    baseColor: "#9a5e43",
    darkColor: "#351d13",
    lightColor: "#cf8764",
    scratchColor: "#b06f53",
  },
  {
    baseColor: "#676258",
    darkColor: "#241f18",
    lightColor: "#9b927f",
    scratchColor: "#847b69",
  },
  {
    baseColor: "#8d764f",
    darkColor: "#302515",
    lightColor: "#c2a879",
    scratchColor: "#a58d67",
  },
  {
    baseColor: "#5e4941",
    darkColor: "#221512",
    lightColor: "#916a5f",
    scratchColor: "#78584e",
  },
  {
    baseColor: "#7d6340",
    darkColor: "#2b1f10",
    lightColor: "#b18f62",
    scratchColor: "#977751",
  },
  {
    baseColor: "#496073",
    darkColor: "#18222c",
    lightColor: "#7291a8",
    scratchColor: "#5e7b90",
  },
  {
    baseColor: "#314556",
    darkColor: "#121b24",
    lightColor: "#59748a",
    scratchColor: "#466075",
  },
];

function createRandomDecorAsteroidDefinition(index) {
  const palette = decorAsteroidPalettes[index % decorAsteroidPalettes.length];
  const shapeMode = Math.random();
  let axisScale;
  let shapeProfile;
  let endBulgeStrength = 0;
  let waistPinchStrength = 0;
  let equatorBulgeStrength = 0;
  let polePinchStrength = 0;
  let asymmetryStrength = 0;

  if (shapeMode < 0.33) {
    shapeProfile = "potato";
    axisScale = {
      x: 0.48 + Math.random() * 0.7,
      y: 0.62 + Math.random() * 0.6,
      z: 0.86 + Math.random() * 0.9,
    };
  } else if (shapeMode < 0.66) {
    shapeProfile = "dogbone";
    axisScale = {
      x: 0.58 + Math.random() * 0.55,
      y: 0.54 + Math.random() * 0.38,
      z: 0.95 + Math.random() * 0.95,
    };
    endBulgeStrength = 0.18 + Math.random() * 0.22;
    waistPinchStrength = 0.16 + Math.random() * 0.2;
  } else {
    shapeProfile = "top";
    axisScale = {
      x: 0.82 + Math.random() * 0.72,
      y: 0.56 + Math.random() * 0.5,
      z: 0.82 + Math.random() * 0.72,
    };
    equatorBulgeStrength = 0.14 + Math.random() * 0.18;
    polePinchStrength = 0.12 + Math.random() * 0.16;
    asymmetryStrength = 0.04 + Math.random() * 0.08;
  }

  return {
    ...decorAsteroidDefinition,
    ...palette,
    detail: 2 + Math.floor(Math.random() * 3),
    scale: 1.2 + Math.random() * 11.9,
    bumpiness: 0.14 + Math.random() * 0.22,
    craterDepth: 0.08 + Math.random() * 0.18,
    noiseScaleA: 4.4 + Math.random() * 4.6,
    noiseScaleB: 4.2 + Math.random() * 4.8,
    noiseScaleC: 4.0 + Math.random() * 4.8,
    craterScale: 6.2 + Math.random() * 5.8,
    ridgeStrength: 0.04 + Math.random() * 0.12,
    lobeStrength: 0.03 + Math.random() * 0.16,
    pinchStrength: Math.random() * 0.18,
    shapeProfile,
    endBulgeStrength,
    waistPinchStrength,
    equatorBulgeStrength,
    polePinchStrength,
    asymmetryStrength,
    seed: decorAsteroidDefinition.seed + index * 0.83 + Math.random() * 2.2,
    roughness: 0.9 + Math.random() * 0.08,
    flatShading: Math.random() < 0.35,
    axisScale,
  };
}

function spawnNavObject(object3d, scale) {
  let x = 0;
  let y = 0;
  let z = 0;
  let attempts = 0;

  do {
    if (object3d.userData.bodyType === "planet") {
      z = -1300 - Math.random() * 250;
    } else {
      z = -220 - Math.random() * 130;
    }
    const candidate = randomNavSpawnPosition(z);
    x = candidate.x;
    y = candidate.y;
    attempts += 1;
  } while (
    attempts < 18 &&
    [...backPlanetGroup.children, ...frontPlanetGroup.children].some((child) => {
      if (child === object3d) return false;
      const dx = child.position.x - x;
      const dy = child.position.y - y;
      const dz = child.position.z - z;
      const minSeparation =
        (child.userData.baseScale || child.userData.scale * 3.65 || 18) +
        scale +
        90;
      return Math.hypot(dx, dy) < minSeparation && Math.abs(dz) < 220;
    })
  );

  object3d.position.set(x, y, z);
  const sizeJitter =
    object3d.userData.bodyType === "planet"
      ? 0.755 + Math.random() * 0.49
      : 1;
  object3d.userData.baseScale = scale * sizeJitter;
  object3d.userData.baseX = x;
  object3d.userData.baseY = y;
  object3d.userData.driftOffset = Math.random() * Math.PI * 2;
  object3d.userData.driftRadius = 0.7 + Math.random() * 1.8;
  object3d.userData.depthLayer = 0.72 + Math.random() * 0.22;
  object3d.userData.labelReadyAt = clock.elapsedTime + 1;
  object3d.userData.hovered = 0;
}

function syncPlanetLayer(object3d) {
  const threshold = isCompactViewport() ? -760 : -1200;
  if (object3d.position.z < threshold) {
    if (object3d.parent !== backPlanetGroup) {
      backPlanetGroup.add(object3d);
    }
  } else if (object3d.parent !== frontPlanetGroup) {
    frontPlanetGroup.add(object3d);
  }
}

function syncDecorLayer(object3d) {
  const threshold = isCompactViewport() ? -760 : -1200;
  if (object3d.position.z < threshold) {
    if (object3d.parent !== backDecorGroup) {
      backDecorGroup.add(object3d);
    }
  } else if (object3d.parent !== frontDecorGroup) {
    frontDecorGroup.add(object3d);
  }
}

function spawnDecorAsteroid(object3d, scale) {
  let x = 0;
  let y = 0;
  let z = 0;
  let attempts = 0;

  do {
    z = -1100 - Math.random() * 400;
    const candidate = randomDecorAsteroidPosition(z);
    x = candidate.x;
    y = candidate.y;
    attempts += 1;
  } while (
    attempts < 14 &&
    [...backDecorGroup.children, ...frontDecorGroup.children].some((child) => {
      if (child === object3d) return false;
      const dx = child.position.x - x;
      const dy = child.position.y - y;
      const dz = child.position.z - z;
      return Math.hypot(dx, dy) < 120 && Math.abs(dz) < 180;
    })
  );

  object3d.position.set(x, y, z);
  object3d.userData.baseScale = scale;
  object3d.userData.baseX = x;
  object3d.userData.baseY = y;
  object3d.userData.trajectoryX = (Math.random() - 0.5) * 1.008;
  object3d.userData.trajectoryY = (Math.random() - 0.5) * 0.714;
  object3d.userData.driftOffset = Math.random() * Math.PI * 2;
  object3d.userData.driftRadius = 0.35 + Math.random() * 1.2;
  object3d.userData.depthLayer = 0.72 + Math.random() * 0.22;
}

const navObjects = navDefinitions.map((definition) => {
  const body = createPlanetBody(definition);
  const scale = definition.scale * 9.125;
  body.userData.bodyType = "planet";
  body.renderOrder = 2;
  spawnNavObject(body, scale);
  body.scale.setScalar(body.userData.baseScale);
  syncPlanetLayer(body);
  return body;
});

const decorAsteroids = Array.from({ length: 2 }, (_, index) => {
  const body = createCelestialBody(createRandomDecorAsteroidDefinition(index));
  body.userData.bodyType = "asteroid";
  body.userData.decor = true;
  body.renderOrder = 4;
  body.material.depthTest = false;
  spawnDecorAsteroid(body, body.userData.scale);
  body.scale.setScalar(body.userData.baseScale);
  syncDecorLayer(body);
  return body;
});

function openNavTarget(target) {
  focusState.object = target;
  focusState.active = true;
  focusState.targetAmount = 1;
  if (overlay && overlayTitle && overlayBody) {
    overlayTitle.textContent = target.userData.title;
    overlayBody.textContent = target.userData.body;
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

const navAnnotationMap = new Map();
if (navAnnotations) {
  navDefinitions.forEach((definition) => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "nav-annotation");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("class", "nav-connector");

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "nav-label-box");
    rect.setAttribute("width", "112");
    rect.setAttribute("height", "28");
    rect.setAttribute("rx", "2");
    rect.setAttribute("ry", "2");

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "nav-label-text");
    text.setAttribute("x", "14");
    text.setAttribute("y", "18");
    text.textContent = definition.title;

    group.appendChild(line);
    group.appendChild(rect);
    group.appendChild(text);
    navAnnotations.appendChild(group);
    navAnnotationMap.set(definition.id, { group, line, rect, text });

    group.addEventListener("pointerenter", () => {
      hoveredState.annotationId = definition.id;
    });
    group.addEventListener("pointerleave", () => {
      if (hoveredState.annotationId === definition.id) {
        hoveredState.annotationId = null;
      }
    });
    group.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      updatePointerPosition(event.clientX, event.clientY);
      pulse.value = 1;
      thrust.target = 1;
      const target = navObjects.find((object3d) => object3d.userData.id === definition.id);
      if (target) {
        openNavTarget(target);
      }
    });
  });
}

function addCelestialLights(targetScene) {
  const ambientLight = new THREE.AmbientLight(0x5f72ff, 1.53);
  targetScene.add(ambientLight);

  const pointLight = new THREE.PointLight(0x8aa0ff, 15.75, 1200, 2);
  pointLight.position.set(-140, 120, -500);
  targetScene.add(pointLight);

  const directionalLight = new THREE.DirectionalLight(0xf6f3ec, 8.55);
  directionalLight.position.set(180, 110, 120);
  targetScene.add(directionalLight);
}

addCelestialLights(planetScene);
addCelestialLights(objectScene);

planetScene.children.forEach((child) => {
  if (child.isLight) {
    child.intensity *= 1.35;
  }
});

function resetStar(index) {
  const i3 = index * 3;
  const x = (Math.random() - 0.5) * 900;
  const y = (Math.random() - 0.5) * 560;
  positions[i3] = x;
  positions[i3 + 1] = y;
  positions[i3 + 2] = -2000;
  baseX[index] = x;
  baseY[index] = y;
  driftOffset[index] = Math.random() * Math.PI * 2;
  driftRadius[index] = 0.4 + Math.random() * 2.2;
  depthLayer[index] = 0.35 + scales[index] * 0.9;
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.033);
  const elapsed = clock.elapsedTime;
  const iStep = 3;
  pointer.x += (mouse.x - pointer.x) * 0.03;
  pointer.y += (mouse.y - pointer.y) * 0.03;
  pulse.value *= 0.94;
  thrust.value += (thrust.target - thrust.value) * 0.045;
  if (warp.target) {
    warp.value += delta * 0.9;
  } else {
    warp.value += (0 - warp.value) * 0.045;
  }

  starMaterial.uniforms.uTime.value = elapsed;

  const pointerRecentlyMoved = pointerState.insideWindow && performance.now() - pointerState.lastMoveAt < 180;
  const hoveredObjectStillUnderPointer =
    hoverCinematic.object &&
    pointerState.insideWindow &&
    (() => {
      const screen = hoverCinematic.object.userData.screen;
      const x = (screen.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-screen.y * 0.5 + 0.5) * window.innerHeight;
      const radius =
        hoverCinematic.object.userData.baseScale *
        (hoverCinematic.object.userData.bodyType === "planet" ? 5.4 : 6.2);
      return Math.hypot(pointerState.clientX - x, pointerState.clientY - y) < radius;
    })();

  if (pointerRecentlyMoved || hoveredObjectStillUnderPointer) {
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects([...navObjects, ...decorAsteroids]);
    hoveredState.object = hits.length ? hits[0].object : null;
  } else {
    hoveredState.object = null;
  }
  const directHoverObject =
    hoveredState.object ??
    navObjects.find((object3d) => object3d.userData.id === hoveredState.annotationId) ??
    null;

  if (directHoverObject) {
    hoverCinematic.object = directHoverObject;
    hoverCinematic.releaseAt = elapsed + 0.18;
  } else if (elapsed > hoverCinematic.releaseAt) {
    hoverCinematic.object = null;
  }

  hoverCinematic.amount += ((hoverCinematic.object ? 1 : 0) - hoverCinematic.amount) * 0.12;

  const starTimeScale = Math.max(0.015, 1 - hoverCinematic.amount * 0.985);
  const navTimeScale = Math.max(0.008, 1 - hoverCinematic.amount * 0.992);
  const warpVisual = Math.min(warp.value, 1.2);
  const warpScale = 1 + warp.value * 22;
  const suppressRespawns = warp.value > 0.18;

  for (let i = 0; i < starCount; i += 1) {
    const i3 = i * iStep;
    const depthFactor = depthLayer[i];
    const cruiseSpeed =
      ((0.045 + pulse.value * 0.008 + thrust.value * 0.32) * warpScale) *
      (0.72 + depthFactor * 0.58) *
      starTimeScale;
    const wave = elapsed * (0.08 + depthFactor * 0.12) + driftOffset[i];
    const parallaxX = -pointer.x * (2.7 + depthFactor * 5.9);
    const parallaxY = -pointer.y * (1.85 + depthFactor * 4.1);
    const organicX = Math.sin(wave) * driftRadius[i] * (0.35 + depthFactor);
    const organicY = Math.cos(wave * 0.85) * driftRadius[i] * (0.22 + depthFactor * 0.7);

    positions[i3 + 2] += cruiseSpeed * delta * 60;
    positions[i3] = baseX[i] + parallaxX + organicX;
    positions[i3 + 1] = baseY[i] + parallaxY + organicY;

    if (positions[i3 + 2] > camera.position.z + 10) {
      resetStar(i);
    }
  }

  starGeometry.attributes.position.needsUpdate = true;

  camera.position.x += ((-pointer.x * 3.5) - camera.position.x) * 0.02;
  camera.position.y += ((pointer.y * 2.25) - camera.position.y) * 0.02;
  camera.position.z += ((6 - hoverCinematic.amount * 1.25) - camera.position.z) * 0.06;
  focusState.amount += (focusState.targetAmount - focusState.amount) * 0.055;
  const clickFocusObject = focusState.object;
  const clickFocusAmount = focusState.amount;
  const focusX = clickFocusObject ? clickFocusObject.position.x * clickFocusAmount : 0;
  const focusY = clickFocusObject ? clickFocusObject.position.y * clickFocusAmount : 0;
  const focusZ = clickFocusObject ? clickFocusObject.position.z * clickFocusAmount : -300;
  camera.lookAt(-pointer.x * 22.5 + focusX, pointer.y * 12.5 + focusY, focusZ);
  camera.rotation.z += ((pointer.x * 0.015) - camera.rotation.z) * 0.015;
  camera.fov += ((65 + warpVisual * 11 - hoverCinematic.amount * 6.5) - camera.fov) * 0.08;
  camera.updateProjectionMatrix();

  stars.rotation.z +=
    ((pointer.x * 0.0125 + Math.sin(elapsed * 0.06) * 0.004) - stars.rotation.z) *
    (0.018 * (0.2 + starTimeScale * 0.8));

  decorAsteroids.forEach((object3d) => {
    const isHovered = hoveredState.object === object3d;
    const hoverTarget = isHovered ? 1 : 0;
    const hoverEase = isHovered ? 0.12 : 0.32;
    object3d.userData.hovered += (hoverTarget - object3d.userData.hovered) * hoverEase;
    const depthFactor = object3d.userData.depthLayer;
    const distanceToCamera = Math.max(1, camera.position.z - object3d.position.z);
    const proximity = THREE.MathUtils.clamp(
      1 - (distanceToCamera - 160) / 1200,
      0,
      1
    );
    const nearPass = Math.pow(proximity, 3.2);
    const accelerationFactor = Math.min(
      1 + proximity * 10.8 + proximity * proximity * 28.8 + nearPass * 180.0,
      60
    );
    const cruiseSpeed =
      ((0.6654375 + pulse.value * 0.11090625 + thrust.value * 3.08953125) *
        (1.05 + depthFactor * 1.1) *
        accelerationFactor) *
      navTimeScale;
    const wave = elapsed * (0.05 + depthFactor * 0.08) + object3d.userData.driftOffset;
    const parallaxX = -pointer.x * (5 + depthFactor * 12.8) * (1 + nearPass * 1.08);
    const parallaxY = -pointer.y * (3.4 + depthFactor * 8.9) * (1 + nearPass * 0.82);
    const organicX =
      Math.sin(wave) *
      object3d.userData.driftRadius *
      (0.28 + depthFactor * 0.52) *
      (1 + nearPass * 1.25);
    const organicY =
      Math.cos(wave * 0.82) *
      object3d.userData.driftRadius *
      (0.22 + depthFactor * 0.4) *
      (1 + nearPass * 0.9);

    const isInspectionTarget = hoverCinematic.object === object3d && hoverCinematic.amount > 0.08;

    if (!isInspectionTarget) {
      object3d.position.z += cruiseSpeed * delta * 60;
      object3d.position.x =
        object3d.userData.baseX +
        parallaxX +
        organicX +
        proximity * 2300 * object3d.userData.trajectoryX;
      object3d.position.y =
        object3d.userData.baseY +
        parallaxY +
        organicY +
        proximity * 1640 * object3d.userData.trajectoryY;
    }

    syncDecorLayer(object3d);

    object3d.userData.screen.copy(object3d.position).project(camera);
    const screenX = object3d.userData.screen.x;
    const screenY = object3d.userData.screen.y;
    const isOffscreen =
      object3d.position.z > camera.position.z + 16 ||
      screenX < -1.2 ||
      screenX > 1.2 ||
      screenY < -1.14 ||
      screenY > 1.14;

    if (isOffscreen && !isInspectionTarget && !suppressRespawns) {
      spawnDecorAsteroid(object3d, object3d.userData.baseScale);
      object3d.scale.setScalar(object3d.userData.baseScale);
      syncDecorLayer(object3d);
      object3d.userData.hovered = 0;
      object3d.material.opacity = 0;
      return;
    }

    const growth = 1 + proximity * 1.3 + proximity * proximity * 2.4 + nearPass * 3.8;
    object3d.scale.setScalar(object3d.userData.baseScale * growth * (1 + object3d.userData.hovered * 0.24));
    object3d.rotation.x =
      object3d.userData.baseRotationX +
      Math.sin(elapsed * object3d.userData.spinSpeedX + object3d.userData.driftOffset) * 0.12;
    object3d.rotation.y =
      object3d.userData.baseRotationY + elapsed * object3d.userData.spinSpeedY;
    object3d.rotation.z =
      Math.sin(elapsed * (object3d.userData.spinSpeedX * 0.7) + object3d.userData.driftOffset) * 0.05;
    const targetOpacity = 0.84 + object3d.userData.hovered * 0.12;
    object3d.material.opacity += (targetOpacity - object3d.material.opacity) * 0.08;
  });

  navObjects.forEach((object3d) => {
    const isHovered =
      hoveredState.object === object3d || hoveredState.annotationId === object3d.userData.id;
    const hoverTarget = isHovered ? 1 : 0;
    const hoverEase = isHovered ? 0.12 : 0.32;
    object3d.userData.hovered += (hoverTarget - object3d.userData.hovered) * hoverEase;
    const depthFactor = object3d.userData.depthLayer;
    const distanceToCamera = Math.max(1, camera.position.z - object3d.position.z);
    const proximity = THREE.MathUtils.clamp(
      1 - (distanceToCamera - 40) / 520,
      0,
      1
    );
    const bodySpeedFactor = 2.232;
    const accelerationFactor = 1 + proximity * 0.27 + proximity * proximity * 0.1575;
    const cruiseSpeed =
      ((0.42 + pulse.value * 0.07 + thrust.value * 2.15) *
        (0.98 + depthFactor * 1.18) *
        accelerationFactor) *
      bodySpeedFactor *
      navTimeScale;
    const wave = elapsed * (0.08 + depthFactor * 0.12) + object3d.userData.driftOffset;
    const parallaxX = -pointer.x * (4.8 + depthFactor * 12.6);
    const parallaxY = -pointer.y * (3.2 + depthFactor * 8.5);
    const organicX = Math.sin(wave) * object3d.userData.driftRadius * (0.35 + depthFactor);
    const organicY =
      Math.cos(wave * 0.85) * object3d.userData.driftRadius * (0.22 + depthFactor * 0.7);

    const isInspectionTarget = hoverCinematic.object === object3d && hoverCinematic.amount > 0.08;

    if (!isInspectionTarget) {
      object3d.position.z += cruiseSpeed * delta * 60;
      object3d.position.x = object3d.userData.baseX + parallaxX + organicX;
      object3d.position.y = object3d.userData.baseY + parallaxY + organicY;
    }

    syncPlanetLayer(object3d);

    object3d.userData.screen.copy(object3d.position).project(camera);
    const screenX = object3d.userData.screen.x;
    const screenY = object3d.userData.screen.y;
    const isOffscreen =
      object3d.position.z > camera.position.z + 4 ||
      screenX < -1.18 ||
      screenX > 1.18 ||
      screenY < -1.18 ||
      screenY > 1.18;

    if (isOffscreen && !isInspectionTarget && !suppressRespawns) {
      const respawnScale = object3d.userData.scale * 9.125;
      spawnNavObject(object3d, respawnScale);
      object3d.scale.setScalar(object3d.userData.baseScale);
      syncPlanetLayer(object3d);
      object3d.userData.labelProgress = 0;
      object3d.userData.labelReadyAt = elapsed + 1;
      object3d.material.opacity = 0;
      const annotation = navAnnotationMap.get(object3d.userData.id);
      if (annotation) {
        annotation.group.style.opacity = "0";
        annotation.line.style.opacity = "0";
      }
      return;
    }

    const apparentDistanceScale =
      object3d.userData.bodyType === "planet"
        ? 1 - proximity * 0.42 - proximity * proximity * 0.26
        : 1;
    const scale =
      object3d.userData.baseScale *
      apparentDistanceScale *
      (1 + object3d.userData.hovered * 0.24);
    object3d.scale.setScalar(scale);
    object3d.rotation.x =
      object3d.userData.baseRotationX +
      Math.sin(elapsed * object3d.userData.spinSpeedX + object3d.userData.driftOffset) * 0.18;
    object3d.rotation.y =
      object3d.userData.baseRotationY +
      elapsed * object3d.userData.spinSpeedY +
      object3d.userData.hovered * 0.06;
    object3d.rotation.z =
      Math.sin(elapsed * (object3d.userData.spinSpeedX * 0.7) + object3d.userData.driftOffset) * 0.08;
  });

  navObjects.forEach((object3d) => {
    const annotation = navAnnotationMap.get(object3d.userData.id);
    if (!annotation) return;
    if (warp.value > 0.04) {
      object3d.userData.labelProgress = 0;
      annotation.group.style.opacity = "0";
      annotation.line.style.opacity = "0";
      return;
    }
    if (elapsed < object3d.userData.labelReadyAt) {
      annotation.group.style.opacity = "0";
      annotation.line.style.opacity = "0";
      object3d.material.opacity = 0;
      return;
    }
    const screen = object3d.userData.screen;
    const x = (screen.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screen.y * 0.5 + 0.5) * window.innerHeight;
    const visible = screen.z < 1 && screen.z > -1;
    const compactViewport = isCompactViewport();
    const edgeProximity = THREE.MathUtils.clamp(
      Math.max(Math.abs(screen.x), Math.abs(screen.y)),
      0,
      1
    );
    const lineScale = THREE.MathUtils.lerp(1.9, 1.0, edgeProximity);
    const horizontalSign = screen.x >= 0 ? 1 : -1;
    const verticalSign = screen.y >= 0 ? -1 : 1;
    const baseOffsetX = compactViewport ? 74 : 96;
    const baseOffsetY = compactViewport ? 52 : 68;
    const labelOffsetX = horizontalSign * baseOffsetX * lineScale;
    const labelOffsetY =
      verticalSign *
      baseOffsetY *
      THREE.MathUtils.lerp(1.45, 1.0, edgeProximity);
    const labelX = x + labelOffsetX;
    const labelY = y + labelOffsetY;
    const shouldShowLabel = visible && object3d.position.z < -30;
    object3d.userData.labelProgress += ((shouldShowLabel ? 1 : 0) - object3d.userData.labelProgress) * 0.12;
    const opacity = object3d.userData.labelProgress * (0.58 + object3d.userData.hovered * 0.42);
    object3d.material.opacity = object3d.userData.labelProgress * (0.88 + object3d.userData.hovered * 0.12);

    const width = compactViewport ? 104 : 124;
    const height = compactViewport ? 26 : 30;
    let anchorX = labelX;
    let anchorY = labelY;

    if (horizontalSign > 0 && verticalSign < 0) {
      anchorX = labelX - width * 0.5;
      anchorY = labelY + height * 0.5;
    } else if (horizontalSign < 0 && verticalSign < 0) {
      anchorX = labelX + width * 0.5;
      anchorY = labelY + height * 0.5;
    } else if (horizontalSign < 0 && verticalSign > 0) {
      anchorX = labelX + width * 0.5;
      anchorY = labelY - height * 0.5;
    } else {
      anchorX = labelX - width * 0.5;
      anchorY = labelY - height * 0.5;
    }
    const dx = x - anchorX;
    const dy = y - anchorY;
    const distance = Math.hypot(dx, dy) || 1;
    const gap = 38 * THREE.MathUtils.lerp(1.1, 0.9, edgeProximity);
    const endX = x - (dx / distance) * gap;
    const endY = y - (dy / distance) * gap;
    const left = labelX - width * 0.5;
    const top = labelY - height * 0.5;

    annotation.group.style.opacity = `${opacity}`;
    annotation.line.setAttribute("d", `M ${anchorX} ${anchorY} L ${endX} ${endY}`);
    annotation.line.style.opacity = `${opacity}`;
    annotation.line.style.stroke = `rgba(255, 255, 255, ${0.92 + object3d.userData.hovered * 0.08})`;
    annotation.rect.setAttribute("x", `${left}`);
    annotation.rect.setAttribute("y", `${top}`);
    annotation.rect.setAttribute("width", `${width}`);
    annotation.rect.setAttribute("height", `${height}`);
    annotation.rect.style.fill =
      object3d.userData.hovered > 0.02 ? "rgba(255, 255, 255, 0.96)" : "rgba(0, 0, 0, 0.02)";
    annotation.rect.style.stroke =
      object3d.userData.hovered > 0.02 ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.96)";
    annotation.text.setAttribute("x", `${labelX}`);
    annotation.text.setAttribute("y", `${top + (compactViewport ? 17 : 19)}`);
    annotation.text.style.fontSize = compactViewport ? "11px" : "12px";
    annotation.text.style.fill =
      object3d.userData.hovered > 0.02 ? "#05070d" : "rgba(255, 255, 255, 0.98)";
    annotation.line.style.filter =
      object3d.userData.hovered > 0.02 ? "drop-shadow(0 0 5px rgba(255, 255, 255, 0.55))" : "none";
  });

  shootingStars.forEach((shootingState) => {
    if (hoverCinematic.amount > 0.1) {
      shootingState.material.opacity *= 0.82;
      return;
    }

    if (!shootingState.active && elapsed > shootingState.nextAt && elapsed - lastShootingStarAt >= 0.5) {
      shootingState.active = true;
      shootingState.start = elapsed;
      lastShootingStarAt = elapsed;
      shootingState.duration = 0.7 + Math.random() * 0.35;
      const centered = centeredRandom({ x: 260, y: 160 });
      const edgeOffsetX = (Math.random() - 0.5) * 760;
      const edgeOffsetY = (Math.random() - 0.5) * 420;
      const blend = 0;
      const startX = centered.x * blend + edgeOffsetX * (1 - blend);
      const startY = centered.y * blend + edgeOffsetY * (1 - blend);
      const startZ = -520 - Math.random() * 720;
      shootingState.from.set(startX, startY, startZ);
      shootingState.to.set(
        startX + 140 + Math.random() * 220,
        startY - 50 - Math.random() * 140,
        startZ + 60 + Math.random() * 80
      );
      const attr = shootingState.geometry.attributes.position.array;
      attr[0] = shootingState.from.x;
      attr[1] = shootingState.from.y;
      attr[2] = shootingState.from.z;
      attr[3] = shootingState.from.x;
      attr[4] = shootingState.from.y;
      attr[5] = shootingState.from.z;
      shootingState.geometry.attributes.position.needsUpdate = true;
      shootingState.nextAt = elapsed + 4.34 + Math.random() * 6.5;
    }

    if (shootingState.active) {
      const progress = (elapsed - shootingState.start) / shootingState.duration;
      if (progress >= 1) {
        shootingState.active = false;
        shootingState.material.opacity = 0;
      } else {
        const head = shootingState.from.clone().lerp(shootingState.to, progress);
        const tail = shootingState.from
          .clone()
          .lerp(shootingState.to, Math.max(0, progress - 0.28));
        const attr = shootingState.geometry.attributes.position.array;
        attr[0] = tail.x;
        attr[1] = tail.y;
        attr[2] = tail.z;
        attr[3] = head.x;
        attr[4] = head.y;
        attr[5] = head.z;
        shootingState.geometry.attributes.position.needsUpdate = true;
        shootingState.material.opacity = Math.sin(progress * Math.PI) * 0.57;
      }
    }
  });

  backgroundRenderer.render(backgroundScene, camera);
  planetRenderer.render(planetScene, camera);
  objectRenderer.render(objectScene, camera);
  requestAnimationFrame(animate);
}

function updatePointerPosition(clientX, clientY) {
  mouse.x = (clientX / window.innerWidth - 0.5) * 2;
  mouse.y = (clientY / window.innerHeight - 0.5) * 2;
  pointerNdc.x = (clientX / window.innerWidth) * 2 - 1;
  pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1;
  pointerState.insideWindow = true;
  pointerState.lastMoveAt = performance.now();
  pointerState.clientX = clientX;
  pointerState.clientY = clientY;
}

function clearTransientInteractionState() {
  mouse.x = 0;
  mouse.y = 0;
  hoveredState.object = null;
  hoveredState.annotationId = null;
  hoverCinematic.object = null;
  hoverCinematic.releaseAt = 0;
  thrust.target = 0;
  warp.target = 0;
  pointerState.insideWindow = false;
}

window.addEventListener("pointermove", (event) => {
  updatePointerPosition(event.clientX, event.clientY);
});

window.addEventListener("pointerdown", (event) => {
  if (event.target instanceof Element && event.target.closest(".nav-annotation")) {
    return;
  }
  updatePointerPosition(event.clientX, event.clientY);
  pulse.value = 1;
  thrust.target = 1;
  warp.target = 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(navObjects);
  if (hits.length) {
    openNavTarget(hits[0].object);
  }
});

window.addEventListener("pointerleave", () => {
  clearTransientInteractionState();
});

window.addEventListener("pointerup", () => {
  thrust.target = 0;
  warp.target = 0;
});

window.addEventListener("pointercancel", () => {
  thrust.target = 0;
  warp.target = 0;
});

window.addEventListener("blur", () => {
  clearTransientInteractionState();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTransientInteractionState();
  }
});

if (overlayClose && overlay) {
  overlayClose.addEventListener("click", () => {
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
    focusState.targetAmount = 0;
    focusState.active = false;
    focusState.object = null;
  });
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  backgroundRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  backgroundRenderer.setSize(window.innerWidth, window.innerHeight);
  planetRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  planetRenderer.setSize(window.innerWidth, window.innerHeight);
  objectRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  objectRenderer.setSize(window.innerWidth, window.innerHeight);
  starMaterial.uniforms.uViewportHeight.value =
    window.innerHeight * Math.min(window.devicePixelRatio, 2);
});

animate();
