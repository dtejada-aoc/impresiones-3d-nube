"use strict";

/* ===================================================================
   «Servidor» de la versión en la nube. Responde a las mismas rutas
   /api/... que app.py en la versión de escritorio, pero guardando en
   Supabase (a través de nube-datos.js). app.js llama a nubeApi() desde api().

   Los datos de cada impresión, catálogo o registro se guardan como JSON,
   igual que los ficheros de la carpeta data/ del ordenador, así que las
   copias .zip son compatibles con las versiones de escritorio y móvil.
   =================================================================== */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const NUBE = { datos: null, uid: null };     // se rellena en nube.js al iniciar sesión
const ID_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;
const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
const MAX_UPLOAD = 25 * 1024 * 1024;
const LIST_KINDS = ["catalogos", "registros"];
const FOTO_MAX_PX = 2000;          // las fotos se reducen a este tamaño al subirlas
const URL_SEGUNDOS = 6 * 3600;     // validez de las direcciones de las fotos

const DEFAULT_SETTINGS = {
  copias: { carpeta: "", conservar: 10, automatica: true },
  costes: { activo: false, precioKWh: 0.20, postprocesadoHora: null, disenoHora: null },
  fallos: {
    disenoPct: null, disenoMarcada: false,
    generalPct: null, generalMarcada: false,
    placaPct: null, placaMarcada: false,
    postprocesadoPct: null, postprocesadoMarcada: false,
  },
};

// ------------------------------------------------------------------ utilidades

const pad = (n, w = 2) => String(n).padStart(w, "0");
/** Fecha local como en Python: 2026-10-20T12:34:56 */
function nowIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const stamp = (d = new Date()) => nowIso(d).replace(/\D/g, "");
const ascii = (s) => String(s).normalize("NFKD").replace(/[^\x00-\x7f]/g, "");

function slugify(text) {
  return ascii(text).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "impresion";
}
function splitName(name) {
  name = String(name).split(/[\\/]/).pop();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot).toLowerCase()] : [name, ""];
}
function safeFilename(name) {
  const [stem, ext] = splitName(name);
  const clean = ascii(stem).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "foto";
  return [clean.slice(0, 60), ext];
}
function checkId(pid) {
  if (!ID_RE.test(pid)) throw new HttpError(400, "id no válido");
  return pid;
}
const extOf = (path) => splitName(path)[1];
const rutaFoto = (pid, nombre) => `${NUBE.uid}/impresiones/${pid}/fotos/${nombre}`;

/**
 * Reduce una foto a FOTO_MAX_PX en el lado mayor, en el mismo formato.
 * Si ya es pequeña, o no se puede reducir (GIF, formato raro), se deja igual.
 */
async function reducirFoto(blob, tipo) {
  if (tipo === "image/gif" || typeof createImageBitmap === "undefined") return blob;
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { return blob; }
  const k = Math.min(1, FOTO_MAX_PX / Math.max(bmp.width, bmp.height));
  if (k >= 1) { bmp.close?.(); return blob; }
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const out = await new Promise((resolve) => c.toBlob(resolve, tipo, 0.85));
  return out && out.size < blob.size ? new Blob([out], { type: tipo }) : blob;
}

// ------------------------------------------------------------ direcciones de las fotos

/** Direcciones firmadas de las fotos ya cargadas: "id/nombre" → { url, hasta } */
const FOTO_URLS = new Map();

async function prepararFotos(items) {
  const ahora = Date.now();
  const faltan = [];
  for (const it of items) {
    for (const f of it.fotos || []) {
      const k = `${it.id}/${f}`;
      if (!(FOTO_URLS.get(k)?.hasta > ahora + 600000)) faltan.push([k, rutaFoto(it.id, f)]);
    }
  }
  if (!faltan.length) return;
  const urls = await NUBE.datos.urls(faltan.map(([, r]) => r), URL_SEGUNDOS);
  const hasta = ahora + URL_SEGUNDOS * 1000;
  for (const [k, r] of faltan) if (urls[r]) FOTO_URLS.set(k, { url: urls[r], hasta });
}

/** Dirección de una foto (la usa photoUrl de app.js). */
function nubeFotoUrl(id, nombre) {
  return FOTO_URLS.get(`${id}/${nombre}`)?.url || "data:,";
}

// ------------------------------------------------------------ configuración y ajustes

let _config = null;
async function loadConfig() {
  if (_config) return _config;
  const res = await fetch("config/campos.json", { cache: "no-cache" });
  if (!res.ok) throw new HttpError(500, "No se pudo cargar la configuración de campos");
  _config = await res.json();
  return _config;
}

async function loadSettings() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const [row] = await NUBE.datos.select("ajustes", {}, "datos");
  for (const [section, values] of Object.entries(row?.datos || {})) {
    if (values && typeof values === "object" && section in settings) Object.assign(settings[section], values);
  }
  return settings;
}

function cleanSettings(data) {
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const [section, defaults] of Object.entries(DEFAULT_SETTINGS)) {
    const values = data?.[section] ?? {};
    if (typeof values !== "object" || Array.isArray(values)) throw new HttpError(400, `Ajustes no válidos: ${section}`);
    for (const key of Object.keys(defaults)) {
      if (!(key in values)) continue;
      const v = values[key];
      if (key === "activo" || key === "automatica" || key.endsWith("Marcada")) out[section][key] = !!v;
      else if (key === "carpeta") out[section][key] = String(v || "").trim();
      else if (key === "conservar") out[section][key] = Math.max(1, Math.min(365, parseInt(v || 1, 10) || 1));
      else if (v === null || v === "") out[section][key] = null;
      else {
        const num = Number(v);
        if (!Number.isFinite(num)) throw new HttpError(400, `Valor no válido en ${key}`);
        if (num < 0) throw new HttpError(400, `El valor de ${key} no puede ser negativo`);
        out[section][key] = num;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ listas (catálogos y registros)

async function loadList(kind, lid) {
  const config = await loadConfig();
  const def = (config[kind] || []).find((d) => d.id === lid);
  if (!def) throw new HttpError(400, "Lista desconocida");
  const [row] = await NUBE.datos.select("listas", { tipo: kind, lista: lid }, "elementos");
  if (row) return row.elementos || [];
  const inicial = def.inicial || [];
  await NUBE.datos.upsert("listas", { propietario: NUBE.uid, tipo: kind, lista: lid, elementos: inicial });
  return inicial;
}

// ------------------------------------------------------------------ impresiones

const rowToPrint = (r) => ({ ...r.datos, id: r.id, fotos: [...(r.fotos || [])].sort() });

async function loadPrint(pid) {
  const [row] = await NUBE.datos.select("impresiones", { id: checkId(pid) }, "id, datos, fotos");
  return row ? rowToPrint(row) : null;
}

async function savePrint(pid, data, fotos) {
  const { id, fotos: _f, _tot, ...datos } = data; // eslint-disable-line no-unused-vars
  const fila = { propietario: NUBE.uid, id: pid, datos };
  if (fotos) fila.fotos = fotos;
  await NUBE.datos.upsert("impresiones", fila);
}

async function newId(data) {
  const nombre = data?.general?.nombre || "impresion";
  const d = new Date();
  const base = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${slugify(nombre)}`;
  const used = new Set(await NUBE.datos.idsConPrefijo(base));
  let pid = base, n = 2;
  while (used.has(pid)) pid = `${base}-${n++}`;
  return pid;
}

// ------------------------------------------------------------------ rutas

const NO_LOCAL = "En la versión en la nube no se pueden abrir archivos ni carpetas del ordenador";

/** Igual que la API de app.py: devuelve el objeto de la respuesta o lanza un error con su mensaje. */
async function nubeApi(method, url, body) {
  const u = new URL(url, location.href);
  const parts = u.pathname.slice(u.pathname.indexOf("/api/") + 5).split("/").filter(Boolean).map(decodeURIComponent);
  try {
    return await rutas(method, parts, u.searchParams, body);
  } catch (err) {
    if (err instanceof HttpError) throw new Error(err.message);
    throw new Error(traducirError(err));
  }
}

async function rutas(method, parts, query, body) {
  const p = parts.join("/");

  if (p === "config" && method === "GET") return loadConfig();

  if (p === "ajustes") {
    if (method === "GET") return { ...(await loadSettings()), carpetaPorDefecto: "" };
    if (method === "PUT") {
      const settings = cleanSettings(body);
      const [row] = await NUBE.datos.select("ajustes", {}, "datos");
      const ultimaCopia = row?.datos?.ultimaCopia;  // se conserva la fecha de la última copia
      await NUBE.datos.upsert("ajustes", { propietario: NUBE.uid, datos: { ...settings, ...(ultimaCopia ? { ultimaCopia } : {}) } });
      return { ...settings, carpetaPorDefecto: "" };
    }
  }

  // Copias: se descargan y se restauran desde un fichero (ver nube-copias.js)
  if (p === "copias" && method === "GET") return { carpeta: "la nube", copias: [] };
  if (p === "copias/abrir") throw new HttpError(400, NO_LOCAL);

  // /api/catalogos/<id>  y  /api/registros/<id>
  if (LIST_KINDS.includes(parts[0]) && parts.length === 2) {
    const [kind, lid] = parts;
    if (method === "GET") return loadList(kind, lid);
    if (method === "PUT") {
      const items = body;
      if (!Array.isArray(items) || !items.every((i) => i && typeof i === "object" && !Array.isArray(i))) {
        throw new HttpError(400, "Se esperaba una lista de elementos");
      }
      const previous = await loadList(kind, lid);
      if (items.length < previous.length) {
        await NUBE.datos.insert("papelera", { propietario: NUBE.uid, ruta: `${kind}/${lid}-${stamp()}.json`, datos: previous });
      }
      await NUBE.datos.upsert("listas", { propietario: NUBE.uid, tipo: kind, lista: lid, elementos: items });
      return items;
    }
  }
  if (parts[0] === "registros" && parts.length === 4 && parts[3] === "abrir") throw new HttpError(400, NO_LOCAL);

  if (parts[0] !== "impresiones") throw new HttpError(404, "Ruta desconocida");

  // /api/impresiones
  if (parts.length === 1) {
    if (method === "GET") {
      const items = (await NUBE.datos.select("impresiones", {}, "id, datos, fotos")).map(rowToPrint);
      await prepararFotos(items);
      return items;
    }
    if (method === "POST") {
      const data = { ...body };
      const pid = await newId(data);
      data.creado = data.modificado = nowIso();
      await savePrint(pid, data, []);
      return loadPrint(pid);
    }
  }

  const pid = checkId(parts[1] || "");

  // /api/impresiones/<id>
  if (parts.length === 2) {
    const current = await loadPrint(pid);
    if (!current) throw new HttpError(404, "Impresión no encontrada");
    if (method === "GET") { await prepararFotos([current]); return current; }
    if (method === "PUT") {
      const data = { ...body };
      data.creado = current.creado || nowIso();
      data.modificado = nowIso();
      await savePrint(pid, data);
      const saved = await loadPrint(pid);
      await prepararFotos([saved]);
      return saved;
    }
    if (method === "DELETE") {
      // No se borra: se guarda en la papelera (datos y fotos), como en el ordenador
      const carpeta = `${pid}-${stamp()}`;
      const { id, fotos, ...datos } = current; // eslint-disable-line no-unused-vars
      await NUBE.datos.insert("papelera", { propietario: NUBE.uid, ruta: `${carpeta}/datos.json`, datos });
      for (const f of fotos) await NUBE.datos.mover(rutaFoto(pid, f), `${NUBE.uid}/papelera/${carpeta}/fotos/${f}`);
      await NUBE.datos.delete("impresiones", { id: pid });
      return { ok: true };
    }
  }

  if (parts.length === 3 && parts[2] === "abrir") throw new HttpError(400, NO_LOCAL);

  // /api/impresiones/<id>/fotos[/<nombre>]
  if (parts.length >= 3 && parts[2] === "fotos") {
    const current = await loadPrint(pid);
    if (!current) throw new HttpError(404, "Impresión no encontrada");
    if (parts.length === 3 && method === "POST") {
      const [stem, ext] = safeFilename(query.get("nombre") || "foto.jpg");
      if (!PHOTO_EXT.includes(ext)) throw new HttpError(400, "Formato de imagen no admitido");
      if (!(body instanceof Blob) || !body.size) throw new HttpError(400, "Fichero vacío");
      if (body.size > MAX_UPLOAD) throw new HttpError(400, "Fichero demasiado grande");
      const existing = new Set(current.fotos);
      let name = `${stem}${ext}`, n = 2;
      while (existing.has(name)) name = `${stem}-${n++}${ext}`;
      await NUBE.datos.subir(rutaFoto(pid, name), await reducirFoto(body, MIME[ext]));
      await NUBE.datos.update("impresiones", { id: pid }, { fotos: [...current.fotos, name].sort() });
      return { nombre: name };
    }
    if (parts.length === 4 && method === "DELETE") {
      const name = splitName(parts[3]).join("");
      if (!current.fotos.includes(name)) throw new HttpError(404, "Foto no encontrada");
      await NUBE.datos.mover(rutaFoto(pid, name), `${NUBE.uid}/papelera/fotos/${pid}/${stamp()}-${name}`);
      await NUBE.datos.update("impresiones", { id: pid }, { fotos: current.fotos.filter((f) => f !== name) });
      FOTO_URLS.delete(`${pid}/${name}`);
      return { ok: true };
    }
  }

  throw new HttpError(404, "Ruta desconocida");
}

// ------------------------------------------------------------ copias (.zip)

/** Todos los datos en un .zip con la misma estructura que las copias del ordenador. */
async function nubeExportar(progreso = () => {}) {
  const enc = new TextEncoder();
  const jsonEntry = (name, obj) => ({ name, data: enc.encode(JSON.stringify(obj, null, 2)) });
  const blobEntry = async (name, ruta) => ({ name, data: new Uint8Array(await (await NUBE.datos.descargar(ruta)).arrayBuffer()) });
  const entries = [];

  const ajustes = await NUBE.datos.select("ajustes", {}, "datos");
  if (ajustes[0]) entries.push(jsonEntry("data/ajustes.json", ajustes[0].datos));
  for (const l of await NUBE.datos.select("listas", {}, "tipo, lista, elementos")) {
    entries.push(jsonEntry(`data/${l.tipo}/${l.lista}.json`, l.elementos));
  }
  const prints = await NUBE.datos.select("impresiones", {}, "id, datos, fotos");
  const totalFotos = prints.reduce((n, r) => n + (r.fotos || []).length, 0);
  let hechas = 0;
  for (const r of prints) {
    entries.push(jsonEntry(`data/impresiones/${r.id}/datos.json`, r.datos));
    for (const f of r.fotos || []) {
      progreso(`Descargando fotos (${++hechas} de ${totalFotos})…`);
      entries.push(await blobEntry(`data/impresiones/${r.id}/fotos/${f}`, rutaFoto(r.id, f)));
    }
  }
  for (const t of await NUBE.datos.select("papelera", {}, "ruta, datos")) entries.push(jsonEntry(`data/papelera/${t.ruta}`, t.datos));
  progreso("Descargando la papelera…");
  const prefijo = `${NUBE.uid}/papelera/`;
  for (const ruta of await NUBE.datos.listar(prefijo)) entries.push(await blobEntry(`data/papelera/${ruta.slice(prefijo.length)}`, ruta));

  const config = await fetch("config/campos.json").then((r) => r.arrayBuffer()).catch(() => null);
  if (config) entries.push({ name: "config/campos.json", data: new Uint8Array(config) });
  const d = new Date();
  const nombre = `impresiones3d-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`;
  const datos = (await loadSettings());
  await NUBE.datos.upsert("ajustes", { propietario: NUBE.uid, datos: { ...datos, ultimaCopia: { fecha: nowIso() } } });
  return new File([zipWrite(entries)], nombre, { type: "application/zip" });
}

/**
 * Sustituye todos los datos por los de una copia (.zip del ordenador, del móvil o de la nube).
 * Las fotos grandes se reducen al subirlas.
 */
async function nubeImportar(buffer, progreso = () => {}) {
  const entries = await zipRead(buffer);
  const dec = new TextDecoder("utf-8");
  const json = (e) => {
    let text = dec.decode(e.data);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    try { return JSON.parse(text); } catch { throw new HttpError(400, `Fichero dañado en la copia: ${e.name}`); }
  };
  const prints = new Map(), listas = [], papelera = [], fotos = [];
  let ajustes = null;
  for (const e of entries) {
    if (!e.name.startsWith("data/") || e.name.endsWith("/") || e.name.endsWith(".tmp")) continue;
    const path = e.name.slice(5);
    const ext = extOf(path);
    let m;
    if (path === "ajustes.json") ajustes = json(e);
    else if ((m = path.match(/^(catalogos|registros)\/([^/]+)\.json$/))) listas.push({ tipo: m[1], lista: m[2], elementos: json(e) });
    else if ((m = path.match(/^impresiones\/([^/]+)\/datos\.json$/)) && ID_RE.test(m[1])) prints.set(m[1], { datos: json(e), fotos: [] });
    else if (path.startsWith("papelera/") && ext === ".json") papelera.push({ ruta: path.slice(9), datos: json(e) });
    else if (PHOTO_EXT.includes(ext)) fotos.push({ path, data: e.data, ext });
  }
  if (!prints.size && !listas.length) {
    throw new HttpError(400, "El fichero no parece una copia de seguridad de la aplicación (no tiene carpeta data)");
  }

  // 1) Vaciar lo que hay ahora en la nube
  progreso("Borrando los datos anteriores…");
  for (const t of ["impresiones", "listas", "ajustes", "papelera"]) await NUBE.datos.delete(t, { propietario: NUBE.uid });
  await NUBE.datos.borrar(await NUBE.datos.listar(`${NUBE.uid}/`));
  FOTO_URLS.clear();

  // 2) Fotos (reducidas)
  let n = 0;
  for (const f of fotos) {
    progreso(`Subiendo fotos (${++n} de ${fotos.length})…`);
    const m = f.path.match(/^impresiones\/([^/]+)\/fotos\/([^/]+)$/);
    if (m && !prints.has(m[1])) continue;
    const blob = await reducirFoto(new Blob([f.data], { type: MIME[f.ext] }), MIME[f.ext]);
    await NUBE.datos.subir(`${NUBE.uid}/${f.path}`, blob);
    if (m) prints.get(m[1]).fotos.push(m[2]);
  }

  // 3) Datos
  progreso("Guardando los datos…");
  const uid = NUBE.uid;
  await NUBE.datos.insert("impresiones", [...prints].map(([id, p]) => ({ propietario: uid, id, datos: p.datos, fotos: p.fotos.sort() })));
  await NUBE.datos.insert("listas", listas.map((l) => ({ propietario: uid, ...l })));
  await NUBE.datos.insert("papelera", papelera.map((t) => ({ propietario: uid, ...t })));
  if (ajustes) await NUBE.datos.upsert("ajustes", { propietario: uid, datos: ajustes });
  return { impresiones: prints.size, fotos: [...prints.values()].reduce((s, p) => s + p.fotos.length, 0) };
}

async function nubeInfo() {
  const prints = await NUBE.datos.select("impresiones", {}, "id, fotos");
  const [row] = await NUBE.datos.select("ajustes", {}, "datos");
  return {
    impresiones: prints.length,
    fotos: prints.reduce((n, r) => n + (r.fotos || []).length, 0),
    ultimaCopia: row?.datos?.ultimaCopia?.fecha || null,
  };
}
