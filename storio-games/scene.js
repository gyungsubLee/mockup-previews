import * as THREE from './vendor/three.module.js';

const MAX_RENDER_PIXELS = 1600 * 900;
const FRAME_INTERVAL_MS = 1000 / 30;
const READING_STOPS = [0, 0.19, 0.54, 0.88, 1];
const ROAD_START = -40;
const ROAD_END = 430;

function roadX(distance) {
  return Math.sin(distance * 0.034) * 10 + Math.sin(distance * 0.071) * 3.2;
}

function roadSlope(distance) {
  return Math.cos(distance * 0.034) * 0.34 + Math.cos(distance * 0.071) * 0.2272;
}

function roadHeight(distance) {
  return Math.sin(distance * 0.032 - 0.4) * 5.8 + Math.sin(distance * 0.067 + 0.7) * 1.5;
}

function groundHeight(distance, offset) {
  const shoulder = Math.min(1, Math.abs(offset) / 11);
  const hills = Math.sin(offset * 0.075 + distance * 0.022) * 3.2
    + Math.cos(offset * 0.038 - distance * 0.027) * 2.1;
  return roadHeight(distance) - 0.65 + hills * shoulder * shoulder;
}

/** A generated-art cartoon journey. Progress remains deterministic and reversible. */
export function mountJourney(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#aee6df');
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#aee6df', 115, 355);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.2, 950);
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const bitmaps = new Set();
  const controllers = new Set();
  const sprites = [];
  const clouds = [];
  const birds = [];
  const treeMaterials = [];
  const birdMaterials = [];
  const failedAssets = [];
  const bufferSize = new THREE.Vector2();
  let sun = null;
  let progress = 0;
  let cameraDistance = 8;
  let seed = 19071991;
  let disposed = false;
  let hasSize = false;
  let viewHeight = 1;
  let onScreen = true;
  let motionPaused = false;
  let frameRequest = 0;
  let previousFrame = null;
  let ambientTime = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function random() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  function addMesh(name, geometry, material) {
    geometries.add(geometry);
    materials.add(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    scene.add(mesh);
    return mesh;
  }

  const terrainPositions = [];
  const terrainColors = [];
  const terrainIndices = [];
  const terrainColumns = 36;
  const terrainRows = 190;
  const mint = new THREE.Color('#aee6df');
  const aqua = new THREE.Color('#47c9cb');
  const terrainColor = new THREE.Color();
  for (let row = 0; row <= terrainRows; row += 1) {
    const distance = ROAD_START + (row / terrainRows) * (ROAD_END - ROAD_START);
    for (let column = 0; column <= terrainColumns; column += 1) {
      const offset = (column / terrainColumns - 0.5) * 190;
      terrainPositions.push(roadX(distance) + offset, groundHeight(distance, offset), -distance);
      const shade = 0.16 + (Math.sin(distance * 0.035 + offset * 0.028) * 0.5 + 0.5) * 0.32;
      terrainColor.copy(mint).lerp(aqua, shade);
      terrainColors.push(terrainColor.r, terrainColor.g, terrainColor.b);
      if (row < terrainRows && column < terrainColumns) {
        const vertex = row * (terrainColumns + 1) + column;
        const next = vertex + terrainColumns + 1;
        terrainIndices.push(vertex, vertex + 1, next, next, vertex + 1, next + 1);
      }
    }
  }
  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(terrainPositions, 3));
  terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
  terrainGeometry.setIndex(terrainIndices);
  addMesh('journey-terrain', terrainGeometry, new THREE.MeshBasicMaterial({ vertexColors: true }));

  function makeRoad(width, elevation) {
    const positions = [];
    const indices = [];
    for (let step = 0; step <= 420; step += 1) {
      const distance = ROAD_START + (step / 420) * (ROAD_END - ROAD_START);
      const slope = roadSlope(distance);
      const normalScale = Math.sqrt(1 + slope * slope);
      const bank = THREE.MathUtils.clamp((roadSlope(distance + 5) - roadSlope(distance - 5)) * 0.25, -0.065, 0.065);
      for (const side of [-1, 1]) {
        const offset = side * width * 0.5;
        positions.push(
          roadX(distance) + offset / normalScale,
          roadHeight(distance) + elevation + offset * bank,
          -distance + offset * slope / normalScale,
        );
      }
      if (step < 420) {
        const vertex = step * 2;
        indices.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  addMesh('journey-road-edge', makeRoad(7.6, 0.1), new THREE.MeshBasicMaterial({ color: '#0eabb3' }));
  addMesh('journey-road', makeRoad(6.8, 0.145), new THREE.MeshBasicMaterial({ color: '#fbfcfc' }));

  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTop: { value: new THREE.Color('#aee6df') },
      uHorizon: { value: new THREE.Color('#fbfcfc') },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      void main() {
        float elevation = smoothstep(-0.1, 0.7, normalize(vDirection).y);
        gl_FragColor = vec4(mix(uHorizon, uTop, elevation), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = addMesh('journey-sky', new THREE.SphereGeometry(700, 24, 12), skyMaterial);
  sky.renderOrder = -10;

  function canRender() {
    return !disposed && hasSize && onScreen && !document.hidden;
  }

  function canAnimate() {
    return canRender() && !reducedMotion.matches && !motionPaused;
  }

  function drawFrame() {
    if (canRender()) renderer.render(scene, camera);
  }

  function updateAmbient(time) {
    for (let index = 0; index < treeMaterials.length; index += 1) {
      treeMaterials[index].rotation = Math.sin(time * 0.8 + index * 2.1) * 0.025;
    }
    for (const cloud of clouds) {
      if (cloud.skyLayer) {
        const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * cloud.depth;
        cloud.sprite.position.set(
          halfHeight * camera.aspect * cloud.x + Math.sin(time * 0.13 + cloud.phase) * 1.2,
          halfHeight * cloud.y + Math.cos(time * 0.16 + cloud.phase) * 0.3,
          -cloud.depth,
        );
        camera.localToWorld(cloud.sprite.position);
      } else {
        cloud.sprite.position.x = cloud.x + Math.sin(time * 0.13 + cloud.phase) * 1.8;
        cloud.sprite.position.y = cloud.y + Math.cos(time * 0.16 + cloud.phase) * 0.35;
      }
    }
    const frames = [0, 1, 2, 1];
    for (let index = 0; index < birds.length; index += 1) {
      const bird = birds[index];
      const distance = 24 + index * 3.5;
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
      const across = ((time * (0.11 + index * 0.007) + index * 0.173) % 1) * 2.6 - 1.3;
      bird.position.set(
        halfHeight * camera.aspect * across,
        4.2 + (index % 3) * 0.95 + Math.sin(time * 1.7 + index) * 0.35,
        -distance,
      );
      camera.localToWorld(bird.position);
      bird.material = birdMaterials[frames[Math.floor(time * 5.5 + index * 0.65) % frames.length]];
      const height = (45 + (index % 3) * 10) * halfHeight * 2 / viewHeight;
      const cellAspect = bird.material.map.image.width / (bird.material.map.image.height * 3);
      bird.scale.set(height * cellAspect, height, 1);
    }
    if (sun) {
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 150;
      sun.position.set(halfHeight * camera.aspect * 0.62, halfHeight * 0.7, -150);
      camera.localToWorld(sun.position);
    }
  }

  function animate(timestamp) {
    frameRequest = 0;
    if (!canAnimate()) return;
    const elapsed = previousFrame === null ? 0 : timestamp - previousFrame;
    if (previousFrame === null || elapsed >= FRAME_INTERVAL_MS) {
      ambientTime += previousFrame === null ? 0 : Math.min(elapsed / 1000, 0.1);
      previousFrame = timestamp - (elapsed % FRAME_INTERVAL_MS);
      updateAmbient(ambientTime);
      drawFrame();
    }
    frameRequest = requestAnimationFrame(animate);
  }

  function syncAnimation() {
    if (!canAnimate()) {
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      previousFrame = null;
      return;
    }
    if (!frameRequest) frameRequest = requestAnimationFrame(animate);
  }

  function requestRender() {
    if (canAnimate()) syncAnimation();
    else drawFrame();
  }

  function updateCamera() {
    let segment = 0;
    while (segment < READING_STOPS.length - 2 && progress > READING_STOPS[segment + 1]) segment += 1;
    const start = READING_STOPS[segment];
    const span = READING_STOPS[segment + 1] - start;
    const local = (progress - start) / span;
    const paced = start + span * (local - 0.78 * Math.sin(local * Math.PI * 2) / (Math.PI * 2));
    cameraDistance = 8 + paced * 240;
    const nearestReading = Math.min(Math.abs(progress - 0.19), Math.abs(progress - 0.54), Math.abs(progress - 0.88));
    const travel = THREE.MathUtils.smoothstep(nearestReading, 0.015, 0.12);
    const ahead = 18 + travel * 6;
    const turn = roadSlope(cameraDistance + 8) - roadSlope(cameraDistance - 8);
    const roll = THREE.MathUtils.clamp(turn * 0.2, -0.055, 0.055) * travel;
    camera.position.set(
      roadX(cameraDistance) + Math.sin(cameraDistance * 0.051) * 0.55 * travel,
      roadHeight(cameraDistance) + 3.45 + Math.sin(cameraDistance * 0.047) * 0.25 * travel,
      -cameraDistance,
    );
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.lookAt(roadX(cameraDistance + ahead), roadHeight(cameraDistance + ahead) + 1.2, -(cameraDistance + ahead));
    sky.position.copy(camera.position);
    updateAmbient(ambientTime);
  }

  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.round(bounds.width);
    const height = Math.round(bounds.height);
    hasSize = width > 0 && height > 0;
    if (hasSize) {
      viewHeight = height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_RENDER_PIXELS / (width * height)));
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 600 ? 67 : 58;
      camera.updateProjectionMatrix();
      updateAmbient(ambientTime);
      drawFrame();
    }
    syncAnimation();
  }

  function makeSprite(name, texture, height, material = null) {
    const spriteMaterial = material || new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.035, depthWrite: false });
    materials.add(spriteMaterial);
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.name = name;
    sprite.center.set(0.5, 0);
    sprite.scale.set(height * texture.image.width / texture.image.height, height, 1);
    sprites.push(sprite);
    scene.add(sprite);
    return sprite;
  }

  async function readTexture(name) {
    const controller = new AbortController();
    controllers.add(controller);
    let timeout;
    const interrupted = new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('asset load cancelled')), { once: true });
      timeout = setTimeout(() => controller.abort(), 10000);
    });
    const loading = (async () => {
      const response = await fetch(new URL(`./assets/${name}.png`, import.meta.url), { signal: controller.signal });
      if (!response.ok) throw new Error(`asset HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
      if (disposed || controller.signal.aborted) {
        bitmap.close();
        throw new Error('asset load cancelled');
      }
      const texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      bitmaps.add(bitmap);
      textures.add(texture);
      return texture;
    })();
    try {
      return await Promise.race([loading, interrupted]);
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  async function loadTexture(name) {
    try {
      return await readTexture(name);
    } catch {
      if (!disposed) {
        failedAssets.push(name);
        console.error(`[Journey] Generated asset could not be loaded: ${name}.png`);
      }
      return null;
    }
  }

  const ready = Promise.all(['tree', 'cloud', 'sun', 'birds'].map(loadTexture)).then(([treeTexture, cloudTexture, sunTexture, birdTexture]) => {
    if (disposed) return { disposed: true };
    if (treeTexture) {
      for (let phase = 0; phase < 3; phase += 1) {
        const material = new THREE.SpriteMaterial({ map: treeTexture, transparent: true, alphaTest: 0.035, depthWrite: false });
        materials.add(material);
        treeMaterials.push(material);
      }
      for (let index = 0; index < 60; index += 1) {
        const distance = -16 + (index / 60) * 355 + random() * 4;
        const nearRoad = index % 3 !== 0;
        const offset = (index % 2 === 0 ? -1 : 1) * (nearRoad ? 5.6 + random() * 6 : 15 + random() * 15);
        const height = nearRoad ? 6 + random() * 5.5 : 11 + random() * 8;
        const sprite = makeSprite(`tree-${index}`, treeTexture, height, treeMaterials[index % treeMaterials.length]);
        sprite.position.set(roadX(distance) + offset, groundHeight(distance, offset) - 0.05, -distance);
      }
    }
    if (cloudTexture) {
      const material = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, alphaTest: 0.025, depthWrite: false });
      const skyMaterial = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, alphaTest: 0.025, depthWrite: false, depthTest: false, fog: false });
      materials.add(material);
      materials.add(skyMaterial);
      for (let index = 0; index < 12; index += 1) {
        const skyLayer = index < 3;
        const distance = 32 + index * 29;
        const x = roadX(distance) + (index % 2 === 0 ? -1 : 1) * (18 + random() * 25);
        const y = roadHeight(distance) + 17 + random() * 9;
        const sprite = makeSprite(`cloud-${index}`, cloudTexture, skyLayer ? 11 + index * 2.5 : 5 + random() * 4.5, skyLayer ? skyMaterial : material);
        sprite.position.set(x, y, -distance);
        if (skyLayer) {
          sprite.center.set(0.5, 0.5);
          sprite.renderOrder = 2;
        }
        clouds.push({
          sprite,
          skyLayer,
          depth: 90 + index * 25,
          x: skyLayer ? [-0.72, 0.1, 0.85][index] : x,
          y: skyLayer ? [0.55, 0.82, 0.68][index] : y,
          phase: random() * Math.PI * 2,
        });
      }
    }
    if (sunTexture) {
      sun = makeSprite('sun', sunTexture, 25);
      sun.center.set(0.5, 0.5);
      sun.material.fog = false;
      sun.material.depthTest = false;
      sun.renderOrder = 1;
    }
    if (birdTexture) {
      // Three shared UV frames use the delivered atlas without editing pixels.
      for (let frame = 0; frame < 3; frame += 1) {
        const texture = birdTexture.clone();
        texture.repeat.set(1 / 3, 1);
        texture.offset.set(frame / 3, 0);
        texture.needsUpdate = true;
        textures.add(texture);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.025, depthWrite: false, depthTest: false });
        materials.add(material);
        birdMaterials.push(material);
      }
      for (let index = 0; index < 7; index += 1) {
        const sprite = makeSprite(`bird-${index}`, birdTexture, 2.2 + (index % 3) * 0.35, birdMaterials[index % 3]);
        sprite.scale.x /= 3;
        sprite.center.set(0.5, 0.5);
        sprite.renderOrder = 4;
        birds.push(sprite);
      }
    }
    updateAmbient(ambientTime);
    drawFrame();
    renderer.getDrawingBufferSize(bufferSize);
    let vertices = 0;
    let triangles = 0;
    for (const geometry of geometries) {
      vertices += geometry.getAttribute('position').count;
      triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
    }
    const report = {
      sprites: sprites.length,
      vertices,
      triangles: triangles + sprites.length * 2,
      drawnTriangles: renderer.info.render.triangles,
      uploadedTextures: renderer.info.memory.textures,
      buffer: `${bufferSize.x}x${bufferSize.y}`,
      failedAssets: failedAssets.join(',') || 'none',
    };
    console.info(`[Journey] Cartoon scene ready ${JSON.stringify(report)}`);
    syncAnimation();
    return report;
  });

  const onVisibilityChange = () => { syncAnimation(); requestRender(); };
  const onMotionChange = () => { syncAnimation(); requestRender(); };
  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    syncAnimation();
    requestRender();
  });
  document.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion.addEventListener('change', onMotionChange);
  resizeObserver.observe(canvas);
  intersectionObserver.observe(canvas);
  updateCamera();
  resize();

  return {
    ready,
    setProgress(nextProgress) {
      if (disposed || !Number.isFinite(nextProgress)) return;
      const bounded = Math.max(0, Math.min(1, nextProgress));
      if (bounded === progress) return;
      progress = bounded;
      updateCamera();
      drawFrame();
    },
    setMotionPaused(paused) {
      motionPaused = Boolean(paused);
      syncAnimation();
      requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', onMotionChange);
      for (const controller of controllers) controller.abort();
      scene.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      for (const bitmap of bitmaps) bitmap.close();
      geometries.clear();
      materials.clear();
      textures.clear();
      bitmaps.clear();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
