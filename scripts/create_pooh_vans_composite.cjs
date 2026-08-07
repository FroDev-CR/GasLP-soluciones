const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const sourceCharacter =
  "C:\\Users\\frodi\\AppData\\Local\\Temp\\codex-clipboard-02b6b9fa-6646-43c4-8df8-451a4e0e65ce.png";
const sourceShoes =
  "C:\\Users\\frodi\\AppData\\Local\\Temp\\codex-clipboard-338b47cb-e4e5-45bb-9109-0d92809233c3.png";
const outputDir = path.resolve("output");
const outputPath = path.join(outputDir, "pooh-matrix-vans-hd-v2.png");

const canvasWidth = 2048;
const canvasHeight = 2304;
const characterHeight = Math.round((713 / 778) * canvasWidth);

async function removeConnectedLightBackground(inputPath, trimResult = true) {
  const metadata = await sharp(inputPath).metadata();
  const borderCrop = 4;
  const { data, info } = await sharp(inputPath)
    .extract({
      left: borderCrop,
      top: borderCrop,
      width: metadata.width - borderCrop * 2,
      height: metadata.height - borderCrop * 2,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const background = new Uint8Array(width * height);
  const queued = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  function looksLikeBackground(pixelIndex) {
    const offset = pixelIndex * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return (r + g + b) / 3 >= 205 && max - min <= 28;
  }

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (queued[index] || !looksLikeBackground(index)) return;
    queued[index] = 1;
    queue[tail++] = index;
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    background[index] = 1;
    const x = index % width;
    const y = Math.floor(index / width);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const sourceOffset = index * channels;
    const targetOffset = index * 4;
    rgba[targetOffset] = data[sourceOffset];
    rgba[targetOffset + 1] = data[sourceOffset + 1];
    rgba[targetOffset + 2] = data[sourceOffset + 2];
    rgba[targetOffset + 3] = background[index] ? 0 : 255;
  }

  let result = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (trimResult) {
    result = result.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  return result.png().toBuffer();
}

async function createYellowLegOverlay(characterBuffer) {
  const { data, info } = await sharp(characterBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 4);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x;
      const offset = index * info.channels;
      const target = index * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const inLowerBody = y >= 1460 && x >= 990 && x <= 1820;
      const yellow = r >= 100 && r > g * 1.04 && g > b * 1.28;
      const edgeSoftness = Math.max(0, Math.min(1, (r - g * 1.04) / 34));

      output[target] = r;
      output[target + 1] = g;
      output[target + 2] = b;
      output[target + 3] = inLowerBody && yellow
        ? Math.round(data[offset + 3] * edgeSoftness)
        : 0;
    }
  }

  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .blur(0.35)
    .png()
    .toBuffer();
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const extendedBackground = await sharp(sourceCharacter)
    .extract({ left: 0, top: 0, width: 260, height: 713 })
    .resize(canvasWidth, canvasHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .blur(18)
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .png()
    .toBuffer();

  const characterBase = await sharp(sourceCharacter)
    .resize(canvasWidth, characterHeight, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: 1.15, m1: 0.8, m2: 2.2 })
    .png()
    .toBuffer();

  const fadeMask = Buffer.from(`
    <svg width="${canvasWidth}" height="${characterHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="1"/>
          <stop offset="91%" stop-color="white" stop-opacity="1"/>
          <stop offset="100%" stop-color="white" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#fade)"/>
    </svg>
  `);
  const character = await sharp(characterBase)
    .ensureAlpha()
    .composite([{ input: fadeMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const legOverlay = await createYellowLegOverlay(characterBase);

  const shoePairCutout = await removeConnectedLightBackground(sourceShoes, false);
  const shoePairMeta = await sharp(shoePairCutout).metadata();
  const foregroundShoeMask = Buffer.from(`
    <svg width="${shoePairMeta.width}" height="${shoePairMeta.height}" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="28,140 175,140 205,165 230,205 300,270 365,330 425,344 445,362 445,398 430,420 405,440 300,452 190,433 95,400 42,365 25,300"
        fill="white"
      />
    </svg>
  `);
  const foregroundShoeMaskPng = await sharp(foregroundShoeMask)
    .resize(shoePairMeta.width, shoePairMeta.height, { fit: "fill" })
    .png()
    .toBuffer();
  const shoePixels = await sharp(shoePairCutout).ensureAlpha().raw().toBuffer();
  const maskPixels = await sharp(foregroundShoeMaskPng)
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let index = 0; index < shoePairMeta.width * shoePairMeta.height; index += 1) {
    const alphaOffset = index * 4 + 3;
    shoePixels[alphaOffset] = Math.round(
      (shoePixels[alphaOffset] * maskPixels[alphaOffset]) / 255
    );
  }
  const singleShoe = await sharp(shoePixels, {
    raw: {
      width: shoePairMeta.width,
      height: shoePairMeta.height,
      channels: 4,
    },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const leftShoe = await sharp(singleShoe)
    .flop()
    .resize({ width: 500, withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
    .rotate(-2.5, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .sharpen({ sigma: 0.85 })
    .png()
    .toBuffer();

  const rightShoe = await sharp(singleShoe)
    .resize({ width: 500, withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
    .rotate(2.5, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .sharpen({ sigma: 0.85 })
    .png()
    .toBuffer();

  const groundShadow = await sharp(
    Buffer.from(`
      <svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="1010" cy="2118" rx="290" ry="40" fill="black" fill-opacity="0.54"/>
        <ellipse cx="1725" cy="2130" rx="280" ry="40" fill="black" fill-opacity="0.54"/>
      </svg>
    `)
  )
    .blur(22)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: "#0b1814",
    },
  })
    .composite([
      { input: extendedBackground, left: 0, top: 0 },
      { input: character, left: 0, top: 0 },
      { input: groundShadow, left: 0, top: 0, blend: "over" },
      { input: leftShoe, left: 740, top: 1715, blend: "over" },
      { input: rightShoe, left: 1490, top: 1715, blend: "over" },
      { input: legOverlay, left: 0, top: 0, blend: "over" },
    ])
    .sharpen({ sigma: 0.65 })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
