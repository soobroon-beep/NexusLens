# Nova Nexus · Lens 📊

Aplicación de análisis institucional de futuros para BingX. Instalable como app nativa en Android (PWA).

## Archivos del proyecto

```
NexusLens/
├── index.html       ← La app completa
├── manifest.json    ← Necesario para instalarla como app
├── sw.js            ← Service Worker (funciona offline)
└── icons/
    ├── icon-192.svg
    └── icon-512.svg
```

---

## Paso 1 — Subir a GitHub

### Si aún no tienes el repo:

1. Ve a [github.com/new](https://github.com/new)
2. Nombre del repositorio: **NexusLens**
3. Marca ✅ "Add a README file"
4. Clic en **Create repository**

### Subir los archivos:

**Opción A — Desde el navegador (sin instalar nada):**

1. En tu repo de GitHub, clic en **Add file → Upload files**
2. Arrastra **todos** los archivos:
   - `index.html`
   - `manifest.json`
   - `sw.js`
3. Crea la carpeta `icons/` subiendo primero `icons/icon-192.svg` y `icons/icon-512.svg`
   - Para crear subcarpetas desde la web: en "Upload files", antes de soltar los archivos, escribe `icons/` al inicio del nombre del archivo en el campo de texto
4. En el campo de commit escribe: `Primera versión NN·Lens`
5. Clic en **Commit changes**

**Opción B — Con Git (si lo tienes instalado):**

```bash
git clone https://github.com/TU_USUARIO/NexusLens.git
# copia todos los archivos dentro de la carpeta NexusLens/
git add .
git commit -m "Primera versión NN·Lens"
git push origin main
```

---

## Paso 2 — Activar GitHub Pages

1. En tu repo, clic en **Settings** (pestaña arriba)
2. En el menú izquierdo: **Pages**
3. En "Source" selecciona **main** branch, carpeta **/ (root)**
4. Clic en **Save**
5. Espera ~2 minutos. Tu URL será:

```
https://TU_USUARIO.github.io/NexusLens/
```

---

## Paso 3 — Instalar en Android como app

1. Abre **Chrome** en tu celular Android
2. Ve a tu URL: `https://TU_USUARIO.github.io/NexusLens/`
3. Espera a que cargue completamente
4. Chrome mostrará un banner **"Agregar a pantalla de inicio"** → tócalo
   - Si no aparece: toca el menú ⋮ (tres puntos) → **"Agregar a pantalla de inicio"** o **"Instalar app"**
5. Confirma → ¡Listo! Aparece el ícono NN·Lens en tu pantalla de inicio
6. Ábrela como cualquier app nativa — sin barra de navegador, pantalla completa

> **Importante:** La URL de GitHub Pages **debe ser HTTPS** para que el Service Worker funcione. GitHub Pages siempre usa HTTPS, así que no hay problema.

---

## Nota sobre la conexión a BingX

La app llama directamente a la API de BingX con tu API Key. En producción desde GitHub Pages, las llamadas van con HMAC-SHA256 desde el navegador — sin servidor intermedio. Asegúrate de que tu API Key de BingX tenga **solo permisos de lectura** (sin trading ni retiros).

---

## Actualizaciones

Para actualizar la app a una nueva versión:
1. Sube el nuevo `index.html` (y otros archivos si cambiaron)
2. GitHub Pages lo publica en ~1 minuto
3. En tu celular: abre la app → el Service Worker descarga la nueva versión automáticamente (o cierra y vuelve a abrir)
