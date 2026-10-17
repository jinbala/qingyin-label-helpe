import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Reuses the native canvas development dependency; generated PNGs are bundled
// with the extension and need no drawing library at runtime.
const require = createRequire(new URL('../tests/package.json', import.meta.url));
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const directory = new URL('../assets/icons/', import.meta.url);
await mkdir(directory, { recursive: true });
const image = await loadImage(await readFile(new URL('master.svg', directory)));
for (const size of [16, 32, 48, 128]) {
  const canvas = createCanvas(size, size), context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, size, size);
  await writeFile(new URL(`icon-${size}.png`, directory), canvas.toBuffer('image/png'));
}
console.log('Generated 16/32/48/128 px Qingyin icons.');
