// Generates one MP3 per dialogue line with ElevenLabs.
// Usage: ELEVENLABS_API_KEY=... node generate-voices.mjs [--force]
// Voice ids can be overridden with VOICE_FALLOU / VOICE_DIARRA.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = html.match(/const scenes = (\[[\s\S]*?\n\]);/)[1];
const scenes = new Function('D', 'F', 'B', `return ${src}`)('D', 'F', 'B');

const KEY = process.env.ELEVENLABS_API_KEY || 'proxy-injected';
const VOICES = { F: process.env.VOICE_FALLOU, D: process.env.VOICE_DIARRA };
const force = process.argv.includes('--force');
const outDir = path.join(root, 'audio');
fs.mkdirSync(outDir, { recursive: true });

// Make names and Wolof words sound right.
const spoken = t => t
  .replace(/Jërëjëf/g, 'Djeuré-djeuf')
  .replace(/Xam Xam/g, 'Khame Khame')
  .replace(/Alxouran/g, 'Al-Khourane')
  .replace(/inch’Allah/g, 'inchallah');

async function tts(text, voice, prev, next) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_96`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      text, model_id: 'eleven_multilingual_v2', language_code: 'fr',
      previous_text: prev, next_text: next,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

const flat = scenes.flatMap((s, i) => s.lines.map((l, j) => ({ i, j, who: l[0], text: l[1] })));
for (let k = 0; k < flat.length; k++) {
  const { i, j, who, text } = flat[k];
  const prev = flat[k - 1]?.text, next = flat[k + 1]?.text;
  const parts = who === 'B' ? ['F', 'D'] : [who];
  for (const p of parts) {
    const file = path.join(outDir, `s${i}-${j}${who === 'B' ? '-' + p : ''}.mp3`);
    if (!force && fs.existsSync(file)) continue;
    fs.writeFileSync(file, await tts(spoken(text), VOICES[p], prev && spoken(prev), next && spoken(next)));
    console.log('ok', path.basename(file));
  }
}
