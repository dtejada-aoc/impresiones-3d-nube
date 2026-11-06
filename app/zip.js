"use strict";

/* ===================================================================
   Lectura y escritura de ficheros .zip, sin librerías.
   - Escribe sin comprimir (las fotos JPEG ya están comprimidas).
   - Lee ficheros sin comprimir o comprimidos con «deflate», que es lo
     que generan las copias de seguridad del ordenador (Python zipfile).
   =================================================================== */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** entries: [{ name, data: Uint8Array }] → Uint8Array con el .zip */
function zipWrite(entries) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const chunks = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // versión necesaria
    local.setUint16(6, 0x0800, true);    // nombres en UTF-8
    local.setUint16(8, 0, true);         // sin comprimir
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, e.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, e.data.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of parts) { out.set(c, pos); pos += c.length; }
  return out;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Este navegador no puede leer copias comprimidas; actualízalo a una versión más reciente");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ArrayBuffer del .zip → [{ name, data: Uint8Array }] */
async function zipRead(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new HttpError(400, "El fichero no es un .zip válido");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder("utf-8");
  const latin = new TextDecoder("latin1");
  const out = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new HttpError(400, "El .zip está dañado");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x0800 ? utf8 : latin).decode(rawName).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;

    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new HttpError(400, `Compresión no admitida en ${name}`);
    out.push({ name, data });
  }
  return out;
}
