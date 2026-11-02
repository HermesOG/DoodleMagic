/** Нецелые числа снапшота округляются до 1e−5: 10 мкм по положению, JSON вдвое короче. */
export const QUANT = 1e5;
export const MAX_DECODED_BYTES = 4 * 1024 * 1024;
const FORMAT_JSON = 0;
const FORMAT_DEFLATE = 1;

/** Глубокая копия: нецелые конечные числа округлены, −0 → 0, NaN и ±Infinity → 0. Строки, true/false, null — как есть. */
export function quantize(v: unknown): unknown {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0;
    return (Number.isInteger(v) ? v : Math.round(v * QUANT) / QUANT) + 0;
  }
  if (Array.isArray(v)) return v.map(quantize);
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = quantize((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

/** Байты, пригодные для Blob: копия с обычным ArrayBuffer (вид на SharedArrayBuffer или чужой буфер Blob не берёт). */
function blobSafe(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

function toStream(bytes: Uint8Array) {
  return new Blob([blobSafe(bytes)]).stream();
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const packed = toStream(bytes).pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(packed).arrayBuffer());
}

/** Распаковка с потолком: поток читается кусками и обрывается, как только вышел за MAX_DECODED_BYTES (бомба распаковки). */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  const reader = toStream(bytes).pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECODED_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Первый байт — формат: 1 — JSON(quantize(value)) в deflate-raw; 0 — тот же JSON без сжатия (нет CompressionStream). */
export async function encodeBinary(value: unknown): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(quantize(value)) ?? "null");
  const compress = typeof CompressionStream !== "undefined";
  const body = compress ? await deflate(json) : json;
  const out = new Uint8Array(1 + body.length);
  out[0] = compress ? FORMAT_DEFLATE : FORMAT_JSON;
  out.set(body, 1);
  return out;
}

/** Обратно. Любой сбой (формат, распаковка, JSON, больше MAX_DECODED_BYTES) → undefined. */
export async function decodeBinary(data: ArrayBuffer | Uint8Array): Promise<unknown> {
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length < 2) return undefined;
    const format = bytes[0];
    const body = bytes.subarray(1);
    let json: Uint8Array | undefined;
    if (format === FORMAT_JSON) json = body.length > MAX_DECODED_BYTES ? undefined : body;
    else if (format === FORMAT_DEFLATE && typeof DecompressionStream !== "undefined") json = await inflate(body);
    if (json === undefined) return undefined;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    return undefined;
  }
}
