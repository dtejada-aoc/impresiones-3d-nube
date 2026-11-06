"use strict";

/* ===================================================================
   SOLO PARA PRUEBAS (prueba.html, no se publica): imita nube-datos.js
   guardando en memoria, para probar la aplicación sin Supabase.
   Imita también la regla de seguridad: solo filas del usuario actual.
   =================================================================== */

function crearDatosLocales(uid) {
  const tablas = { impresiones: [], listas: [], ajustes: [], papelera: [] };
  const claves = { impresiones: ["id"], listas: ["tipo", "lista"], ajustes: [], papelera: ["num"] };
  const ficheros = new Map();
  let num = 0;
  const copia = (o) => structuredClone(o);
  const cumple = (fila, filtro) => fila.propietario === uid && Object.entries(filtro).every(([k, v]) => fila[k] === v);
  const proyectar = (fila, columnas) => {
    if (columnas === "*") return copia(fila);
    const out = {};
    for (const c of columnas.split(",").map((x) => x.trim())) out[c] = copia(fila[c]);
    return out;
  };
  const conPropietario = (fila) => {
    const f = { propietario: uid, ...copia(fila) };
    if (f.propietario !== uid) throw new Error("new row violates row-level security policy");
    return f;
  };
  const ruta = (r) => {
    if (r.split("/")[0] !== uid) throw new Error("new row violates row-level security policy (storage)");
    return r;
  };

  return {
    _tablas: tablas, _ficheros: ficheros,
    async select(tabla, filtro = {}, columnas = "*") {
      return tablas[tabla].filter((f) => cumple(f, filtro)).map((f) => proyectar(f, columnas));
    },
    async idsConPrefijo(prefijo) {
      return tablas.impresiones.filter((f) => f.propietario === uid && f.id.startsWith(prefijo)).map((f) => f.id);
    },
    async upsert(tabla, fila) {
      const f = conPropietario(fila);
      const i = tablas[tabla].findIndex((x) => x.propietario === uid && claves[tabla].every((k) => x[k] === f[k]));
      if (i >= 0) tablas[tabla][i] = { ...tablas[tabla][i], ...f };
      else tablas[tabla].push({ fotos: [], ...(tabla === "impresiones" ? {} : {}), ...f });
    },
    async insert(tabla, filas) {
      for (const fila of asArray(filas)) {
        const f = conPropietario(fila);
        if (tabla === "papelera") f.num = ++num;
        if (tabla !== "papelera" && tablas[tabla].some((x) => x.propietario === uid && claves[tabla].every((k) => x[k] === f[k]))) {
          throw new Error(`duplicate key value violates unique constraint "${tabla}_pkey"`);
        }
        tablas[tabla].push(tabla === "impresiones" ? { fotos: [], ...f } : f);
      }
    },
    async update(tabla, filtro, cambios) {
      for (const f of tablas[tabla]) if (cumple(f, filtro)) Object.assign(f, copia(cambios));
    },
    async delete(tabla, filtro) {
      tablas[tabla] = tablas[tabla].filter((f) => !cumple(f, filtro));
    },

    async subir(r, blob) { ficheros.set(ruta(r), blob); },
    async mover(de, a) {
      if (!ficheros.has(ruta(de))) throw new Error("Object not found");
      ficheros.set(ruta(a), ficheros.get(de));
      ficheros.delete(de);
    },
    async borrar(rutas) { for (const r of rutas) ficheros.delete(ruta(r)); },
    async descargar(r) {
      if (!ficheros.has(ruta(r))) throw new Error("Object not found");
      return ficheros.get(r);
    },
    async listar(carpeta) {
      const p = carpeta.replace(/\/$/, "") + "/";
      return [...ficheros.keys()].filter((k) => k.startsWith(p));
    },
    async urls(rutas) {
      const out = {};
      for (const r of rutas) if (ficheros.has(r)) out[r] = URL.createObjectURL(ficheros.get(r));
      return out;
    },
  };
}

// Supabase de mentira: un único usuario de prueba (prueba@local.test / prueba)
window.NUBE_CONFIG = { url: "local", clave: "local" };
const _uidPrueba = "00000000-0000-4000-8000-000000000001";
const _datosPrueba = crearDatosLocales(_uidPrueba);
window.PRUEBA = _datosPrueba;
window.supabase = {
  createClient: () => ({
    auth: {
      async getSession() {
        const s = sessionStorage.getItem("prueba:sesion");
        return { data: { session: s ? JSON.parse(s) : null } };
      },
      async signInWithPassword({ email, password }) {
        if (email !== "prueba@local.test" || password !== "prueba") return { data: {}, error: { message: "Invalid login credentials" } };
        const session = { user: { id: _uidPrueba, email } };
        sessionStorage.setItem("prueba:sesion", JSON.stringify(session));
        return { data: { session }, error: null };
      },
      async signOut() { sessionStorage.removeItem("prueba:sesion"); },
      onAuthStateChange() {},
    },
  }),
};
// eslint-disable-next-line no-global-assign
crearDatosSupabase = () => _datosPrueba;
