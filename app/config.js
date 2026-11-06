/* Conexión con Supabase (Project Settings → API Keys / Data API).
   La clave es la PÚBLICA («publishable» o «anon»): está pensada para ir en la página;
   los datos los protegen el inicio de sesión y las reglas de seguridad de la base de datos.
   NUNCA pongas aquí la clave secreta («secret» o «service_role»). */
window.NUBE_CONFIG = {
  url: "PEGA_AQUI_LA_URL_DEL_PROYECTO",
  clave: "PEGA_AQUI_LA_CLAVE_PUBLICA",
};
