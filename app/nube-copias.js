"use strict";

/* ===================================================================
   Versión en la nube: en Configuración, la sesión y las copias de
   seguridad (.zip para descargar o compartir, y restaurar desde un
   fichero). Los .zip son los mismos que hacen las versiones de
   escritorio y móvil, así que sirven para pasar los datos entre ellas.
   Se carga después de configuracion.js y antes de app.js.
   =================================================================== */

const viewSettingsBase = viewSettings;

// eslint-disable-next-line no-global-assign
viewSettings = async function viewSettingsNube() {
  await viewSettingsBase();
  const root = document.getElementById("settings-root");
  if (!root) return;
  root.querySelector(".page-head p").textContent = "Ajustes generales de la aplicación. Se guardan en la nube con tus datos.";
  const card = document.getElementById("backup-now")?.closest(".card");
  if (!card) return;

  card.innerHTML = `<h2>Sesión y copias de seguridad</h2>
    <p class="muted note">Has entrado como <strong>${esc(NUBE.email || "")}</strong>.
      <button class="btn btn-sm" id="n-salir">Cerrar sesión</button></p>
    <p class="muted note">Tus datos están guardados en la nube (Supabase). Descarga una copia de vez en cuando y guárdala
      en otro sitio: si algún día dejas de usar Supabase, con ella te llevas todos tus datos.</p>
    <div id="n-info" class="movil-info muted small">Calculando…</div>
    <div class="editor-actions movil-acciones">
      <button class="btn btn-primary" id="n-descargar">Descargar copia (.zip)</button>
      <button class="btn" id="n-compartir" hidden>Compartir copia…</button>
      <label class="btn" for="n-fichero">Restaurar una copia…</label>
      <input type="file" id="n-fichero" accept=".zip,application/zip" hidden>
    </div>
    <p id="n-progreso" class="muted small" hidden></p>
    <details class="movil-ayuda"><summary class="small">Cómo pasar los datos de las otras versiones</summary>
      <ul class="small">
        <li><strong>Desde el ordenador:</strong> en la aplicación del ordenador, <em>Configuración → Hacer copia ahora</em>,
          y aquí pulsa <em>Restaurar una copia</em> con ese .zip (está en la carpeta de copias).</li>
        <li><strong>Desde la versión móvil:</strong> allí <em>Descargar copia</em> o <em>Compartir copia</em>, y aquí
          <em>Restaurar una copia</em>.</li>
        <li>Restaurar una copia <strong>sustituye todos los datos</strong> de la nube: no se mezclan. Las fotos grandes se
          reducen (2000 px) para no llenar el espacio gratuito.</li>
      </ul>
    </details>
    <div id="backup-list" hidden></div>`;

  const when = (iso) => new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  const progreso = (txt) => {
    const el = document.getElementById("n-progreso");
    if (el) { el.hidden = !txt; el.textContent = txt || ""; }
  };

  const showInfo = async () => {
    const el = document.getElementById("n-info");
    if (!el) return;
    try {
      const i = await nubeInfo();
      const dias = i.ultimaCopia ? (Date.now() - new Date(i.ultimaCopia)) / 86400000 : Infinity;
      el.innerHTML = `<div>${esc(String(i.impresiones))} impresión(es) y ${esc(String(i.fotos))} foto(s)</div>
        <div class="${dias > 30 ? "warn" : ""}">Última copia descargada: ${i.ultimaCopia ? esc(when(i.ultimaCopia)) : "nunca"}</div>`;
    } catch (err) { el.textContent = traducirError(err); }
  };
  showInfo();

  const run = (btn, fn) => async () => {
    const text = btn.textContent;
    btn.disabled = true; btn.textContent = "Preparando…";
    try { await fn(); } catch (err) { if (err.name !== "AbortError") toast(traducirError(err), true); }
    finally { btn.disabled = false; btn.textContent = text; progreso(""); showInfo(); }
  };

  document.getElementById("n-salir").onclick = async () => {
    if (formDirty && !confirm("Hay cambios sin guardar. ¿Cerrar la sesión igualmente?")) return;
    await nubeCerrarSesion();
  };

  const bDescargar = document.getElementById("n-descargar");
  bDescargar.onclick = run(bDescargar, async () => {
    const file = await nubeExportar(progreso);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`Copia descargada: ${file.name}`);
  });

  const bCompartir = document.getElementById("n-compartir");
  const prueba = new File([""], "prueba.zip", { type: "application/zip" });
  bCompartir.hidden = !(navigator.canShare && navigator.canShare({ files: [prueba] }));
  bCompartir.onclick = run(bCompartir, async () => {
    const file = await nubeExportar(progreso);
    await navigator.share({ files: [file], title: file.name });
  });

  document.getElementById("n-fichero").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!confirm(`¿Restaurar «${file.name}»?\n\nSe sustituirán TODOS los datos que hay en la nube por los de la copia. `
      + "Si tienes datos aquí que no estén en esa copia, descarga antes una copia.\n\n"
      + "No cierres la aplicación hasta que termine. Si se corta la conexión, vuelve a restaurar la misma copia.")) return;
    const label = document.querySelector('label[for="n-fichero"]');
    label.classList.add("disabled");
    try {
      const r = await nubeImportar(await file.arrayBuffer(), progreso);
      alert(`Copia restaurada: ${r.impresiones} impresión(es) y ${r.fotos} foto(s).`);
      location.hash = "#/";
      location.reload();
    } catch (err) {
      toast(traducirError(err), true);
    } finally {
      label.classList.remove("disabled");
      progreso("");
    }
  };
};
