// Run: node scripts/check-solar-trajectory.cjs [path/to/index.html] [optional baseline.html]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('./three.legacy.js');

const sourcePath = path.resolve(process.argv[2] || path.join(__dirname, '../index.html'));
function buildSampler(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const match = (pattern, label) => {
    const found = html.match(pattern);
    assert.ok(found, `Production ${label} exists in ${filePath}`);
    return found[0];
  };
  const constants = [
    'EARTH_TURN_START', 'EARTH_TURN_END', 'HORIZONTAL_ALIGN_START',
    'HORIZONTAL_ALIGN_END', 'FINAL_OCCULT_START', 'FINAL_OCCULT_END',
    'FINAL_FORM_START', 'R', 'SUN_DISTANCE'
  ].map(name => match(new RegExp(`    const ${name} = [^;]+;`), name)).join('\n');
  const directions = [
    match(/    const terminalSunDirection = new THREE\.Vector3\([^;]+;/, 'terminal Sun direction'),
    match(/    const hiddenSunDirection = new THREE\.Vector3\([^;]+;/, 'hidden Sun direction')
  ].join('\n');
  const smoothFunction = match(/    function smooth\(a,b,x\) \{[\s\S]*?\r?\n    \}/, 'smooth function');
  const orbitCode = match(/      const approach = smooth\(\.4, 6\.7, t\);[\s\S]*?      sun\.group\.scale\.setScalar\([^;]+;/, 'Sun orbit calculation');
  const cameraCode = match(/      const yaw = autoYaw, pitch = THREE\.MathUtils\.clamp\(autoPitch, -1\.15, 1\.15\);[\s\S]*?      worldGroup\.updateMatrixWorld\(\);/, 'camera and world framing calculation');

  return new Function('THREE', `${constants}\n${directions}\n${smoothFunction}
  const yawOffset = 0, pitchOffset = 0, zoomOffset = 0;
  return function sample(t) {
    const earthRoot = new THREE.Group();
    const sun = {group:new THREE.Group()};
    const sunOrbitDirection = new THREE.Vector3();
    const worldGroup = new THREE.Group();
    worldGroup.rotation.order = 'YXZ';
    worldGroup.add(earthRoot, sun.group);
    const camera = new THREE.PerspectiveCamera(39, 16 / 9, .06, 160);
    const cameraTarget = new THREE.Vector3();
    const worldDragPivot = new THREE.Vector3();
    ${orbitCode}
    ${cameraCode}
    const earthWorld = earthRoot.getWorldPosition(new THREE.Vector3());
    const sunWorld = sun.group.getWorldPosition(new THREE.Vector3());
    const localDirection = sun.group.position.clone().sub(earthRoot.position).normalize();
    const earthNdc = earthWorld.clone().project(camera);
    const sunNdc = sunWorld.clone().project(camera);
    return {
      t,
      distance: sun.group.position.distanceTo(earthRoot.position),
      direction: localDirection,
      screenX: sunNdc.x - earthNdc.x,
      screenY: sunNdc.y - earthNdc.y,
      camera: camera.position.clone(),
      earth: earthRoot.position.clone(),
      sun: sun.group.position.clone(),
      earthWorld,
      sunWorld,
      terminal: terminalSunDirection.clone(),
      earthRadius: R
    };
  };
`)(THREE);
}

const makeSampler = buildSampler(sourcePath);

const fps = 60;
const samples = [];
for (let frame = Math.ceil(14.5 * fps); frame <= Math.ceil(27 * fps); frame++) {
  samples.push(makeSampler(frame / fps));
}

let maxSpeed = 0;
let reversals = 0;
let priorSign = 0;
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1], b = samples[i];
  const speed = THREE.MathUtils.radToDeg(a.direction.angleTo(b.direction)) * fps;
  maxSpeed = Math.max(maxSpeed, speed);
  const dx = b.screenX - a.screenX;
  const sign = Math.abs(dx) < 1e-5 ? 0 : Math.sign(dx);
  if (sign && priorSign && sign !== priorSign) reversals++;
  if (sign) priorSign = sign;
  assert.ok(Math.abs(b.distance - 7.9) < 1e-9, `Sun-Earth distance drifted at t=${b.t.toFixed(3)}: ${b.distance}`);
}

assert.equal(reversals, 0, `Sun reverses horizontally ${reversals} time(s); maximum angular speed=${maxSpeed.toFixed(2)}°/s`);
assert.ok(maxSpeed < 12, `Sun angular speed spikes to ${maxSpeed.toFixed(2)}°/s`);

const stableA = makeSampler(25.35);
const stableB = makeSampler(27);
assert.ok(stableA.direction.angleTo(stableB.direction) < 1e-10, 'Sun direction must be stable after final formation');
assert.ok(stableA.sun.distanceTo(stableB.sun) < 1e-10, 'Sun position must be stable after final formation');
assert.ok(stableA.camera.distanceTo(stableB.camera) < 1e-10, 'Camera must be stable after final formation');
assert.ok(stableA.earth.distanceTo(stableB.earth) < 1e-10, 'Earth position must be stable after final formation');
assert.ok(stableB.direction.angleTo(stableB.terminal) < 1e-10, 'Final Sun direction must reach the production terminal direction');

// The camera-to-Sun ray must cross the Earth sphere before reaching the Sun.
const cameraToSun = stableB.sunWorld.clone().sub(stableB.camera);
const sunDistance = cameraToSun.length();
const rayDirection = cameraToSun.normalize();
const cameraToEarth = stableB.earthWorld.clone().sub(stableB.camera);
const closestAlongRay = cameraToEarth.dot(rayDirection);
const closestDistance = Math.sqrt(Math.max(0, cameraToEarth.lengthSq() - closestAlongRay ** 2));
assert.ok(closestAlongRay > 0 && closestAlongRay < sunDistance,
  `Earth is not between camera and Sun (${closestAlongRay} outside 0..${sunDistance})`);
assert.ok(closestDistance < stableB.earthRadius,
  `Camera-to-Sun ray misses Earth (${closestDistance} >= ${stableB.earthRadius})`);

if (process.argv[3]) {
  const baselinePath = path.resolve(process.argv[3]);
  const baselineSampler = buildSampler(baselinePath);
  const unchangedTimes = [0, 6, 8, 12, 14.5, 27];
  for (const t of unchangedTimes) {
    const current = makeSampler(t), baseline = baselineSampler(t);
    assert.ok(current.sun.distanceTo(baseline.sun) < 1e-10, `Sun keyframe changed at t=${t}`);
    assert.ok(current.earth.distanceTo(baseline.earth) < 1e-10, `Earth keyframe changed at t=${t}`);
    assert.ok(current.camera.distanceTo(baseline.camera) < 1e-10, `Camera keyframe changed at t=${t}`);
  }
  console.log(`PASS: opening/turn keyframes through 14.5s and terminal 27s match ${path.basename(baselinePath)}.`);
}

console.log(`PASS: ${path.basename(sourcePath)} Sun stays ${samples[0].distance.toFixed(1)} units from Earth and moves one way after the turn.`);
console.log(`PASS: horizontal reversals=${reversals}, maximum angular speed=${maxSpeed.toFixed(2)}°/s, stable from 25.35s.`);
console.log(`PASS: terminal camera-to-Sun ray crosses Earth (${closestDistance.toFixed(3)} < radius ${stableB.earthRadius.toFixed(1)}).`);
