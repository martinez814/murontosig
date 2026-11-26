// ==========================================
// GESTIÓN Y VISUALIZACIÓN DE ESPACIOS ESTRUCTURALES (PB Y MEZZANINA)
// ==========================================
import {
  ESTADOS_ESPACIO,
  MURONTO_CENTER,
  STORAGE_KEYS,
  TIPOS_ESPACIO_ESTRUCTURAL,
  db,
  firebaseHabilitado,
  normalizarPiso
} from './config.js';
import { state } from './state.js';

const SOURCE_ESPACIOS = 'espacios-source';
const LAYER_ESPACIOS_FILL = 'capa-espacios-extrusion';
const LAYER_ESPACIOS_LINE = 'capa-espacios-borde';

const SOURCE_DIBUJO = 'espacio-dibujo-source';
const LAYER_DIBUJO_FILL = 'capa-espacio-dibujo-fill';
const LAYER_DIBUJO_LINE = 'capa-espacio-dibujo-line';
const LAYER_DIBUJO_PTS = 'capa-espacio-dibujo-vertices';

/** Cierra un anillo GeoJSON asegurando que el primer y último vértice coincidan. */
export function cerrarAnilloPoligono(coords) {
  if (!Array.isArray(coords) || coords.length < 3) return [];
  const ring = coords.map(c => [Number(c[0]), Number(c[1])]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/** Calcula el área superficial en m² proyectando localmente a metros vía MercatorCoordinate. */
export function calcularAreaPoligonoM2(ringCoords) {
  if (!Array.isArray(ringCoords) || ringCoords.length < 3) return 0;
  const ring = cerrarAnilloPoligono(ringCoords);
  const origin = mapboxgl.MercatorCoordinate.fromLngLat(MURONTO_CENTER, 0);
  const meterUnits = origin.meterInMercatorCoordinateUnits();

  const pts = ring.map(c => {
    const mc = mapboxgl.MercatorCoordinate.fromLngLat(c, 0);
    return {
      x: (mc.x - origin.x) / meterUnits,
      y: (mc.y - origin.y) / meterUnits
    };
  });

  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    sum += (pts[i].x * pts[i + 1].y) - (pts[i + 1].x * pts[i].y);
  }
  return Math.round(Math.abs(sum) * 0.5 * 100) / 100;
}

/** Calcula el centroide promedio de un polígono [lng, lat] para navegación de cámara y popups. */
export function calcularCentroidePoligono(ringCoords) {
  if (!Array.isArray(ringCoords) || ringCoords.length === 0) return MURONTO_CENTER;
  const base = ringCoords.length > 3 &&
    ringCoords[0][0] === ringCoords[ringCoords.length - 1][0] &&
    ringCoords[0][1] === ringCoords[ringCoords.length - 1][1]
    ? ringCoords.slice(0, -1)
    : ringCoords;

  const total = base.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
  return [total[0] / base.length, total[1] / base.length];
}

function alturasPorDefectoNivel(floor) {
  return normalizarPiso(floor) === 'Mezzanina'
    ? { minHeight: 3.4, height: 6.8 }
    : { minHeight: 0, height: 3.4 };
}

function normalizarEspacio(raw) {
  const floor = normalizarPiso(raw.floor);
  const tipo = TIPOS_ESPACIO_ESTRUCTURAL[raw.tipoEstructural] ? raw.tipoEstructural : 'oficina';
  const defAlt = alturasPorDefectoNivel(floor);
  const minHeight = typeof raw.minHeight === 'number' ? raw.minHeight : defAlt.minHeight;
  const height = typeof raw.height === 'number' ? raw.height : defAlt.height;
  const coordinates = Array.isArray(raw.coordinates) ? cerrarAnilloPoligono(raw.coordinates) : [];
  const areaM2 = typeof raw.areaM2 === 'number' && raw.areaM2 > 0
    ? raw.areaM2
    : calcularAreaPoligonoM2(coordinates);

  return {
    id: raw.id || `esp-${Date.now()}`,
    nombre: raw.nombre || 'Espacio Estructural',
    tipoEstructural: tipo,
    floor,
    pisoNum: floor === 'PB' ? 1 : 2,
    minHeight,
    height: Math.max(minHeight + 0.3, height),
    capacidad: typeof raw.capacidad === 'number' ? raw.capacidad : 0,
    estado: ESTADOS_ESPACIO[raw.estado] ? raw.estado : 'Operativo',
    areaM2,
    descripcion: raw.descripcion || '',
    foto360: raw.foto360 || '',
    color: raw.color || TIPOS_ESPACIO_ESTRUCTURAL[tipo].color,
    coordinates
  };
}

/** Construye la colección GeoJSON de espacios estructurales para Mapbox. */
export function construirGeoJSONEspacios() {
  return {
    type: 'FeatureCollection',
    features: state.coleccionEspacios
      .filter(e => Array.isArray(e.coordinates) && e.coordinates.length >= 4)
      .map(e => ({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [e.coordinates]
        },
        properties: {
          id: e.id,
          nombre: e.nombre,
          tipoEstructural: e.tipoEstructural,
          floor: e.floor,
          pisoNum: e.pisoNum,
          minHeight: e.minHeight,
          height: e.height,
          capacidad: e.capacidad,
          estado: e.estado,
          areaM2: e.areaM2,
          descripcion: e.descripcion,
          foto360: e.foto360,
          color: e.color
        }
      }))
  };
}

/** Configura fuentes y capas 3D/2D de espacios estructurales y trazado temporal en Mapbox. */
export function inicializarCapasEspacios() {
  const map = state.map;
  if (!map) return;

  if (!map.getSource(SOURCE_ESPACIOS)) {
    map.addSource(SOURCE_ESPACIOS, {
      type: 'geojson',
      data: construirGeoJSONEspacios()
    });
  }

  if (!map.getLayer(LAYER_ESPACIOS_FILL)) {
    map.addLayer({
      id: LAYER_ESPACIOS_FILL,
      type: 'fill-extrusion',
      source: SOURCE_ESPACIOS,
      paint: {
        'fill-extrusion-color': ['coalesce', ['get', 'color'], '#3b82f6'],
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 3.4],
        'fill-extrusion-base': ['coalesce', ['get', 'minHeight'], 0],
        'fill-extrusion-opacity': 0.42
      }
    });
  }

  if (!map.getLayer(LAYER_ESPACIOS_LINE)) {
    map.addLayer({
      id: LAYER_ESPACIOS_LINE,
      type: 'line',
      source: SOURCE_ESPACIOS,
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#1d4ed8'],
        'line-width': 2.2,
        'line-opacity': 0.9
      }
    });
  }

  if (!map.getSource(SOURCE_DIBUJO)) {
    map.addSource(SOURCE_DIBUJO, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }

  if (!map.getLayer(LAYER_DIBUJO_FILL)) {
    map.addLayer({
      id: LAYER_DIBUJO_FILL,
      type: 'fill',
      source: SOURCE_DIBUJO,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': '#8b5cf6',
        'fill-opacity': 0.25
      }
    });
  }

  if (!map.getLayer(LAYER_DIBUJO_LINE)) {
    map.addLayer({
      id: LAYER_DIBUJO_LINE,
      type: 'line',
      source: SOURCE_DIBUJO,
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
      paint: {
        'line-color': '#7c3aed',
        'line-width': 2.5,
        'line-dasharray': [2, 1.5]
      }
    });
  }

  if (!map.getLayer(LAYER_DIBUJO_PTS)) {
    map.addLayer({
      id: LAYER_DIBUJO_PTS,
      type: 'circle',
      source: SOURCE_DIBUJO,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#7c3aed',
        'circle-stroke-width': 2.5
      }
    });
  }

  aplicarVisibilidadYFiltroEspacios();
}

/** Aplica visibilidad del checkbox y filtro por nivel ('all', 'PB', 'Mezzanina') a los espacios. */
export function aplicarVisibilidadYFiltroEspacios() {
  const map = state.map;
  if (!map) return;

  const chk = document.getElementById('toggle-espacios');
  const visible = chk ? chk.checked : true;
  const visStr = visible ? 'visible' : 'none';

  [LAYER_ESPACIOS_FILL, LAYER_ESPACIOS_LINE].forEach(layerId => {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', visStr);

    if (state.currentFloor === 'all') {
      map.setFilter(layerId, null);
    } else {
      const fNorm = normalizarPiso(state.currentFloor);
      map.setFilter(layerId, ['==', ['get', 'floor'], fNorm]);
    }
  });
}

/** Devuelve entradas de búsqueda unificadas para el autocompletado. */
export function obtenerEntradasBusquedaEspacios() {
  return state.coleccionEspacios.map(e => {
    const meta = TIPOS_ESPACIO_ESTRUCTURAL[e.tipoEstructural] || TIPOS_ESPACIO_ESTRUCTURAL.oficina;
    return {
      id: e.id,
      kind: 'espacio',
      label: e.nombre,
      category: meta.label,
      coords: calcularCentroidePoligono(e.coordinates),
      floor: e.floor,
      altitude: e.minHeight,
      icon: meta.icon,
      info: `${meta.label} • ${e.areaM2} m² • ${e.estado}`
    };
  });
}

export function sincronizarEspaciosEnMapa(reconstruirBusqueda) {
  const map = state.map;
  if (map && map.getSource(SOURCE_ESPACIOS)) {
    map.getSource(SOURCE_ESPACIOS).setData(construirGeoJSONEspacios());
  }

  const contador = document.getElementById('contadorEspacios');
  if (contador) {
    const n = state.coleccionEspacios.length;
    contador.textContent = `${n} espacio${n === 1 ? '' : 's'}`;
  }

  try {
    localStorage.setItem(STORAGE_KEYS.ESPACIOS, JSON.stringify(state.coleccionEspacios));
  } catch (e) {}

  aplicarVisibilidadYFiltroEspacios();
  if (typeof reconstruirBusqueda === 'function') {
    reconstruirBusqueda();
  }
}

export async function cargarEspaciosIniciales(reconstruirBusqueda) {
  let cargados = false;
  try {
    const local = localStorage.getItem(STORAGE_KEYS.ESPACIOS);
    if (local) {
      const arr = JSON.parse(local);
      if (Array.isArray(arr) && arr.length > 0) {
        state.coleccionEspacios = arr.map(normalizarEspacio);
        cargados = true;
      }
    }
  } catch (e) {
    console.warn('Error leyendo espacios de localStorage:', e);
  }

  if (!cargados) {
    try {
      const res = await fetch('data/edificio.geojson?t=' + Date.now());
      if (res.ok) {
        const geo = await res.json();
        if (geo && Array.isArray(geo.features)) {
          state.coleccionEspacios = geo.features
            .filter(f => f.geometry && f.geometry.type === 'Polygon' && Array.isArray(f.geometry.coordinates[0]))
            .map(f => normalizarEspacio({
              ...f.properties,
              coordinates: f.geometry.coordinates[0]
            }));
        }
      }
    } catch (e) {
      console.warn('No se pudo cargar data/edificio.geojson:', e);
    }
  }

  sincronizarEspaciosEnMapa(reconstruirBusqueda);
}

export async function guardarEspaciosEnNube() {
  if (!db || !firebaseHabilitado) return;
  try {
    await db.collection('edificio').doc('espacios').set({
      lista: state.coleccionEspacios,
      actualizadoEn: new Date().toISOString()
    });
    console.log(`✓ Sincronización en la Nube: ${state.coleccionEspacios.length} espacios estructurales guardados.`);
  } catch (err) {
    if (err && err.code === 'permission-denied') {
      console.warn('Permiso denegado en Firestore al guardar espacios. Inicia sesión como Administrador.');
    } else {
      console.warn('Aviso al guardar espacios en Firestore:', err);
    }
  }
}

export function iniciarSincronizacionEspaciosNube(reconstruirBusqueda) {
  if (!db || !firebaseHabilitado) return;

  db.collection('edificio').doc('espacios').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      if (Array.isArray(data.lista)) {
        const modalAbierto = document.getElementById('espacioModal') && document.getElementById('espacioModal').style.display !== 'none';
        if (!state.modoDibujoEspacio && !modalAbierto) {
          state.coleccionEspacios = data.lista.map(normalizarEspacio);
          sincronizarEspaciosEnMapa(reconstruirBusqueda);
        }
      }
    } else if (state.coleccionEspacios.length > 0 && state.usuarioRolActual === 'admin') {
      guardarEspaciosEnNube();
    }
  }, (err) => {
    console.warn('Error en listener de espacios en Firestore:', err);
  });
}

// ==========================================
// MODO TRAZADO DE POLÍGONOS EN EL MAPA
// ==========================================
function actualizarPrevisualizacionDibujo() {
  const map = state.map;
  if (!map || !map.getSource(SOURCE_DIBUJO)) return;

  const pts = state.verticesDibujoEspacio;
  const features = pts.map(c => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: c }
  }));

  if (pts.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pts }
    });
  }

  if (pts.length >= 3) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [cerrarAnilloPoligono(pts)] }
    });
  }

  map.getSource(SOURCE_DIBUJO).setData({
    type: 'FeatureCollection',
    features
  });

  const bannerTexto = document.getElementById('editorBannerTexto');
  const btnFinalizar = document.getElementById('btnFinalizarPoligono');
  const btnDeshacer = document.getElementById('btnDeshacerVertice');
  if (bannerTexto && state.modoDibujoEspacio) {
    const areaActual = pts.length >= 3 ? calcularAreaPoligonoM2(pts) : 0;
    bannerTexto.textContent = pts.length < 3
      ? `🏗️ Haz clic para marcar vértices del espacio (${pts.length}/3 mínimo)`
      : `🏗️ ${pts.length} vértices • Área aprox: ${areaActual} m²`;
  }
  if (btnFinalizar) btnFinalizar.style.display = pts.length >= 3 ? 'inline-block' : 'none';
  if (btnDeshacer) btnDeshacer.style.display = pts.length >= 1 ? 'inline-block' : 'none';
}

export function toggleModoDibujoEspacio(cancelarOtrosModos) {
  if (state.usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede trazar espacios estructurales.');
    return;
  }

  if (!state.modoDibujoEspacio && typeof cancelarOtrosModos === 'function') {
    cancelarOtrosModos();
  }

  state.modoDibujoEspacio = !state.modoDibujoEspacio;
  state.verticesDibujoEspacio = [];

  const btn = document.getElementById('btnModoDibujoEspacio');
  const banner = document.getElementById('editorBanner');

  if (state.modoDibujoEspacio) {
    if (state.map) state.map.getCanvas().style.cursor = 'crosshair';
    if (btn) {
      btn.style.background = '#e11d48';
      btn.style.borderColor = '#be123c';
      btn.textContent = '✕ Cancelar Trazado';
    }
    if (banner) banner.style.display = 'flex';
    actualizarPrevisualizacionDibujo();
  } else {
    cancelarDibujoEspacio();
  }
}

export function agregarVerticeEspacio(lngLat) {
  if (!state.modoDibujoEspacio) return;
  const lng = parseFloat(lngLat.lng.toFixed(6));
  const lat = parseFloat(lngLat.lat.toFixed(6));
  state.verticesDibujoEspacio.push([lng, lat]);
  actualizarPrevisualizacionDibujo();
}

export function deshacerVerticeEspacio() {
  if (!state.modoDibujoEspacio || state.verticesDibujoEspacio.length === 0) return;
  state.verticesDibujoEspacio.pop();
  actualizarPrevisualizacionDibujo();
}

export function finalizarPoligonoEspacio() {
  if (!state.modoDibujoEspacio || state.verticesDibujoEspacio.length < 3) return;
  const coords = cerrarAnilloPoligono(state.verticesDibujoEspacio);
  cancelarDibujoEspacio();
  abrirModalCrearEspacio(coords);
}

export function cancelarDibujoEspacio() {
  state.modoDibujoEspacio = false;
  state.verticesDibujoEspacio = [];
  if (state.map) {
    state.map.getCanvas().style.cursor = '';
    if (state.map.getSource(SOURCE_DIBUJO)) {
      state.map.getSource(SOURCE_DIBUJO).setData({ type: 'FeatureCollection', features: [] });
    }
  }

  const btn = document.getElementById('btnModoDibujoEspacio');
  if (btn) {
    btn.style.background = '#7c3aed';
    btn.style.borderColor = '#6d28d9';
    btn.textContent = '🏗️ Trazar Espacio Estructural';
  }

  const btnFinalizar = document.getElementById('btnFinalizarPoligono');
  const btnDeshacer = document.getElementById('btnDeshacerVertice');
  if (btnFinalizar) btnFinalizar.style.display = 'none';
  if (btnDeshacer) btnDeshacer.style.display = 'none';

  const banner = document.getElementById('editorBanner');
  if (banner && !state.modoInsercionPunto && !state.puntoEnMovimientoId) {
    banner.style.display = 'none';
  }
}

// ==========================================
// MODAL Y POPUP DE ESPACIOS ESTRUCTURALES
// ==========================================
function setModalEspacioCampos(datos) {
  document.getElementById('espacioEditandoId').value = datos.id || '';
  document.getElementById('espacioNombre').value = datos.nombre || '';
  document.getElementById('espacioTipo').value = datos.tipoEstructural || 'oficina';
  document.getElementById('espacioPiso').value = datos.floor || 'PB';
  document.getElementById('espacioMinHeight').value = datos.minHeight;
  document.getElementById('espacioHeight').value = datos.height;
  document.getElementById('espacioCapacidad').value = datos.capacidad ?? 0;
  document.getElementById('espacioEstado').value = datos.estado || 'Operativo';
  document.getElementById('espacioDescripcion').value = datos.descripcion || '';
  const fotoEl = document.getElementById('espacioFoto360');
  if (fotoEl) fotoEl.value = datos.foto360 || '';

  document.getElementById('espacioCoordenadasJson').value = JSON.stringify(datos.coordinates || []);
  const area = calcularAreaPoligonoM2(datos.coordinates || []);
  document.getElementById('espacioAreaTexto').textContent = `${area.toLocaleString('es-VE')} m² (${Math.max(0, (datos.coordinates || []).length - 1)} vértices)`;
}

export function abrirModalCrearEspacio(ringCoords) {
  if (state.usuarioRolActual !== 'admin') return;
  const pisoDefecto = state.currentFloor === 'Mezzanina' ? 'Mezzanina' : 'PB';
  const defAlt = alturasPorDefectoNivel(pisoDefecto);

  document.getElementById('espacioModalTitulo').textContent = '🏗️ Nuevo Espacio Estructural';
  setModalEspacioCampos({
    id: '',
    nombre: '',
    tipoEstructural: 'oficina',
    floor: pisoDefecto,
    minHeight: defAlt.minHeight,
    height: defAlt.height,
    capacidad: 8,
    estado: 'Operativo',
    descripcion: '',
    foto360: '',
    coordinates: ringCoords
  });

  document.getElementById('espacioModal').style.display = 'flex';
  setTimeout(() => document.getElementById('espacioNombre').focus(), 100);
}

export function abrirEditorEspacio(id) {
  if (state.usuarioRolActual !== 'admin') return;
  if (state.popupActivo) state.popupActivo.remove();

  const espacio = state.coleccionEspacios.find(e => String(e.id) === String(id));
  if (!espacio) return;

  document.getElementById('espacioModalTitulo').textContent = '✏️ Editar Espacio Estructural';
  setModalEspacioCampos(espacio);
  document.getElementById('espacioModal').style.display = 'flex';
  setTimeout(() => document.getElementById('espacioNombre').focus(), 100);
}

export function cerrarModalEspacio() {
  document.getElementById('espacioModal').style.display = 'none';
}

export function onCambiarPisoEspacio(piso) {
  const defAlt = alturasPorDefectoNivel(piso);
  document.getElementById('espacioMinHeight').value = defAlt.minHeight;
  document.getElementById('espacioHeight').value = defAlt.height;
}

export function guardarEspacioModal(reconstruirBusqueda) {
  if (state.usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede guardar espacios.');
    return;
  }

  const nombre = document.getElementById('espacioNombre').value.trim();
  if (!nombre) {
    alert('Por favor indica un nombre para el espacio estructural.');
    document.getElementById('espacioNombre').focus();
    return;
  }

  let coordinates = [];
  try {
    coordinates = JSON.parse(document.getElementById('espacioCoordenadasJson').value || '[]');
  } catch (e) {}
  if (!Array.isArray(coordinates) || coordinates.length < 4) {
    alert('El polígono del espacio no tiene geometría válida.');
    return;
  }

  const editId = document.getElementById('espacioEditandoId').value;
  const floor = normalizarPiso(document.getElementById('espacioPiso').value);
  const tipoEstructural = document.getElementById('espacioTipo').value;
  const minHeight = parseFloat(document.getElementById('espacioMinHeight').value);
  const height = parseFloat(document.getElementById('espacioHeight').value);
  const capacidad = parseInt(document.getElementById('espacioCapacidad').value, 10);
  const estado = document.getElementById('espacioEstado').value;
  const descripcion = document.getElementById('espacioDescripcion').value.trim();
  const fotoEl = document.getElementById('espacioFoto360');
  const foto360 = fotoEl ? fotoEl.value.trim() : '';

  const payload = normalizarEspacio({
    id: editId || `esp-${Date.now()}`,
    nombre,
    tipoEstructural,
    floor,
    minHeight: isNaN(minHeight) ? alturasPorDefectoNivel(floor).minHeight : minHeight,
    height: isNaN(height) ? alturasPorDefectoNivel(floor).height : height,
    capacidad: isNaN(capacidad) ? 0 : Math.max(0, capacidad),
    estado,
    descripcion,
    foto360,
    coordinates
  });

  if (editId) {
    const idx = state.coleccionEspacios.findIndex(e => String(e.id) === String(editId));
    if (idx !== -1) state.coleccionEspacios[idx] = payload;
  } else {
    state.coleccionEspacios.push(payload);
  }

  sincronizarEspaciosEnMapa(reconstruirBusqueda);
  cerrarModalEspacio();
  guardarEspaciosEnNube();
}

export function eliminarEspacio(id, reconstruirBusqueda) {
  if (state.usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede eliminar espacios.');
    return;
  }
  if (state.popupActivo) state.popupActivo.remove();
  const espacio = state.coleccionEspacios.find(e => String(e.id) === String(id));
  if (!espacio) return;

  if (confirm(`¿Estás seguro de eliminar el espacio estructural "${espacio.nombre}"?`)) {
    state.coleccionEspacios = state.coleccionEspacios.filter(e => String(e.id) !== String(id));
    sincronizarEspaciosEnMapa(reconstruirBusqueda);
    guardarEspaciosEnNube();
  }
}

export function mostrarPopupEspacio(espacio, lngLat) {
  if (!state.popupActivo || !state.map) return;

  const meta = TIPOS_ESPACIO_ESTRUCTURAL[espacio.tipoEstructural] || TIPOS_ESPACIO_ESTRUCTURAL.oficina;
  const est = ESTADOS_ESPACIO[espacio.estado] || ESTADOS_ESPACIO.Operativo;
  const anchor = lngLat || calcularCentroidePoligono(espacio.coordinates);

  const boton360 = espacio.foto360 ? `
    <div style="margin-top: 8px;">
      <button class="btn-popup-action" style="width: 100%; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; border-color: #0284c7; font-weight: 700; padding: 6px 10px;" onclick="abrirVisor360('${espacio.foto360}', '${espacio.nombre}', '${espacio.floor}')">
        📷 Ver Foto 360°
      </button>
    </div>
  ` : '';

  state.popupActivo
    .setLngLat(anchor)
    .setHTML(`
      <div class="popup-title">${meta.icon} ${espacio.nombre}</div>
      <div class="popup-subtitle">${meta.label}</div>
      ${espacio.descripcion ? `<div class="popup-detail">${espacio.descripcion}</div>` : ''}
      <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px;">
        <span class="popup-badge badge-piso">${espacio.floor}</span>
        <span class="popup-badge" style="background: #f1f5f9; color: #334155;">📐 ${espacio.areaM2} m²</span>
        <span class="popup-badge" style="background: #f1f5f9; color: #334155;">👥 Aforo: ${espacio.capacidad}</span>
        <span class="popup-badge" style="background: ${est.bg}; color: ${est.color};">${est.label}</span>
      </div>
      ${boton360}
      ${state.usuarioRolActual === 'admin' ? `
        <div style="display: flex; gap: 5px; margin-top: 8px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          <button class="btn-popup-action" onclick="abrirEditorEspacio('${espacio.id}')">✏️ Editar</button>
          <button class="btn-popup-action btn-popup-danger" onclick="eliminarEspacio('${espacio.id}')">🗑️ Borrar</button>
        </div>
      ` : ''}
    `)
    .addTo(state.map);
}
