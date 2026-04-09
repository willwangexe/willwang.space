import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas = document.getElementById("scene-canvas");
const navAnnotations = document.getElementById("nav-annotations");
const overlay = document.getElementById("overlay");
const overlayClose = document.getElementById("overlay-close");
const overlayTitle = document.getElementById("overlay-title");
const overlayBody = document.getElementById("overlay-body");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050814, 0.00095);

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
  const y = (Math.random() - 0.5) * halfHeight * 0.24;

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
  },
  vertexShader: `
    attribute float aScale;
    uniform float uTime;
    varying float vAlpha;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = min((2.0 + aScale * 3.6) * (240.0 / -mvPosition.z), 9.6);
      float viewDistance = -mvPosition.z;
      float twinkleBand = smoothstep(1250.0, 1850.0, viewDistance);
      float twinkleMask = step(
        0.825,
        fract(sin(dot(position.xy + vec2(aScale * 17.0, position.z * 0.01), vec2(12.9898, 78.233))) * 43758.5453)
      );
      float twinkle = sin(uTime * 0.42 + aScale * 12.0) * 0.08 * twinkleBand * twinkleMask;
      vAlpha = 0.3 + aScale * 0.36 + twinkle;
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
scene.add(stars);

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
  scene.add(line);

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
const navGroup = new THREE.Group();
const decorGroup = new THREE.Group();
scene.add(navGroup);
scene.add(decorGroup);

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
    const displacement =
      1 +
      grain * definition.bumpiness +
      (crater - 0.5) * definition.craterDepth +
      ridge +
      lobes -
      pinch;

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
    transparent: true,
    opacity: 0,
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

function createPlanetBody(definition) {
  const palette = planetPalettes[Math.floor(Math.random() * planetPalettes.length)];
  const geometry = new THREE.SphereGeometry(1, 48, 48);
  const material = new THREE.MeshStandardMaterial({
    map: createPlanetTexture(palette),
    roughness: 0.92,
    metalness: 0.02,
    transparent: true,
    opacity: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    ...definition,
    bodyType: "planet",
    planetType: palette.name,
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
    baseColor: "#565d67",
    darkColor: "#1b2028",
    lightColor: "#7f8894",
    scratchColor: "#69727e",
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
];

function createRandomDecorAsteroidDefinition(index) {
  const palette = decorAsteroidPalettes[index % decorAsteroidPalettes.length];
  const shapeMode = Math.random();
  let axisScale;

  if (shapeMode < 0.33) {
    axisScale = {
      x: 0.58 + Math.random() * 0.5,
      y: 0.7 + Math.random() * 0.45,
      z: 1.0 + Math.random() * 0.6,
    };
  } else if (shapeMode < 0.66) {
    axisScale = {
      x: 0.72 + Math.random() * 0.7,
      y: 0.52 + Math.random() * 0.42,
      z: 0.72 + Math.random() * 0.7,
    };
  } else {
    axisScale = {
      x: 0.62 + Math.random() * 0.95,
      y: 0.62 + Math.random() * 0.95,
      z: 0.62 + Math.random() * 0.95,
    };
  }

  return {
    ...decorAsteroidDefinition,
    ...palette,
    detail: 2 + Math.floor(Math.random() * 3),
    scale: 2.2 + Math.random() * 2.8,
    bumpiness: 0.14 + Math.random() * 0.22,
    craterDepth: 0.08 + Math.random() * 0.18,
    noiseScaleA: 4.4 + Math.random() * 4.6,
    noiseScaleB: 4.2 + Math.random() * 4.8,
    noiseScaleC: 4.0 + Math.random() * 4.8,
    craterScale: 6.2 + Math.random() * 5.8,
    ridgeStrength: 0.04 + Math.random() * 0.12,
    lobeStrength: 0.03 + Math.random() * 0.16,
    pinchStrength: Math.random() * 0.18,
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
      z = -420 - Math.random() * 220;
    } else {
      z = -220 - Math.random() * 130;
    }
    const candidate = randomNavSpawnPosition(z);
    x = candidate.x;
    y = candidate.y;
    attempts += 1;
  } while (
    attempts < 18 &&
    navGroup.children.some((child) => {
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
      ? 0.9 + Math.random() * 0.28
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

function spawnDecorAsteroid(object3d, scale) {
  let x = 0;
  let y = 0;
  let z = 0;
  let attempts = 0;

  do {
    z = -980 - Math.random() * 520;
    const candidate = randomDecorAsteroidPosition(z);
    x = candidate.x;
    y = candidate.y;
    attempts += 1;
  } while (
    attempts < 14 &&
    decorGroup.children.some((child) => {
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
  object3d.userData.driftOffset = Math.random() * Math.PI * 2;
  object3d.userData.driftRadius = 0.35 + Math.random() * 1.2;
  object3d.userData.depthLayer = 0.72 + Math.random() * 0.22;
}

const navObjects = navDefinitions.map((definition) => {
  const body = createPlanetBody(definition);
  const scale = definition.scale * 3.65;
  body.userData.bodyType = "planet";
  body.renderOrder = 2;
  spawnNavObject(body, scale);
  body.scale.setScalar(body.userData.baseScale);
  navGroup.add(body);
  return body;
});

const decorAsteroids = Array.from({ length: 4 }, (_, index) => {
  const body = createCelestialBody(createRandomDecorAsteroidDefinition(index));
  body.userData.bodyType = "asteroid";
  body.userData.decor = true;
  body.renderOrder = 1;
  spawnDecorAsteroid(body, body.userData.scale);
  body.scale.setScalar(body.userData.baseScale);
  decorGroup.add(body);
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

const ambientLight = new THREE.AmbientLight(0x5f72ff, 0.18);
scene.add(ambientLight);

const pointLight = new THREE.PointLight(0x8aa0ff, 2.2, 1200, 2);
pointLight.position.set(-140, 120, -500);
scene.add(pointLight);

const directionalLight = new THREE.DirectionalLight(0xf6f3ec, 1.25);
directionalLight.position.set(180, 110, 120);
scene.add(directionalLight);

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

  for (let i = 0; i < starCount; i += 1) {
    const i3 = i * iStep;
    const depthFactor = depthLayer[i];
    const cruiseSpeed =
      (0.045 + pulse.value * 0.008 + thrust.value * 0.32) *
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
  camera.fov += ((65 - hoverCinematic.amount * 6.5) - camera.fov) * 0.08;
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
    const cruiseSpeed =
      ((0.84 + pulse.value * 0.14 + thrust.value * 3.9) *
        (1.05 + depthFactor * 1.1) *
        (1 + proximity * 1.8 + proximity * proximity * 4.8 + nearPass * 30.0)) *
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
      object3d.position.x = object3d.userData.baseX + parallaxX + organicX;
      object3d.position.y = object3d.userData.baseY + parallaxY + organicY;
    }

    object3d.userData.screen.copy(object3d.position).project(camera);
    const screenX = object3d.userData.screen.x;
    const screenY = object3d.userData.screen.y;
    const isOffscreen =
      object3d.position.z > camera.position.z + 16 ||
      screenX < -1.2 ||
      screenX > 1.2 ||
      screenY < -1.14 ||
      screenY > 1.14;

    if (isOffscreen && !isInspectionTarget) {
      spawnDecorAsteroid(object3d, object3d.userData.baseScale);
      object3d.material.opacity = 0;
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
    const bodySpeedFactor = 0.558;
    const accelerationFactor = 1 + proximity * 0.48 + proximity * proximity * 0.28;
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

    object3d.userData.screen.copy(object3d.position).project(camera);
    const screenX = object3d.userData.screen.x;
    const screenY = object3d.userData.screen.y;
    const isOffscreen =
      object3d.position.z > camera.position.z + 4 ||
      screenX < -1.18 ||
      screenX > 1.18 ||
      screenY < -1.18 ||
      screenY > 1.18;

    if (isOffscreen && !isInspectionTarget) {
      const respawnScale = object3d.userData.scale * 3.65;
      spawnNavObject(object3d, respawnScale);
      object3d.scale.setScalar(object3d.userData.baseScale);
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
    const labelOffsetX = x < window.innerWidth * 0.5 ? -156 : 156;
    const labelOffsetY = -52;
    const labelX = x + labelOffsetX;
    const labelY = y + labelOffsetY;
    const shouldShowLabel = visible && object3d.position.z < -30;
    object3d.userData.labelProgress += ((shouldShowLabel ? 1 : 0) - object3d.userData.labelProgress) * 0.12;
    const opacity = object3d.userData.labelProgress * (0.58 + object3d.userData.hovered * 0.42);
    object3d.material.opacity = object3d.userData.labelProgress * (0.88 + object3d.userData.hovered * 0.12);

    const width = 124;
    const height = 30;
    const anchorX = labelOffsetX > 0 ? labelX - width * 0.5 : labelX + width * 0.5;
    const anchorY = labelY + height * 0.5;
    const dx = x - anchorX;
    const dy = y - anchorY;
    const distance = Math.hypot(dx, dy) || 1;
    const gap = 38;
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
    annotation.text.setAttribute("y", `${top + 19}`);
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

  renderer.render(scene, camera);
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
});

window.addEventListener("pointercancel", () => {
  thrust.target = 0;
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
