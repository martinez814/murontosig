# STATUS.md — Sistema WebGIS 3D (CIDE-MÜRÖNTÖ)

> **Última actualización:** 2026-11-26  
> **Modo de operación:** `Modo Planificador` (Roadmap Base Completado; listo para `git push` y pruebas en producción)  
> **Metodología:** C://GHOST (regido por `.agents/AGENTS.md`)

---

## 1. Propósito del Proyecto

Desarrollar un **Sistema de Información Geográfica (WebGIS 3D)** para la **gestión y visualización de los espacios estructurales del edificio** (Sede Torre Humboldt, Prados del Este — CIDE-MÜRÖNTÖ), integrando gemelo digital arquitectónico (fachada e interior por niveles `PB` y `Mezzanina`), georreferenciación de espacios estructurales, puestos/zonas/equipamiento, recorridos panorámicos 360° y administración espacial en tiempo real.

### Decisiones Arquitectónicas Aprobadas (2026-11-26)
- **Infraestructura:** Despliegue estático en **Vercel** (`outputDirectory: "public"`) + **Firebase** (**Firebase Authentication** + **Cloud Firestore** como fuente de verdad).
- **Alcance espacial:** **Solo el edificio** (niveles `PB` y `Mezzanina`, fachada exterior e interior 3D; sin entorno urbano externo).

---

## 2. Estado Actual del Repositorio (Línea Base)

- **Stack técnico observado:**
  - **Frontend:** HTML5, CSS3 (`public/css/main.css`), JavaScript ES Modules (`public/js/main.js`, `config.js`, `state.js`, `scene3d.js`, `calibracion.js`, `puntos3d.js`, `auth.js`, `ui.js`, `visor360.js`), Mapbox GL JS `v2.15.0`, Three.js `r128` + `GLTFLoader`.
  - **Servidor local auxiliar:** Node.js + Express (`^4.19.2`) en `server.js` (sirve `public/` para desarrollo local; sus endpoints `/api/calibracion` y `/api/puntos` ya no son invocados por `map.js`).
  - **Despliegue / Nube:** `vercel.json` (`outputDirectory: "public"`) y sincronización cliente con Firebase Cloud Firestore (`muronto-webgis`: documentos `edificio/calibracion` y `edificio/puntos`).
  - **Activos espaciales y 3D:** `public/models/edificioM-v1.glb`, `public/models/medidasmetros-v2.glb`, `public/data/edificio.geojson`, `public/data/calibracion.json` (duplicado en raíz `./calibracion.json`), `public/office_data.js` (actualmente con `features: []`), `public/panoramas/`.
- **Funcionalidades base ya presentes (verificadas en código y `git log`):**
  - Visor 3D Mapbox + Three.js con modelos independientes de fachada e interior y modo Rayos X.
  - Panel de calibración 3D independiente (`exterior` / `interior`) con persistencia en `localStorage`, Firestore y fallback `data/calibracion.json`.
  - Sistema de roles (`Visitante` / `Administrador`), filtros por nivel (`Todos`, `PB`, `Mezzanina`), buscador con autocompletado y gestor de puntos espaciales.
  - Visor inmersivo 360° integrado con Three.js y vinculación de fotos panorámicas para administrador.
  - Barra inspectora de coordenadas en esquina inferior derecha.
- **Hallazgos críticos resueltos y pendientes:**
  1. **Seguridad (`Resuelto en código`):** Eliminada `ADMIN_PASSWORD_CORRECTA` del cliente e integrado **Firebase Authentication** (`firebase-auth-compat.js` + `firestore.rules`). *Pendiente operativo en Firebase Console:* habilitar proveedor Correo/Contraseña, crear usuario admin y publicar `firestore.rules`.
  2. **Limpieza y coherencia (`Parcialmente resuelto`):** Eliminado duplicado `./calibracion.json` en raíz y simplificado `server.js` a servidor estático local; sigue pendiente alinear `public/data/edificio.geojson` (3 niveles genéricos) con `PB` y `Mezzanina`.
  3. **Mantenibilidad (`Resuelto en Fase 2`):** `public/js/map.js` fue desacoplado en 9 módulos ES bajo `public/js/`.
  4. **Calidad y pruebas (`Resuelto en Fase 4`):** Añadido `scripts/verify.mjs` (`npm run verify` / `npm test`), normalizados nombres de panoramas sin espacios, añadido `.env.example` y cabeceras `Cache-Control` en `vercel.json`.

---

## 3. Tarea Activa

- **[OPS-01] Despliegue final y pruebas en vivo:**
  - Todas las fases técnicas base (Fases 1, 2 y 4) están completadas y verificadas con `npm run verify`.
  - Pendiente únicamente ejecutar `git push origin main` para actualizar Vercel y verificar el flujo completo en navegador tras configurar Firebase Console.

---

## 4. Backlog Priorizado

- [x] **[SEG-01] Fase 1 — Firebase Auth + Reglas Firestore:** Incorporado `firebase-auth-compat.js` en `public/index.html`, reemplazado login estático por `auth.signInWithEmailAndPassword` + `onAuthStateChanged` y creado `firestore.rules`.
- [x] **[CLN-01] Fase 1 — Saneamiento de configuración y respaldos:** Eliminado `./calibracion.json` duplicado en raíz, simplificado `server.js` a servidor estático de desarrollo local y respaldada gobernanza en Git.
- [x] **[ARQ-02] Fase 2 — Modularización de `public/js/map.js`:** Separado el monolito en 9 módulos ES (`config.js`, `state.js`, `scene3d.js`, `calibracion.js`, `puntos3d.js`, `auth.js`, `ui.js`, `visor360.js`, `main.js`) cargados vía `<script type="module">` desde `public/index.html`.
- [~] **[GIS-01] Fase 3 — Trazado de espacios estructurales (polígonos):** Descartado por decisión del usuario (se mantiene la gestión mediante puntos espaciales 3D y modelos `.glb`).
- [x] **[QA-01] Fase 4 — Verificación y optimización de activos:** Añadidos `scripts/verify.mjs` y scripts `verify`/`test` en `package.json`, renombrado `25-11-2026_05-33-48.jpg` sin espacios (con compatibilidad legacy en `visor360.js`), cabeceras de caché en `vercel.json` y `.env.example`.

---

## 5. Historial de Cambios

- **2026-11-26 (Fase 4):** Creado `scripts/verify.mjs` (`npm run verify` / `npm test`) para validar sintaxis ESM, grafo de imports/exports, manejadores HTML, JSON/GeoJSON, activos y seguridad; normalizado `public/panoramas/25-11-2026_05-33-48.jpg` con fallback compatible en `visor360.js`; configuradas cabeceras `Cache-Control` en `vercel.json` y creado `.env.example`.

- **2026-11-26 (Reversión Fase 3):** Eliminado el módulo de trazado de espacios estructurales (`public/js/espacios.js`, botón `#btnModoDibujoEspacio`, modal `#espacioModal` y capa `#toggle-espacios`), restaurando la arquitectura modular de 9 archivos de la Fase 2.

- **2026-11-26 (Fase 2):** Modularización completa del frontend en `public/js/` (`config.js`, `state.js`, `scene3d.js`, `calibracion.js`, `puntos3d.js`, `auth.js`, `ui.js`, `visor360.js`, `main.js`), actualización de `public/index.html` a `<script type="module" src="js/main.js?v=41">` y eliminación de `public/js/map.js`.
- **2026-11-26 (Fase 1):** Integración de Firebase Auth (correo/contraseña para administrador, `onAuthStateChanged`, `signOut`, manejo de errores en español) en `public/index.html` y `public/js/map.js`; creación de `firestore.rules`; eliminación de `ADMIN_PASSWORD_CORRECTA` y `./calibracion.json` duplicado; simplificación de `server.js` a servidor estático de desarrollo local.
- **2026-11-26 (Inicio):** Creación de `STATUS.md` base conforme al `Protocolo 0` y `Protocolo 10` (Semilla del Edén) de `.agents/AGENTS.md`, tras auditar la estructura actual del proyecto WebGIS 3D.
- **Previo en Git (`60db99b`):** Limpieza de código JavaScript y CSS sin uso en `map.js` y `main.css`.
- **Previo en Git (`6c3a9b2` / `40026fb`):** Integración de visor inmersivo 360° con Three.js, corrección de color sRGB y vinculación de panoramas por administrador.
- **Previo en Git (`3da243d` / `e800da6`):** Posicionamiento de barra de coordenadas en esquina inferior derecha.

---

## 6. Notas de Gobernanza y Seguridad

- **Zero-Trust (`Protocolo 2`):** No exponer `.env`, llaves privadas ni credenciales en archivos públicos o delegaciones externas.
- **Respaldo (`Protocolo 7`):** Cambios respaldados en commits locales de `main` (pendiente `git push origin main` para desplegar en Vercel).
