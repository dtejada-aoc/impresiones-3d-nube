# Impresiones 3D — versión en la nube

Registro de impresiones 3D, filamentos, gastos, ventas, informes y fichas de pedido, accesible desde cualquier navegador
(ordenador, móvil o tableta) con los **mismos datos en todos los dispositivos**.

- **Aplicación:** página estática publicada en GitHub Pages (carpeta `app/`), sin servidor propio.
- **Datos:** [Supabase](https://supabase.com) (plan gratuito): base de datos PostgreSQL para los datos y almacenamiento
  privado para las fotos.
- **Acceso:** con usuario y contraseña. Cada usuario solo puede ver y cambiar sus propios datos (reglas de seguridad de la
  base de datos).

## Cómo están guardados los datos

Igual que la carpeta `data/` de la versión de escritorio, pero en tablas (ver [`supabase/esquema.sql`](supabase/esquema.sql)):

| Tabla | Contenido |
|---|---|
| `impresiones` | Una fila por impresión; `datos` es el JSON de la impresión (el antiguo `datos.json`) y `fotos` la lista de fotos |
| `listas` | Catálogos (máquinas, accesorios…) y registros (filamentos, gastos, ventas): una fila por lista |
| `ajustes` | Configuración general |
| `papelera` | Impresiones borradas y versiones anteriores de las listas |

Las fotos están en el almacenamiento `fotos`, en `<usuario>/impresiones/<id>/fotos/` y `<usuario>/papelera/`. Se reducen
a 2000 px al subirlas para no llenar el espacio gratuito.

Como los datos son JSON, no hace falta cambiar la base de datos al añadir campos en `config/campos.json`.

## Copias de seguridad

En *Configuración → Sesión y copias de seguridad*:

- **Descargar copia (.zip)** o **Compartir copia**: todos los datos y las fotos.
- **Restaurar una copia**: sustituye todos los datos de la nube por los de un .zip.

El .zip tiene el mismo formato que las copias de las versiones de escritorio y móvil, así que sirve para pasar los datos
desde ellas y para no depender de Supabase.

## Puesta en marcha (una sola vez)

1. **Base de datos:** en Supabase, *SQL Editor → New query*, pega el contenido de `supabase/esquema.sql` y pulsa *Run*.
2. **Usuario:** *Authentication → Users → Add user → Create new user*, con tu correo y una contraseña, marcando
   *Auto Confirm User*.
3. **Cerrar el registro:** *Authentication → Sign In / Providers* → desactiva *Allow new users to sign up*.
4. **Conexión:** en `app/config.js`, la URL del proyecto y la clave **pública** (*publishable* o *anon*). Nunca la
   clave secreta (*secret* o *service_role*).
5. **Publicación:** cada cambio subido a `main` se publica solo en GitHub Pages (`.github/workflows/pages.yml`).

## Probar en el ordenador sin Supabase

```
probar.bat
```

Abre `http://localhost:8781/prueba.html`, que usa un almacén en memoria en lugar de Supabase (`app/prueba-local.js`).
Usuario de prueba: `prueba@local.test`, contraseña `prueba`. Esta página no se publica.

## Plan gratuito de Supabase

- 500 MB de base de datos y alrededor de 1 GB para ficheros (de sobra para este uso).
- **El proyecto se pausa tras 7 días sin uso.** Los datos se conservan; se reactiva desde el panel de Supabase.

## Ficheros propios de esta versión

| Fichero | Para qué |
|---|---|
| `app/index.html` | Página de inicio |
| `app/config.js` | Dirección y clave pública de Supabase |
| `app/nube.js` | Inicio de sesión y arranque de la aplicación |
| `app/nube-api.js` | Las mismas rutas `/api/...` que tenía `app.py`, sobre Supabase; copias .zip |
| `app/nube-datos.js` | Todo el acceso a Supabase (tablas y fotos) |
| `app/nube-copias.js` | Sección de sesión y copias de Configuración |
| `app/zip.js` | Leer y escribir .zip |
| `app/movil.css` | Diseño para móvil y tableta, y pantalla de inicio de sesión |
| `supabase/esquema.sql` | Tablas, reglas de seguridad y almacenamiento de fotos |

El resto de `app/` (pantallas, cálculos, informes, ficha…) viene de la versión de escritorio.

## Pensado para el futuro

La tabla `impresiones` tiene una columna `publico` (sin uso todavía) para poder añadir más adelante una galería pública de
modelos y pedidos de clientes, sin cambiar cómo se guardan los datos privados.
