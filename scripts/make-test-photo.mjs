// Writes a small test PNG (a warm "grill" gradient with a plate-like circle),
// so the photo-to-post flow can be tested without downloading anything.
// Usage: node scripts/make-test-photo.mjs <output.png>
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const [out] = process.argv.slice(2);
const W = 320;
const H = 240;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const i = y * (W * 3 + 1) + 1 + x * 3;
    const d = Math.hypot(x - W / 2, y - H / 2);
    const plate = d < 90;
    const food = d < 60;
    raw[i] = food ? 150 + ((x * y) % 60) : plate ? 240 : 60 + (y / H) * 120;
    raw[i + 1] = food ? 60 + ((x + y) % 40) : plate ? 236 : 30 + (y / H) * 40;
    raw[i + 2] = food ? 20 : plate ? 228 : 20;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: RGB
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log("wrote", out);
