"use strict";

/* ===================================================================
   Acceso a Supabase (base de datos y almacenamiento de fotos).
   Todo lo que habla con Supabase está aquí; nube-api.js solo usa
   estas funciones. Así se puede probar con un almacén local
   (prueba-local.js) sin conectarse a Supabase.

   Tablas (ver supabase/esquema.sql): impresiones, listas, ajustes, papelera.
   Fotos: bucket privado «fotos», rutas <usuario>/impresiones/<id>/fotos/<nombre>
   y <usuario>/papelera/...
   =================================================================== */

const BUCKET = "fotos";

function crearDatosSupabase(sb) {
  const check = ({ data, error }) => {
    if (error) throw new Error(traducirError(error));
    return data;
  };

  return {
    /** Filas de una tabla que cumplen `filtro` ({columna: valor}); `prefijo` filtra ids que empiezan por… */
    async select(tabla, filtro = {}, columnas = "*") {
      let q = sb.from(tabla).select(columnas);
      for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
      return check(await q);
    },
    async idsConPrefijo(prefijo) {
      return check(await sb.from("impresiones").select("id").like("id", `${prefijo}%`)).map((r) => r.id);
    },
    async upsert(tabla, fila) { check(await sb.from(tabla).upsert(fila)); },
    async insert(tabla, filas) { if (asArray(filas).length) check(await sb.from(tabla).insert(filas)); },
    async update(tabla, filtro, cambios) {
      let q = sb.from(tabla).update(cambios);
      for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
      check(await q);
    },
    async delete(tabla, filtro) {
      let q = sb.from(tabla).delete();
      for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
      check(await q);
    },

    async subir(ruta, blob) {
      check(await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: blob.type || "application/octet-stream", upsert: true }));
    },
    async mover(de, a) { check(await sb.storage.from(BUCKET).move(de, a)); },
    async borrar(rutas) {
      for (let i = 0; i < rutas.length; i += 100) check(await sb.storage.from(BUCKET).remove(rutas.slice(i, i + 100)));
    },
    async descargar(ruta) { return check(await sb.storage.from(BUCKET).download(ruta)); },
    /** Todas las rutas de ficheros bajo una carpeta (recorre las subcarpetas). */
    async listar(carpeta) {
      const out = [];
      const recorrer = async (dir) => {
        for (let offset = 0; ; offset += 1000) {
          const items = check(await sb.storage.from(BUCKET).list(dir, { limit: 1000, offset }));
          for (const it of items) {
            const ruta = `${dir}/${it.name}`;
            if (it.id === null) await recorrer(ruta); // carpeta
            else out.push(ruta);
          }
          if (items.length < 1000) break;
        }
      };
      await recorrer(carpeta.replace(/\/$/, ""));
      return out;
    },
    /** Direcciones temporales (firmadas) para ver las fotos: { ruta: url } */
    async urls(rutas, segundos) {
      const out = {};
      for (let i = 0; i < rutas.length; i += 200) {
        for (const r of check(await sb.storage.from(BUCKET).createSignedUrls(rutas.slice(i, i + 200), segundos))) {
          if (r.signedUrl) out[r.path] = r.signedUrl;
        }
      }
      return out;
    },
  };
}

function traducirError(error) {
  const msg = String(error?.message || error);
  if (/JWT expired|invalid JWT|not authenticated/i.test(msg)) return "La sesión ha caducado: vuelve a entrar";
  if (/row-level security/i.test(msg)) return "No tienes permiso para guardar estos datos";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "No hay conexión con el servidor. Comprueba internet e inténtalo de nuevo";
  if (/payload too large|exceeded the maximum allowed size/i.test(msg)) return "El fichero es demasiado grande";
  return msg;
}
