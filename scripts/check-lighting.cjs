// Run: node scripts/check-lighting.cjs
// Exercise the production synchronization against actual light positions and fixed surface normals.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('./three.legacy.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.match(/    function syncPlanetLighting\(\) \{[\s\S]*?\r?\n    \}/);
assert.ok(source, 'Production lighting synchronization exists');
const worldGroup = new THREE.Group();
worldGroup.rotation.order = 'YXZ';
const earthRoot = new THREE.Group();
earthRoot.position.set(-.18, -.02, 0);
earthRoot.rotation.set(-.087, .244, -Math.PI / 2);
worldGroup.add(earthRoot);
const earthSpin = new THREE.Group();
earthSpin.rotation.y = -.945;
earthRoot.add(earthSpin);
const visualSunDirection = new THREE.Vector3(-.9, -.04, -1).normalize();
const illuminationDirection = visualSunDirection.clone().lerp(new THREE.Vector3(0, 0, -1), .52).normalize();
const savedVisual = visualSunDirection.clone(), savedIllumination = illuminationDirection.clone();
const key = new THREE.DirectionalLight();
key.position.copy(earthRoot.position).addScaledVector(illuminationDirection, 12);
key.target = earthRoot;
worldGroup.add(key);
const sun = new THREE.Object3D();
sun.position.copy(earthRoot.position).addScaledVector(visualSunDirection, 7.9);
worldGroup.add(sun);
const fillLight = new THREE.HemisphereLight();
const atmosphere = {material:{uniforms:{uPlanetCenter:{value:new THREE.Vector3()},uSunDirection:{value:new THREE.Vector3()}}}};
const nightMaterial = {uniforms:{uSunDirection:{value:new THREE.Vector3()}}};
const sync = new Function('worldGroup', 'earthRoot', 'atmosphere', 'nightMaterial',
  'fillLight', 'illuminationDirection', 'visualSunDirection', source[0] + '\nsyncPlanetLighting();');
const normals = [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(.32,.56,.764).normalize()];
const directions = () => [atmosphere.material.uniforms.uSunDirection.value,
  nightMaterial.uniforms.uSunDirection.value, fillLight.position];
let baseline;
const near = (a,b,message) => assert.ok(Math.abs(a-b)<1e-10, `${message}: ${a} versus ${b}`);
const rotations = [[0,0],[.6,.3],[-1.1,-.4],[2.4,.8],[0,0]];
for (const [yaw,pitch] of rotations) {
  worldGroup.rotation.set(pitch,yaw,0);
  worldGroup.position.copy(earthRoot.position).sub(earthRoot.position.clone().applyQuaternion(worldGroup.quaternion));
  // A translated rig also verifies that the atmosphere receives the actual world-space center.
  if (yaw === -1.1) worldGroup.position.add(new THREE.Vector3(.7,-.2,.4));
  worldGroup.updateMatrixWorld(true);
  sync(worldGroup,earthRoot,atmosphere,nightMaterial,fillLight,illuminationDirection,visualSunDirection);
  const center = earthRoot.getWorldPosition(new THREE.Vector3());
  const direct = key.getWorldPosition(new THREE.Vector3()).sub(center).normalize();
  const visual = sun.getWorldPosition(new THREE.Vector3()).sub(center).normalize();
  near(directions()[0].distanceTo(direct),0,'Atmosphere follows the actual key light');
  near(directions()[1].distanceTo(visual),0,'Night mask follows the actual Sun');
  near(atmosphere.material.uniforms.uPlanetCenter.value.distanceTo(center),0,'Atmosphere sphere center');
  const values = normals.flatMap(n => {
    const worldNormal=n.clone().transformDirection(earthSpin.matrixWorld);
    return directions().map(d=>worldNormal.dot(d));
  });
  if (!baseline) baseline=values;
  values.forEach((v,i)=>near(v,baseline[i],'Lighting stays attached to the same surface point'));
  // Synchronization is idempotent; repeated frames must not accumulate rotation.
  for(let i=0;i<5;i++) sync(worldGroup,earthRoot,atmosphere,nightMaterial,fillLight,illuminationDirection,visualSunDirection);
  normals.flatMap(n=>directions().map(d=>n.clone().transformDirection(earthSpin.matrixWorld).dot(d)))
    .forEach((v,i)=>near(v,values[i],'No cumulative direction drift'));
  assert.deepEqual(visualSunDirection,savedVisual);
  assert.deepEqual(illuminationDirection,savedIllumination);
}
console.log('PASS: sunlight, night mask and sky fill stay fixed to the surface across yaw, pitch, translation and reset.');
console.log('PASS: world-space atmosphere center, unchanged local directions and repeated-frame stability.');
