// Run: node scripts/check-farewell-audio.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mix = JSON.parse(fs.readFileSync(path.join(root, 'audio/farewell-cues.json'), 'utf8'));
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
new Function(source); // The entire production module must remain syntactically valid.
const declarations = ['FINAL_FORM_START', 'FAREWELL_START', 'FAREWELL_CUE_DURATION', 'FAREWELL_CAPTIONS', 'DURATION']
  .map(name => source.match(new RegExp(`    const ${name} = [\\s\\S]*?;`))[0]).join('\n');
const timing = new Function(`${declarations}; return {FAREWELL_START, FAREWELL_CUE_DURATION, FAREWELL_CAPTIONS, DURATION};`)();
assert.equal(mix.duration, timing.DURATION);
assert.equal(mix.groups.length, 6);
assert.equal(mix.start, timing.FAREWELL_START);
for (const [i, group] of mix.groups.entries()) {
  assert.equal(group.start, timing.FAREWELL_START + i * timing.FAREWELL_CUE_DURATION);
  assert.equal(group.end, group.start + timing.FAREWELL_CUE_DURATION);
  assert.deepEqual(group.voices.map(v => v.locale.split('-')[0]), timing.FAREWELL_CAPTIONS.slice(i * 2, i * 2 + 2).map(v => v.lang.split('-')[0]));
  assert.ok(group.voices.every(v => v.seconds < timing.FAREWELL_CUE_DURATION), 'Both voices finish inside their subtitle slot');
}
assert.equal(mix.groups[0].voices[0].voice, 'zh-CN-YunyangNeural');
assert.match(html, /<audio[^>]+id="farewellAudio"[^>]+src="\.\/audio\/farewell-duet-60s\.mp3"/);
assert.ok(fs.statSync(path.join(root, 'audio/farewell-duet-60s.mp3')).size > 1000);

function production(media, document) {
  const functions = ['setFarewellSound', 'syncFarewellAudio', 'seekPlayback', 'replay', 'togglePlay']
    .map(name => source.match(new RegExp(`    function ${name}\\([^]*?\\n    \\}`))[0]).join('\n');
  const clock = source.match(/      if \(playing && !document.hidden\) \{[\s\S]*?\n      syncFarewellAudio\(\);/)[0];
  const button = { textContent: '', setAttribute() {}, title: '' };
  return new Function('farewellAudio', 'document', 'soundButton', `
    const DURATION = 60, $ = () => soundButton;
    let playing = false, playhead = 27.35, farewellSoundEnabled = false, farewellAudioStarting = false;
    ${functions}
    return { enable: setFarewellSound, seek: seekPlayback, replay, toggle: togglePlay, sync: syncFarewellAudio,
      tick(dt) { ${clock} }, state: () => ({playing, playhead, enabled: farewellSoundEnabled}), button: soundButton };
  `)(media, document, button);
}

async function check() {
  let rejectPlay = false, starts = 0;
  const media = { paused: true, ended: false, readyState: 4, seeking: false, currentTime: 0,
    play() { starts++; if (rejectPlay) return Promise.reject({name: 'NotAllowedError'}); this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  };
  const doc = { hidden: false, querySelector: () => ({removeAttribute() {}, setAttribute() {}}) };
  const app = production(media, doc);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  app.enable(true);
  assert.equal(media.currentTime, 27.35);
  assert.equal(media.paused, true, 'Enabling sound does not unpause the animation');
  app.toggle(); await settle();
  assert.equal(media.paused, false);
  media.currentTime = 29.2; app.tick(.05);
  assert.equal(app.state().playhead, 29.2, 'Rendering follows audio even after a slow frame');
  app.toggle();
  assert.equal(media.paused, true, 'Pause stops sound');
  app.seek(43.35);
  assert.equal(media.currentTime, 43.35, 'Paused seek updates the audio position');
  app.toggle(); await settle();
  app.seek(33.35);
  assert.equal(media.currentTime, 33.35, 'Playing backward seek updates both timelines');
  media.seeking = true; media.currentTime = 0; app.tick(.05);
  assert.equal(app.state().playhead, 33.35, 'An unfinished media seek cannot reset the animation');
  media.seeking = false; media.currentTime = 33.35;
  doc.hidden = true; app.sync(true); app.tick(.05);
  assert.equal(media.paused, true, 'Hidden page pauses sound');
  assert.equal(app.state().playhead, 33.35);
  doc.hidden = false; app.sync(true); await settle();
  assert.equal(media.paused, false, 'Visible page resumes from its saved position');
  app.enable(false);
  assert.equal(media.paused, true);
  app.replay(); assert.equal(media.currentTime, 0);
  assert.equal(app.state().enabled, false, 'Replay preserves the sound preference');
  app.enable(true); await settle(); app.seek(60); app.tick(.05);
  assert.equal(media.paused, true, 'The full track stops at 60 seconds');
  assert.ok(app.state().playhead > 60, 'The final visual animation keeps moving');
  app.seek(27.35); await settle(); app.toggle(); rejectPlay = true; app.toggle(); await settle();
  assert.equal(app.state().enabled, false, 'Playback rejection leaves a retryable silent state');
  assert.equal(app.button.textContent, '重试声音');
  assert.ok(starts > 0);
  console.log('PASS: six bilingual groups match subtitle timing; Chinese uses Yunyang male voice.');
  console.log('PASS: audio clock, pause, both seek directions, pending seek, replay, mute, visibility, end and blocked playback.');
}
check().catch(error => { console.error(error); process.exitCode = 1; });
