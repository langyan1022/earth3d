// Run after editing index.html: node scripts/check-farewell.cjs
// Browser smoke check: seek across 27.35..57.35s and confirm the same two-line captions overlay the live final scene.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('./three.legacy.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function extract(pattern, label) {
  const match = html.match(pattern);
  assert.ok(match, `Production ${label} exists`);
  return match[0];
}

const declarations = [
  extract(/    const FINAL_FORM_START = [^;]+;/, 'final-form start'),
  extract(/    const FAREWELL_START = [^;]+;/, 'farewell start'),
  extract(/    const FAREWELL_CUE_DURATION = [^;]+;/, 'farewell cue duration'),
  extract(/    const FAREWELL_CAPTIONS = \[[\s\S]*?\r?\n    \];/, 'farewell captions'),
  extract(/    const DURATION = [^;]+;/, 'duration')
].join('\n');
const smoothFunction = extract(/    function smooth\(a,b,x\) \{[\s\S]*?\r?\n    \}/, 'smooth function');
const updateFunction = extract(/    function updateFarewellCaption\(t\) \{[\s\S]*?\r?\n    \}/, 'farewell updater');
const captionMarkup = extract(/<p\b[^>]*\bid="farewellCaption"[^>]*>[\s\S]*?<\/p>/, 'farewell markup');
assert.equal((captionMarkup.match(/<span\b[^>]*\bdir="auto"[^>]*>/g) || []).length, 2,
  'Production markup has exactly two bidirectional caption lines');
assert.doesNotMatch(updateFunction, /set(?:Timeout|Interval)|requestAnimationFrame/, 'Farewell updater uses no separate timer');
assert.match(html, /function updateUi\(t,[\s\S]*?updateFarewellCaption\(t\)/, 'Existing playhead update calls farewell updater');

const lines = Array.from({length:2}, () => ({textContent:'', lang:''}));
const caption = {
  hidden:true,
  style:{opacity:''},
  querySelectorAll(selector) {
    assert.equal(selector, 'span', 'Production queries the two caption lines');
    return lines;
  }
};
const production = new Function('THREE', 'farewellCaption', `${declarations}\n${smoothFunction}
  const $ = id => {
    if (id !== 'farewellCaption') throw new Error('Unexpected DOM lookup: ' + id);
    return farewellCaption;
  };
  const farewellLines = farewellCaption.querySelectorAll('span');
  ${updateFunction}
  return {
    DURATION, FINAL_FORM_START, FAREWELL_START, FAREWELL_CUE_DURATION, FAREWELL_CAPTIONS,
    update(t) {
      updateFarewellCaption(t);
      return {
        hidden: farewellCaption.hidden,
        opacity: Number(farewellCaption.style.opacity),
        lines: Array.from(farewellLines, line => ({text:line.textContent, lang:line.lang}))
      };
    }
  };
`)(THREE, caption);

const {DURATION, FINAL_FORM_START, FAREWELL_START, FAREWELL_CUE_DURATION, FAREWELL_CAPTIONS} = production;
assert.ok(FAREWELL_CAPTIONS.length >= 10, 'At least ten farewell languages');
assert.equal(FAREWELL_CAPTIONS.length % 2, 0, 'Farewell languages form complete two-line groups');
assert.equal(new Set(FAREWELL_CAPTIONS.map(item => item.lang)).size, FAREWELL_CAPTIONS.length, 'Farewell language codes are unique');
assert.ok(FAREWELL_CAPTIONS.every(item => item.lang.toLowerCase().split('-')[0] !== 'ja'), 'Japanese is excluded');
assert.deepEqual(FAREWELL_CAPTIONS.slice(0, 4).map(item => item.lang.split('-')[0]), ['zh', 'en', 'fr', 'de']);
assert.equal(FAREWELL_START, FINAL_FORM_START + 2, 'Farewell starts two seconds after final formation');
assert.equal(FAREWELL_CUE_DURATION, 5, 'Each two-line cue occupies 5 seconds');
assert.equal(DURATION, 60, 'Timeline is exactly 60 seconds');
const farewellEnd = FAREWELL_START + FAREWELL_CAPTIONS.length / 2 * FAREWELL_CUE_DURATION;
assert.ok(farewellEnd <= DURATION, `All captions finish within the timeline (${farewellEnd} <= ${DURATION})`);

function expectHidden(t, label) {
  const state = production.update(t);
  assert.equal(state.hidden, true, `${label} hidden`);
  assert.equal(state.opacity, 0, `${label} opacity`);
}

expectHidden(0, 'Opening');
expectHidden(FINAL_FORM_START, 'Final-form start');
expectHidden(FAREWELL_START - 1 / 60, 'Before farewell');

for (let i = 0; i < FAREWELL_CAPTIONS.length / 2; i++) {
  const cues = FAREWELL_CAPTIONS.slice(i * 2, i * 2 + 2);
  const start = FAREWELL_START + i * FAREWELL_CUE_DURATION;
  expectHidden(start, `Group ${i + 1} start boundary`);
  const fadeIn = production.update(start + .5);
  assert.deepEqual(fadeIn.lines, cues.map(cue => ({text:cue.text, lang:cue.lang})), `Group ${i + 1} lines during fade-in`);
  assert.ok(fadeIn.opacity > 0 && fadeIn.opacity < 1, `Group ${i + 1} fades in`);
  assert.equal(fadeIn.hidden, false, `Group ${i + 1} visible during fade-in`);
  assert.ok(fadeIn.lines.filter(line => line.text).length <= 2, `Group ${i + 1} has at most two lines`);

  const hold = production.update(start + 1.4);
  assert.equal(hold.opacity, 1, `Group ${i + 1} holds fully visible`);
  assert.deepEqual(hold.lines, cues.map(cue => ({text:cue.text, lang:cue.lang})), `Group ${i + 1} holds its own lines`);
  assert.equal(production.update(start + 3.6).opacity, 1, `Group ${i + 1} hold/fade boundary`);

  const fadeOut = production.update(start + 4.1);
  assert.ok(fadeOut.opacity > 0 && fadeOut.opacity < 1, `Group ${i + 1} fades out`);
  assert.deepEqual(fadeOut.lines, cues.map(cue => ({text:cue.text, lang:cue.lang})), `Group ${i + 1} keeps its lines while fading out`);

  expectHidden(start + 4.6 + 1e-6, `Group ${i + 1} fade/gap boundary`);
  expectHidden(start + 4.8, `Gap after group ${i + 1}`);
}

const paused = production.update(FAREWELL_START + 1.4);
assert.deepEqual(production.update(FAREWELL_START + 1.4), paused, 'Repeated time is stable while paused');
production.update(FAREWELL_START + FAREWELL_CUE_DURATION + 1.4);
assert.deepEqual(production.update(FAREWELL_START + 1.4), paused, 'Backward seek restores the earlier cue');
expectHidden(0, 'Replay at zero');
expectHidden(farewellEnd, 'After final cue');
expectHidden(DURATION + 10, 'After timeline end');

console.log(`PASS: ${FAREWELL_CAPTIONS.length} unique non-Japanese captions play once as ${FAREWELL_CAPTIONS.length / 2} two-line groups in zh/en then fr/de order.`);
console.log('PASS: every group has fade-in, hold, fade-out and a blank gap with at most two visible lines.');
console.log(`PASS: all groups finish by ${farewellEnd.toFixed(2)}s; pause, seek, replay and the 60s endpoint derive only from playhead time.`);
