"use strict";

/* ===================================================================
   Arranque de la versión en la nube: conecta con Supabase, pide iniciar
   sesión si hace falta y después carga la aplicación (los mismos scripts
   que la versión de escritorio).
   =================================================================== */

const SCRIPTS = ["informes.js", "registros.js", "configuracion.js", "ficha.js", "cambios.js", "nube-copias.js", "app.js"];

function cargarScripts(lista) {
  return lista.reduce((p, src) => p.then(() => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`No se ha podido cargar ${src}. Comprueba la conexión y vuelve a abrir la aplicación.`));
    document.body.appendChild(s);
  })), Promise.resolve());
}

function nubeFallo(msg) {
  document.getElementById("app").innerHTML = `<div class="card empty"><h2>No se puede iniciar la aplicación</h2>
    <p class="muted">${msg}</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`;
}

/** Pantalla de inicio de sesión. Devuelve la sesión cuando se entra correctamente. */
function pantallaLogin(sb) {
  document.body.classList.add("sin-sesion");
  const app = document.getElementById("app");
  app.innerHTML = `<form class="card card-pad login" id="login" novalidate>
      <div class="login-marca"><img src="icono.svg" alt="" width="56" height="56"><h1>Impresiones 3D</h1></div>
      <p class="muted">Entra con tu cuenta para ver y editar tus datos.</p>
      <div class="field"><label for="l-email">Correo electrónico</label>
        <input type="email" id="l-email" autocomplete="username" required></div>
      <div class="field"><label for="l-pass">Contraseña</label>
        <input type="password" id="l-pass" autocomplete="current-password" required></div>
      <p class="neg small" id="l-error" hidden></p>
      <button class="btn btn-primary" type="submit" id="l-entrar">Entrar</button>
    </form>`;
  document.getElementById("l-email").focus();
  return new Promise((resolve) => {
    document.getElementById("login").onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById("l-email").value.trim();
      const password = document.getElementById("l-pass").value;
      const err = document.getElementById("l-error");
      const btn = document.getElementById("l-entrar");
      if (!email || !password) { err.textContent = "Escribe el correo y la contraseña."; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Entrando…"; err.hidden = true;
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      btn.disabled = false; btn.textContent = "Entrar";
      if (error) {
        err.textContent = /invalid login credentials/i.test(error.message) ? "Correo o contraseña incorrectos."
          : /email not confirmed/i.test(error.message) ? "Falta confirmar el correo de esta cuenta (en Supabase)."
          : traducirError(error);
        err.hidden = false;
        return;
      }
      document.body.classList.remove("sin-sesion");
      resolve(data.session);
    };
  });
}

async function nubeCerrarSesion() {
  await window.SB.auth.signOut();
  location.hash = "#/";
  location.reload();
}

(async () => {
  const cfg = window.NUBE_CONFIG || {};
  if (!cfg.url || !cfg.clave || /PEGA_AQUI/.test(cfg.url + cfg.clave)) {
    return nubeFallo("Falta configurar la conexión con Supabase en <code>config.js</code>.");
  }
  if (!window.supabase?.createClient) return nubeFallo("No se ha podido cargar Supabase. Comprueba la conexión a internet.");

  const sb = window.supabase.createClient(cfg.url, cfg.clave, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "impresiones3d-sesion" },
  });
  window.SB = sb;

  let { data: { session } } = await sb.auth.getSession();
  if (!session) session = await pantallaLogin(sb);

  NUBE.datos = crearDatosSupabase(sb);
  NUBE.uid = session.user.id;
  NUBE.email = session.user.email;
  // Si se cierra la sesión en otra pestaña o caduca sin poder renovarse, volver a pedirla
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.reload(); });

  try {
    await cargarScripts(SCRIPTS);
  } catch (err) {
    nubeFallo(err.message);
  }
})();
