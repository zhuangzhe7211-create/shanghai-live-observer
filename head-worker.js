import { env, InferenceSession, Tensor } from './assets/ort.wasm.min.mjs';

env.wasm.numThreads = 1;
env.wasm.wasmPaths = new URL('./assets/', import.meta.url).href;
async function readBinary(name) {
  const response = await fetch(new URL('./assets/' + name, import.meta.url));
  if (!response.ok) throw new Error('自动打码文件暂不可用');
  return response.arrayBuffer();
}

async function readRuntime() {
  if (typeof DecompressionStream === 'function') {
    const compressed = await fetch(new URL('./assets/ort-wasm-simd-threaded.wasm.gz', import.meta.url));
    if (compressed.ok && compressed.body) {
      return new Response(compressed.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
  }
  return readBinary('ort-wasm-simd-threaded.wasm');
}

const session = Promise.all([readBinary('head.onnx'), readRuntime()]).then(([model, runtime]) => {
  env.wasm.wasmBinary = runtime;
  return InferenceSession.create(model, { executionProviders: ['wasm'] });
});

function overlap(a, b) {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const intersection = x * y;
  return intersection / ((a.right - a.left) * (a.bottom - a.top) +
    (b.right - b.left) * (b.bottom - b.top) - intersection);
}

function decode(output, scale, offsetX, offsetY, imageWidth, imageHeight) {
  const [, first, second] = output.dims;
  const transposed = first === 5;
  if (!transposed && second !== 5) throw new Error('模型输出格式不匹配');
  const count = transposed ? second : first;
  const value = (index, channel) => output.data[transposed ? channel * count + index : index * second + channel];
  const candidates = [];
  for (let i = 0; i < count; i += 1) {
    const score = value(i, 4);
    if (score < .22) continue;
    const cx = value(i, 0), cy = value(i, 1);
    const w = value(i, 2), h = value(i, 3);
    const left = Math.max(0, (cx - .62 * w - offsetX) / scale);
    const top = Math.max(0, (cy - .63 * h - offsetY) / scale);
    const right = Math.min(imageWidth, (cx + .62 * w - offsetX) / scale);
    const bottom = Math.min(imageHeight, (cy + .63 * h - offsetY) / scale);
    if (right > left && bottom > top) candidates.push({ left, top, right, bottom, score });
  }
  return suppressDuplicates(candidates);
}

function suppressDuplicates(candidates) {
  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const box of candidates.slice(0, 700)) {
    if (!selected.some(existing => overlap(box, existing) > .52)) selected.push(box);
  }
  return selected;
}

async function detectRegion(model, bitmap, x, y, width, height) {
  const dimensions = model.inputMetadata[0]?.shape;
  const size = typeof dimensions?.[2] === 'number' ? dimensions[2] : 640;
  const scale = Math.min(size / width, size / height);
  const offsetX = (size - width * scale) / 2;
  const offsetY = (size - height * scale) / 2;
  const surface = new OffscreenCanvas(size, size);
  const ctx = surface.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#727272';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, x, y, width, height, offsetX, offsetY, width * scale, height * scale);
  const rgba = ctx.getImageData(0, 0, size, size).data;
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    tensor[i] = rgba[4 * i] / 255;
    tensor[i + plane] = rgba[4 * i + 1] / 255;
    tensor[i + 2 * plane] = rgba[4 * i + 2] / 255;
  }
  const result = await model.run({ [model.inputNames[0]]: new Tensor('float32', tensor, [1, 3, size, size]) });
  return decode(result[model.outputNames[0]], scale, offsetX, offsetY, width, height).map(box => ({
    left: box.left + x, top: box.top + y, right: box.right + x, bottom: box.bottom + y, score: box.score,
  }));
}

async function detect(bitmap) {
  const model = await session;
  const width = bitmap.width;
  const height = bitmap.height;
  const full = await detectRegion(model, bitmap, 0, 0, width, height);
  if (Math.max(width, height) < 780) return full;
  const tileWidth = Math.ceil(width * .67);
  const tileHeight = Math.ceil(height * .67);
  const combined = [...full];
  // Overlapping crops let the detector see smaller heads at a larger scale.
  for (const y of [0, height - tileHeight]) {
    for (const x of [0, width - tileWidth]) {
      combined.push(...await detectRegion(model, bitmap, x, y, tileWidth, tileHeight));
    }
  }
  return suppressDuplicates(combined);
}

self.addEventListener('message', async ({ data: { key, bitmap } }) => {
  try {
    const boxes = await detect(bitmap);
    self.postMessage({ key, boxes });
  } catch (error) {
    self.postMessage({ key, error: error.message });
  } finally {
    bitmap.close();
  }
});
