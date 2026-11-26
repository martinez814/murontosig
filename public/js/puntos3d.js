// ==========================================
// GESTOR DE PUNTOS ESPACIALES, CRUD, NUBE Y MARCADORES 3D
// ==========================================
import { MURONTO_CENTER, STORAGE_KEYS, db, elevacionPorDefecto, firebaseHabilitado, normalizarPiso } from './config.js';
import { state } from './state.js';
import { filtrarPorNivel } from './ui.js';

/** Construye un objeto GeoJSON Feature a partir de un punto de colección. */
export function construirFeatureDesdePunto(punto) {
  return {
    properties: {
      id: punto.id,
      nombre: punto.nombre,
      categoria: punto.categoria,
      floor: punto.floor,
      altitude: punto.altitude,
      icono: punto.icono,
      detalle: punto.detalle,
      foto360: punto.foto360 || ''
    },
    geometry: { coordinates: punto.coords }
  };
}

function importarDesdeColeccionLocal(sourceObj, categoria, iconoPorDefecto, extractorDetalle) {
  if (!sourceObj || !Array.isArray(sourceObj.features)) return;
  sourceObj.features.forEach(f => {
    const fNorm = normalizarPiso(f.properties.floor);
    state.coleccionPuntos.push({
      id: f.properties.id || Date.now() + Math.random(),
      nombre: f.properties.nombre || f.properties.label || categoria,
      categoria,
      floor: fNorm,
      altitude: typeof f.properties.altitude === 'number' ? f.properties.altitude : elevacionPorDefecto(fNorm),
      icono: f.properties.icono || iconoPorDefecto,
      detalle: extractorDetalle(f.properties),
      coords: f.geometry.coordinates.slice()
    });
  });
}

export function cargarPuntosIniciales() {
  let cargados = false;
  try {
    const local = localStorage.getItem(STORAGE_KEYS.PUNTOS);
    if (local) {
      const arr = JSON.parse(local);
      if (Array.isArray(arr)) {
        state.coleccionPuntos = arr.map(p => {
          if (typeof p.altitude !== 'number') {
            p.altitude = elevacionPorDefecto(p.floor);
          }
          return p;
        });
        cargados = true;
        console.log(`✓ Cargados ${state.coleccionPuntos.length} puntos desde localStorage con elevación Z`);
      }
    }
  } catch (e) {
    console.warn('Error leyendo puntos de localStorage:', e);
  }

  if (!cargados) {
    state.coleccionPuntos = [];
    if (typeof puestosData !== 'undefined') {
      importarDesdeColeccionLocal(puestosData, 'puesto', '💻', p => p.cargo || p.detalle || '');
    }
    if (typeof zonasData !== 'undefined') {
      importarDesdeColeccionLocal(zonasData, 'zona', '🚪', p => p.recursos || p.capacidad || p.detalle || '');
    }
    if (typeof equipamientoData !== 'undefined') {
      importarDesdeColeccionLocal(equipamientoData, 'equipo', '⚙️', p => p.tipo || p.detalle || '');
    }
  }

  sincronizarCapasDesdeColeccion();
}

export function sincronizarCapasDesdeColeccion() {
  const featuresPuestos = [];
  const featuresZonas = [];
  const featuresEquipos = [];
  const listaBusqueda = [];

  state.coleccionPuntos.forEach(p => {
    const floorNorm = normalizarPiso(p.floor);
    const floorNum = floorNorm === 'PB' ? 1 : 2;
    const altZ = typeof p.altitude === 'number' ? p.altitude : elevacionPorDefecto(floorNorm);

    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.coords[0], p.coords[1]]
      },
      properties: {
        id: p.id,
        nombre: p.nombre,
        categoria: p.categoria,
        floor: floorNorm,
        pisoNum: floorNum,
        altitude: altZ,
        icono: p.icono,
        detalle: p.detalle || '',
        foto360: p.foto360 || ''
      }
    };

    if (p.categoria === 'puesto') featuresPuestos.push(feature);
    else if (p.categoria === 'zona') featuresZonas.push(feature);
    else featuresEquipos.push(feature);

    let catTexto = 'Puestos de Trabajo';
    if (p.categoria === 'zona') catTexto = 'Salas y Zonas';
    if (p.categoria === 'equipo') catTexto = 'Equipos y Servicios';

    listaBusqueda.push({
      id: p.id,
      label: p.nombre,
      category: catTexto,
      coords: [p.coords[0], p.coords[1]],
      floor: floorNorm,
      altitude: altZ,
      icon: p.icono || '📍',
      info: p.detalle || `${catTexto} - ${floorNorm}`
    });
  });

  if (typeof puestosData !== 'undefined') puestosData.features = featuresPuestos;
  if (typeof zonasData !== 'undefined') zonasData.features = featuresZonas;
  if (typeof equipamientoData !== 'undefined') equipamientoData.features = featuresEquipos;

  if (typeof searchData !== 'undefined') {
    searchData.length = 0;
    listaBusqueda.forEach(item => searchData.push(item));
  }

  if (state.map && state.map.getSource('puestos-source') && typeof puestosData !== 'undefined') {
    state.map.getSource('puestos-source').setData(puestosData);
  }
  if (state.map && state.map.getSource('zonas-source') && typeof zonasData !== 'undefined') {
    state.map.getSource('zonas-source').setData(zonasData);
  }
  if (state.map && state.map.getSource('equipos-source') && typeof equipamientoData !== 'undefined') {
    state.map.getSource('equipos-source').setData(equipamientoData);
  }

  const contador = document.getElementById('contadorPuntos');
  if (contador) {
    contador.textContent = `${state.coleccionPuntos.length} punto${state.coleccionPuntos.length === 1 ? '' : 's'}`;
  }

  try {
    localStorage.setItem(STORAGE_KEYS.PUNTOS, JSON.stringify(state.coleccionPuntos));
  } catch (e) {}

  if (state.currentFloor !== 'all') {
    filtrarPorNivel(state.currentFloor);
  }

  actualizarPuntos3D();
}

export function calcularAnchorLngLat3D(coords, altitude, floor) {
  if (!state.custom3DLayer || !state.custom3DLayer.camera || !state.map) return coords;

  const originCoord = mapboxgl.MercatorCoordinate.fromLngLat(MURONTO_CENTER, 0);
  const meterUnits = originCoord.meterInMercatorCoordinateUnits();
  const ptCoord = mapboxgl.MercatorCoordinate.fromLngLat(coords, 0);
  const dx = (ptCoord.x - originCoord.x) / meterUnits;
  const dz = (ptCoord.y - originCoord.y) / meterUnits;
  const altZ = typeof altitude === 'number' ? altitude : elevacionPorDefecto(floor);

  const pos3D = new THREE.Vector3(dx, altZ, dz);
  pos3D.applyMatrix4(state.custom3DLayer.camera.projectionMatrix);

  if (pos3D.z >= -1 && pos3D.z <= 1) {
    const canvas = state.map.getCanvas();
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    const screenX = (pos3D.x + 1) * 0.5 * width;
    const screenY = (1 - pos3D.y) * 0.5 * height;
    return state.map.unproject([screenX, screenY]);
  }
  return coords;
}

export function mostrarPopupPunto(feature) {
  if (!state.popupActivo || !state.map) return;

  const prop = feature.properties;
  const coords = feature.geometry.coordinates.slice();
  const altNum = typeof prop.altitude === 'number' ? prop.altitude : elevacionPorDefecto(prop.floor);
  const altZ = altNum.toFixed(1);

  state.puntoSeleccionadoActivo = {
    id: prop.id,
    coords,
    altitude: altNum,
    floor: prop.floor
  };

  const anchor = calcularAnchorLngLat3D(coords, altNum, prop.floor);

  let catTexto = 'Puesto de Trabajo';
  let badgeClass = 'badge-piso';
  if (prop.categoria === 'zona') {
    catTexto = 'Sala o Zona Común';
    badgeClass = 'badge-estado';
  } else if (prop.categoria === 'equipo') {
    catTexto = 'Equipamiento o Servicio';
  }

  const subtituloHtml = state.usuarioRolActual === 'admin'
    ? `${catTexto} • Altura Z: <b style="color: #2563eb;">+${altZ} m</b>`
    : `${catTexto}`;

  const foto360 = prop.foto360 || '';
  const botonFoto360Html = foto360 ? `
    <div style="margin-top: 8px;">
      <button class="btn-popup-action" style="width: 100%; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; border-color: #0284c7; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 10px; box-shadow: 0 2px 6px rgba(2, 132, 199, 0.35);" onclick="abrirVisor360('${foto360}', '${prop.nombre}', '${prop.floor}')">
        📷 Ver Foto 360°
      </button>
    </div>
  ` : '';

  state.popupActivo
    .setLngLat(anchor)
    .setHTML(`
      <div class="popup-title">${prop.icono || '📍'} ${prop.nombre}</div>
      <div class="popup-subtitle">${subtituloHtml}</div>
      ${prop.detalle ? `<div class="popup-detail">${prop.detalle}</div>` : ''}
      <div class="popup-badge ${badgeClass}">${prop.floor}</div>
      ${botonFoto360Html}
      ${state.usuarioRolActual === 'admin' ? `
        <div style="display: flex; gap: 5px; margin-top: 8px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          <button class="btn-popup-action" onclick="abrirEditorPunto(${prop.id})">✏️ Editar</button>
          <button class="btn-popup-action" onclick="iniciarMoverPunto(${prop.id})">📍 Mover</button>
          <button class="btn-popup-action btn-popup-danger" onclick="eliminarPunto(${prop.id})">🗑️ Borrar</button>
        </div>
      ` : `
        <div style="margin-top: 6px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 11px; color: #64748b; display: flex; align-items: center; justify-content: space-between;">
          <span>👁️ Modo visualización</span>
          <span style="font-size: 9px; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Solo Lectura</span>
        </div>
      `}
    `)
    .addTo(state.map);
}

export function toggleModoInsercion() {
  if (state.usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede insertar nuevos puntos.');
    return;
  }

  if (state.puntoEnMovimientoId) {
    cancelarAccionEditor();
  }

  state.modoInsercionPunto = !state.modoInsercionPunto;
  const btn = document.getElementById('btnModoInsertar');
  const banner = document.getElementById('editorBanner');
  const bannerTexto = document.getElementById('editorBannerTexto');

  if (state.modoInsercionPunto) {
    if (state.map) state.map.getCanvas().style.cursor = 'crosshair';
    if (btn) {
      btn.style.background = '#e11d48';
      btn.style.borderColor = '#be123c';
      btn.textContent = '✕ Cancelar Inserción';
    }
    if (banner && bannerTexto) {
      bannerTexto.textContent = '🎯 Haz clic en el edificio para ubicar el nuevo punto';
      banner.style.display = 'flex';
    }
  } else {
    if (state.map) state.map.getCanvas().style.cursor = '';
    if (btn) {
      btn.style.background = '#10b981';
      btn.style.borderColor = '#059669';
      btn.textContent = '➕ Insertar Nuevo Punto';
    }
    if (banner) banner.style.display = 'none';
  }
}

export function cancelarAccionEditor() {
  state.modoInsercionPunto = false;
  state.puntoEnMovimientoId = null;
  if (state.map) state.map.getCanvas().style.cursor = '';

  const btn = document.getElementById('btnModoInsertar');
  if (btn) {
    btn.style.background = '#10b981';
    btn.style.borderColor = '#059669';
    btn.textContent = '➕ Insertar Nuevo Punto';
  }

  const banner = document.getElementById('editorBanner');
  if (banner) banner.style.display = 'none';
}

export function abrirModalCrearPunto(coords) {
  if (state.usuarioRolActual !== 'admin') return;

  document.getElementById('modalTitulo').textContent = '➕ Nuevo Punto Espacial';
  document.getElementById('puntoEditandoId').value = '';
  document.getElementById('puntoLng').value = coords[0];
  document.getElementById('puntoLat').value = coords[1];
  document.getElementById('puntoNombre').value = '';
  document.getElementById('puntoDetalle').value = '';
  const pisoDefecto = state.currentFloor === 'Mezzanina' ? 'Mezzanina' : 'PB';
  document.getElementById('puntoPiso').value = pisoDefecto;
  document.getElementById('puntoCategoria').value = 'puesto';
  document.getElementById('puntoIcono').value = '💻';
  document.getElementById('puntoCoordsTexto').textContent = `Long: ${coords[0]} | Lat: ${coords[1]}`;
  const foto360El = document.getElementById('puntoFoto360');
  if (foto360El) foto360El.value = '';

  fijarAlturaRapida(elevacionPorDefecto(pisoDefecto));

  document.getElementById('puntoModal').style.display = 'flex';
  setTimeout(() => document.getElementById('puntoNombre').focus(), 100);
}

export function abrirEditorPunto(id) {
  if (state.usuarioRolActual !== 'admin') return;

  if (state.popupActivo) state.popupActivo.remove();
  const punto = state.coleccionPuntos.find(p => String(p.id) === String(id));
  if (!punto) return;

  document.getElementById('modalTitulo').textContent = '✏️ Editar Punto Espacial';
  document.getElementById('puntoEditandoId').value = punto.id;
  document.getElementById('puntoLng').value = punto.coords[0];
  document.getElementById('puntoLat').value = punto.coords[1];
  document.getElementById('puntoNombre').value = punto.nombre;
  document.getElementById('puntoDetalle').value = punto.detalle || '';
  document.getElementById('puntoPiso').value = punto.floor;
  document.getElementById('puntoCategoria').value = punto.categoria;
  document.getElementById('puntoIcono').value = punto.icono || '📍';
  document.getElementById('puntoCoordsTexto').textContent = `Long: ${punto.coords[0]} | Lat: ${punto.coords[1]}`;
  const foto360El = document.getElementById('puntoFoto360');
  if (foto360El) foto360El.value = punto.foto360 || '';

  const alt = typeof punto.altitude === 'number' ? punto.altitude : elevacionPorDefecto(punto.floor);
  fijarAlturaRapida(alt);

  document.getElementById('puntoModal').style.display = 'flex';
  setTimeout(() => document.getElementById('puntoNombre').focus(), 100);
}

export function cerrarModalPunto() {
  document.getElementById('puntoModal').style.display = 'none';
}

export function seleccionarEmoji(emoji) {
  document.getElementById('puntoIcono').value = emoji;
}

export function seleccionarCategoriaPorDefecto(cat) {
  const iconInput = document.getElementById('puntoIcono');
  if (cat === 'puesto') iconInput.value = '💻';
  else if (cat === 'zona') iconInput.value = '🚪';
  else if (cat === 'equipo') iconInput.value = '⚙️';
}

export function onCambiarPisoModal(piso) {
  const elevInput = document.getElementById('puntoElevacion');
  if (!elevInput) return;
  const valActual = parseFloat(elevInput.value) || 0;
  if (piso === 'Mezzanina' && valActual < 2.0) {
    fijarAlturaRapida(3.6);
  } else if (piso === 'PB' && valActual >= 3.0) {
    fijarAlturaRapida(0.8);
  }
}

export function actualizarElevacionInput(val) {
  const num = parseFloat(val);
  const span = document.getElementById('valPuntoElevacion');
  const inp = document.getElementById('puntoElevacion');
  if (span) span.textContent = `${num >= 0 ? '+' : ''}${num.toFixed(1)} m`;
  if (inp) inp.value = num.toFixed(1);
  previsualizarElevacionPunto(num);
}

export function actualizarElevacionSlider(val) {
  let num = parseFloat(val);
  if (isNaN(num)) num = 0;
  const span = document.getElementById('valPuntoElevacion');
  const slider = document.getElementById('sliderPuntoElevacion');
  if (span) span.textContent = `${num >= 0 ? '+' : ''}${num.toFixed(1)} m`;
  if (slider) slider.value = Math.min(12, Math.max(-1, num));
  previsualizarElevacionPunto(num);
}

export function fijarAlturaRapida(alt) {
  const num = parseFloat(alt);
  const span = document.getElementById('valPuntoElevacion');
  const slider = document.getElementById('sliderPuntoElevacion');
  const inp = document.getElementById('puntoElevacion');
  if (span) span.textContent = `${num >= 0 ? '+' : ''}${num.toFixed(1)} m`;
  if (slider) slider.value = Math.min(12, Math.max(-1, num));
  if (inp) inp.value = num.toFixed(1);
  previsualizarElevacionPunto(num);
}

export function previsualizarElevacionPunto(alt) {
  const editId = document.getElementById('puntoEditandoId').value;
  if (!editId) return;
  const p = state.coleccionPuntos.find(pt => String(pt.id) === String(editId));
  if (!p) return;

  p.altitude = alt;
  actualizarPuntos3D();
  if (state.puntoSeleccionadoActivo && String(state.puntoSeleccionadoActivo.id) === String(editId)) {
    state.puntoSeleccionadoActivo.altitude = alt;
    if (state.popupActivo && state.popupActivo.isOpen()) {
      state.popupActivo.setLngLat(calcularAnchorLngLat3D(p.coords, alt, p.floor));
    }
  }
}

export function guardarPuntoModal() {
  if (state.usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede guardar modificaciones.');
    return;
  }

  const nombre = document.getElementById('puntoNombre').value.trim();
  if (!nombre) {
    alert('Por favor indica un nombre o identificación para el punto.');
    document.getElementById('puntoNombre').focus();
    return;
  }

  const editId = document.getElementById('puntoEditandoId').value;
  const lng = parseFloat(document.getElementById('puntoLng').value);
  const lat = parseFloat(document.getElementById('puntoLat').value);
  const floor = document.getElementById('puntoPiso').value;
  const categoria = document.getElementById('puntoCategoria').value;
  const icono = document.getElementById('puntoIcono').value || '📍';
  const detalle = document.getElementById('puntoDetalle').value.trim();
  const foto360Input = document.getElementById('puntoFoto360');
  const foto360 = foto360Input ? foto360Input.value.trim() : '';

  const elevacion = parseFloat(document.getElementById('puntoElevacion').value);
  const altitude = isNaN(elevacion) ? elevacionPorDefecto(floor) : Math.round(elevacion * 10) / 10;

  if (editId) {
    const punto = state.coleccionPuntos.find(p => String(p.id) === String(editId));
    if (punto) {
      punto.nombre = nombre;
      punto.floor = floor;
      punto.categoria = categoria;
      punto.altitude = altitude;
      punto.icono = icono;
      punto.detalle = detalle;
      punto.foto360 = foto360;
    }
  } else {
    state.coleccionPuntos.push({
      id: Date.now(),
      nombre,
      categoria,
      floor,
      altitude,
      icono,
      detalle,
      foto360,
      coords: [lng, lat]
    });
  }

  sincronizarCapasDesdeColeccion();
  cerrarModalPunto();
  guardarPuntosEnNube();
}

export function iniciarMoverPunto(id) {
  if (state.usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede reubicar puntos.');
    return;
  }
  if (state.popupActivo) state.popupActivo.remove();
  const punto = state.coleccionPuntos.find(p => String(p.id) === String(id));
  if (!punto) return;

  state.puntoEnMovimientoId = id;
  state.modoInsercionPunto = false;

  if (state.map) state.map.getCanvas().style.cursor = 'crosshair';
  const banner = document.getElementById('editorBanner');
  const bannerTexto = document.getElementById('editorBannerTexto');
  if (banner && bannerTexto) {
    bannerTexto.textContent = `📍 Haz clic en la nueva ubicación para "${punto.nombre}"`;
    banner.style.display = 'flex';
  }
}

export function eliminarPunto(id) {
  if (state.usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede eliminar puntos.');
    return;
  }
  if (state.popupActivo) state.popupActivo.remove();
  const punto = state.coleccionPuntos.find(p => String(p.id) === String(id));
  if (!punto) return;

  if (confirm(`¿Estás seguro de eliminar el punto "${punto.nombre}"?`)) {
    state.coleccionPuntos = state.coleccionPuntos.filter(p => String(p.id) !== String(id));
    sincronizarCapasDesdeColeccion();
    guardarPuntosEnNube();
  }
}

export async function guardarPuntosEnNube() {
  if (!db || !firebaseHabilitado) return;
  try {
    await db.collection('edificio').doc('puntos').set({
      lista: state.coleccionPuntos,
      actualizadoEn: new Date().toISOString()
    });
    console.log(`✓ Sincronización en la Nube: ${state.coleccionPuntos.length} puntos guardados en Firestore.`);
  } catch (err) {
    if (err && err.code === 'permission-denied') {
      console.warn('Permiso denegado en Firestore al guardar puntos. Inicia sesión como Administrador autenticado.');
    } else {
      console.warn('Aviso al guardar puntos en Firestore:', err);
    }
  }
}

export function iniciarSincronizacionPuntosNube() {
  if (!db || !firebaseHabilitado) return;

  db.collection('edificio').doc('puntos').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      if (Array.isArray(data.lista)) {
        const editandoModal = document.getElementById('puntoModal') && document.getElementById('puntoModal').style.display !== 'none';
        if (!state.modoInsercionPunto && !state.puntoEnMovimientoId && !editandoModal) {
          state.coleccionPuntos = data.lista.map(p => {
            if (typeof p.altitude !== 'number') {
              p.altitude = elevacionPorDefecto(p.floor);
            }
            return p;
          });
          sincronizarCapasDesdeColeccion();
          console.log(`✓ Sincronización en vivo: ${state.coleccionPuntos.length} puntos cargados desde la nube (Firestore)`);
        }
      }
    } else if (state.coleccionPuntos.length > 0 && state.usuarioRolActual === 'admin') {
      guardarPuntosEnNube();
    }
  }, (err) => {
    console.warn('Error en listener de puntos en Firestore:', err);
  });
}

// ==========================================
// RENDERIZADO DE PUNTOS ESPACIALES 3D (THREE.JS)
// ==========================================
function crearMarkerPunto3D(emoji, categoria) {
  const container = new THREE.Group();

  const sphereGeo = new THREE.SphereGeometry(0.35, 16, 16);
  let sphereColor = 0x2563eb;
  if (categoria === 'zona') sphereColor = 0x10b981;
  else if (categoria === 'equipo') sphereColor = 0xf59e0b;

  const sphereMat = new THREE.MeshBasicMaterial({
    color: sphereColor,
    depthTest: false,
    transparent: true
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  sphere.renderOrder = 9998;
  container.add(sphere);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const cx = 128;
  const cy = 122;
  const radius = 94;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;

  let colorTop = '#3b82f6';
  let colorBottom = '#1d4ed8';
  if (categoria === 'zona') {
    colorTop = '#34d399';
    colorBottom = '#059669';
  } else if (categoria === 'equipo') {
    colorTop = '#fbbf24';
    colorBottom = '#d97706';
  }

  const grad = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  grad.addColorStop(0, colorTop);
  grad.addColorStop(1, colorBottom);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = '96px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.fillText(emoji || '📍', cx, cy + 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const planeMat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    depthTest: false,
    transparent: true
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.renderOrder = 9999;
  container.add(plane);

  return container;
}

export function actualizarEscalaDinamicaPuntos() {
  if (!state.grupoPuntos3D || state.grupoPuntos3D.children.length === 0 || !state.map) return;

  const zoom = state.map.getZoom();
  const metersPerPixel = 153948 / Math.pow(2, zoom);
  const targetPixels = Math.min(26, Math.max(18, 18 + (zoom - 18) * 1.8));
  const meterScale = Math.max(0.65, Math.min(16.0, targetPixels * metersPerPixel));

  state.grupoPuntos3D.children.forEach(group => {
    group.scale.set(meterScale, meterScale, meterScale);
  });
}

export function actualizarOrientacionCamaraPuntos() {
  if (!state.grupoPuntos3D || state.grupoPuntos3D.children.length === 0 || !state.map) return;

  const bearingRad = (state.map.getBearing() * Math.PI) / 180;
  const pitchRad = (state.map.getPitch() * Math.PI) / 180;

  state.grupoPuntos3D.children.forEach(group => {
    group.rotation.order = 'YXZ';
    group.rotation.y = -bearingRad;
    group.rotation.x = pitchRad - Math.PI / 2;
  });
}

export function actualizarPuntos3D() {
  if (!state.grupoPuntos3D) return;

  while (state.grupoPuntos3D.children.length > 0) {
    const obj = state.grupoPuntos3D.children[0];
    state.grupoPuntos3D.remove(obj);
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }

  const puestosVisibles = document.getElementById('toggle-puestos') ? document.getElementById('toggle-puestos').checked : true;
  const zonasVisibles = document.getElementById('toggle-salas') ? document.getElementById('toggle-salas').checked : true;
  const equiposVisibles = document.getElementById('toggle-equipos') ? document.getElementById('toggle-equipos').checked : true;

  const originCoord = mapboxgl.MercatorCoordinate.fromLngLat(MURONTO_CENTER, 0);
  const meterUnits = originCoord.meterInMercatorCoordinateUnits();

  state.coleccionPuntos.forEach(p => {
    const floorNorm = normalizarPiso(p.floor);
    if (state.currentFloor !== 'all' && state.currentFloor !== floorNorm) return;

    if (p.categoria === 'puesto' && !puestosVisibles) return;
    if (p.categoria === 'zona' && !zonasVisibles) return;
    if (p.categoria === 'equipo' && !equiposVisibles) return;

    const ptCoord = mapboxgl.MercatorCoordinate.fromLngLat([p.coords[0], p.coords[1]], 0);
    const dx = (ptCoord.x - originCoord.x) / meterUnits;
    const dz = (ptCoord.y - originCoord.y) / meterUnits;
    const altZ = typeof p.altitude === 'number' ? p.altitude : elevacionPorDefecto(floorNorm);

    const puntoObj = new THREE.Group();
    puntoObj.position.set(dx, altZ, dz);
    puntoObj.userData = {
      puntoId: p.id,
      puntoData: p,
      coords: p.coords,
      altitude: altZ
    };

    puntoObj.add(crearMarkerPunto3D(p.icono || '📍', p.categoria));
    state.grupoPuntos3D.add(puntoObj);
  });

  actualizarEscalaDinamicaPuntos();
  actualizarOrientacionCamaraPuntos();
  if (state.map) state.map.triggerRepaint();
}

export function buscarPunto3DEnClick(pixel) {
  if (!state.grupoPuntos3D || !state.custom3DLayer || !state.custom3DLayer.camera || state.grupoPuntos3D.children.length === 0 || !state.map) {
    return null;
  }

  const canvas = state.map.getCanvas();
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;

  let mejorPunto = null;
  let menorDist = 26;

  state.grupoPuntos3D.children.forEach(group => {
    const p = group.userData.puntoData;
    if (!p) return;

    const worldPos = new THREE.Vector3();
    group.getWorldPosition(worldPos);
    worldPos.applyMatrix4(state.custom3DLayer.camera.projectionMatrix);

    if (worldPos.z < -1 || worldPos.z > 1) return;

    const screenX = (worldPos.x + 1) * 0.5 * width;
    const screenY = (1 - worldPos.y) * 0.5 * height;

    const dist = Math.hypot(pixel.x - screenX, pixel.y - screenY);
    if (dist < menorDist) {
      menorDist = dist;
      mejorPunto = p;
    }
  });

  return mejorPunto;
}
