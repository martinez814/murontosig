// ==========================================
// CALIBRACIÓN 3D, RAYOS X Y SINCRONIZACIÓN DE MODELOS
// ==========================================
import { BASE_INICIAL_MURONTO, MURONTO_CENTER, STORAGE_KEYS, db, firebaseHabilitado } from './config.js';
import { aplicarDatosCalibracion, state } from './state.js';

function aplicarGrupoTransformacion(grupo, calib) {
  if (!grupo) return;
  grupo.position.set(calib.offsetX, calib.altitude, -calib.offsetY);
  grupo.rotation.order = 'YXZ';
  grupo.rotation.y = -(calib.heading * Math.PI) / 180;
  grupo.rotation.x = ((calib.pitch || 0) * Math.PI) / 180;
  grupo.scale.setScalar(calib.scale);
  grupo.updateMatrixWorld(true);
}

/** Sincroniza matriz base Mercator de Mapbox y aplica transformaciones a fachada e interior. */
export function actualizarTransformacion() {
  const modelAsMercatorCoordinate = mapboxgl.MercatorCoordinate.fromLngLat(MURONTO_CENTER, 0);
  const baseScale = modelAsMercatorCoordinate.meterInMercatorCoordinateUnits();

  state.modelTransform = {
    translateX: modelAsMercatorCoordinate.x,
    translateY: modelAsMercatorCoordinate.y,
    translateZ: modelAsMercatorCoordinate.z,
    rotateX: Math.PI / 2,
    rotateY: 0,
    rotateZ: 0,
    scale: baseScale
  };

  aplicarGrupoTransformacion(state.grupoExterior, state.calibExterior);
  aplicarGrupoTransformacion(state.grupoInterior, state.calibInterior);
}

// ==========================================
// EFECTO RAYOS X Y TRANSPARENCIA DINÁMICA
// ==========================================
export function aplicarOpacidadFachada(opacidad) {
  state.currentFachadaOpacity = opacidad;
  state.exteriorMeshes.forEach(mesh => {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(m => {
        m.opacity = opacidad;
        m.depthWrite = opacidad > 0.45;
      });
    } else if (mesh.material) {
      mesh.material.opacity = opacidad;
      mesh.material.depthWrite = opacidad > 0.45;
    }
  });
  if (state.map) state.map.triggerRepaint();
}

export function actualizarTransparenciaPorZoom() {
  if (!state.modoRayosXAutomatico || state.exteriorMeshes.length === 0 || !state.map) return;
  const zoom = state.map.getZoom();

  const zoomMin = 18.2;
  const zoomMax = 20.0;
  let opacidad = 1.0;

  if (zoom <= zoomMin) {
    opacidad = 1.0;
  } else if (zoom >= zoomMax) {
    opacidad = 0.15;
  } else {
    const factor = (zoom - zoomMin) / (zoomMax - zoomMin);
    opacidad = 1.0 - factor * (1.0 - 0.15);
  }

  aplicarOpacidadFachada(opacidad);

  const slider = document.getElementById('sliderOpacidadFachada');
  const txt = document.getElementById('valOpacidadFachada');
  const pct = Math.round(opacidad * 100);
  if (slider) slider.value = pct;
  if (txt) txt.textContent = `${pct}%`;
}

export function cambiarOpacidadManual(valor) {
  const opacidad = parseFloat(valor) / 100;
  const txt = document.getElementById('valOpacidadFachada');
  if (txt) txt.textContent = `${Math.round(valor)}%`;

  state.modoRayosXAutomatico = false;
  const chk = document.getElementById('toggleAutoRayosX');
  if (chk) chk.checked = false;

  aplicarOpacidadFachada(opacidad);
}

export function toggleModoRayosX(activado) {
  state.modoRayosXAutomatico = activado;
  if (activado) {
    actualizarTransparenciaPorZoom();
  }
}

export function toggleFachadaExterior() {
  const chk = document.getElementById('toggle-fachada-exterior');
  state.fachadaExteriorVisible = chk ? chk.checked : true;
  if (state.grupoExterior) state.grupoExterior.visible = state.fachadaExteriorVisible;
  if (state.map) state.map.triggerRepaint();
}

export function toggleModeloInterior() {
  const chk = document.getElementById('toggle-modelo-interior');
  state.modeloInteriorVisible = chk ? chk.checked : true;
  if (state.grupoInterior) state.grupoInterior.visible = state.modeloInteriorVisible;
  if (state.map) state.map.triggerRepaint();
}

// ==========================================
// CALIBRACIÓN INDEPENDIENTE (EXTERIOR / INTERIOR)
// ==========================================
export function getCalibActiva() {
  return state.modeloActivoCalibracion === 'exterior' ? state.calibExterior : state.calibInterior;
}

export function seleccionarModeloCalibrar(tipo) {
  state.modeloActivoCalibracion = tipo;

  const tabExt = document.getElementById('tabExterior');
  const tabInt = document.getElementById('tabInterior');
  const infoEl = document.getElementById('calibrandoInfo');
  const btnCopiar = document.getElementById('btnCopiarExterior');

  if (tabExt) tabExt.classList.toggle('active', tipo === 'exterior');
  if (tabInt) tabInt.classList.toggle('active', tipo === 'interior');

  if (infoEl) {
    if (tipo === 'exterior') {
      infoEl.textContent = 'Ajustando: 🏛️ Fachada Exterior (edificioM-v1)';
      infoEl.style.background = '#dbeafe';
      infoEl.style.color = '#1e40af';
      infoEl.style.borderColor = '#bfdbfe';
    } else {
      infoEl.textContent = 'Ajustando: 🚪 Estructura Interior (medidasmetros-v2)';
      infoEl.style.background = '#fef3c7';
      infoEl.style.color = '#92400e';
      infoEl.style.borderColor = '#fde68a';
    }
  }

  if (btnCopiar) {
    btnCopiar.style.display = tipo === 'interior' ? 'block' : 'none';
  }

  sincronizarSlidersUI();
}

export function copiarPosicionExteriorAInterior() {
  state.calibInterior = { ...state.calibExterior };
  sincronizarSlidersUI();
  actualizarTransformacion();
  autoGuardarLocal();
  if (state.map) state.map.triggerRepaint();

  const btnCopiar = document.getElementById('btnCopiarExterior');
  if (btnCopiar) {
    const originalText = btnCopiar.textContent;
    btnCopiar.textContent = '✓ ¡Copiado de Fachada!';
    setTimeout(() => {
      btnCopiar.textContent = originalText;
    }, 1500);
  }
}

export function sincronizarSlidersUI() {
  const c = getCalibActiva();

  const r = document.getElementById('sliderRotacion');
  const vr = document.getElementById('valRotacion');
  if (r) r.value = c.heading;
  if (vr) vr.textContent = `${Math.round(c.heading)}°`;

  const inc = document.getElementById('sliderInclinacion');
  const vinc = document.getElementById('valInclinacion');
  if (inc) inc.value = c.pitch || 0;
  if (vinc) vinc.textContent = `${Math.round(c.pitch || 0)}°`;

  const ox = document.getElementById('sliderOffsetX');
  const vox = document.getElementById('valOffsetX');
  if (ox) ox.value = c.offsetX;
  if (vox) vox.textContent = `${c.offsetX > 0 ? '+' : ''}${c.offsetX.toFixed(1)} m`;

  const oy = document.getElementById('sliderOffsetY');
  const voy = document.getElementById('valOffsetY');
  if (oy) oy.value = c.offsetY;
  if (voy) voy.textContent = `${c.offsetY > 0 ? '+' : ''}${c.offsetY.toFixed(1)} m`;

  const s = document.getElementById('sliderEscala');
  const vs = document.getElementById('valEscala');
  if (s) s.value = c.scale;
  if (vs) vs.textContent = `${c.scale.toFixed(2)}x`;

  const alt = document.getElementById('sliderElevacion');
  const valt = document.getElementById('valElevacion');
  if (alt) alt.value = c.altitude;
  if (valt) valt.textContent = `${c.altitude.toFixed(1)} m`;
}

function obtenerConfigCalibracion() {
  return {
    version: 2,
    exterior: { ...state.calibExterior },
    interior: { ...state.calibInterior }
  };
}

function autoGuardarLocal() {
  localStorage.setItem(STORAGE_KEYS.CALIBRACION, JSON.stringify(obtenerConfigCalibracion()));
}

export async function cargarCalibracionGuardada() {
  let aplicadaDesdeLocal = false;

  try {
    const local =
      localStorage.getItem(STORAGE_KEYS.CALIBRACION) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY);

    if (local) {
      aplicadaDesdeLocal = aplicarDatosCalibracion(
        JSON.parse(local),
        state.calibExterior,
        state.calibInterior
      );
    }
  } catch (e) {
    console.warn('Error leyendo localStorage:', e);
  }

  if (!aplicadaDesdeLocal) {
    try {
      const res = await fetch('data/calibracion.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        aplicarDatosCalibracion(data, state.calibExterior, state.calibInterior);
      }
    } catch (err) {}
  }

  sincronizarSlidersUI();
  actualizarTransformacion();
  if (state.map) state.map.triggerRepaint();
}

export async function guardarCalibracion() {
  if (state.usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede guardar la calibración.');
    return;
  }

  const config = obtenerConfigCalibracion();

  localStorage.setItem(STORAGE_KEYS.CALIBRACION, JSON.stringify(config));
  localStorage.setItem(STORAGE_KEYS.BASE_ETERNA, JSON.stringify(config));
  console.log('✓ Guardado como Reinicio Eterno en localStorage:', config);

  let guardadoEnNube = false;
  let errorPermisoNube = false;
  if (db && firebaseHabilitado) {
    try {
      await db.collection('edificio').doc('calibracion').set({
        ...config,
        actualizadoEn: new Date().toISOString()
      });
      guardadoEnNube = true;
      console.log('✓ Calibración guardada exitosamente en la nube (Firestore)');
    } catch (e) {
      errorPermisoNube = e && e.code === 'permission-denied';
      console.warn('Error guardando calibración en Firestore:', e);
    }
  }

  const feedback = document.getElementById('saveFeedback');
  const btn = document.getElementById('btnGuardarCalibracion');
  if (feedback) {
    feedback.style.display = 'block';
    feedback.style.color = errorPermisoNube ? '#b45309' : '#166534';
    feedback.textContent = guardadoEnNube
      ? '⭐ ¡Calibración guardada en la Nube con éxito!'
      : (errorPermisoNube
        ? '⚠️ Guardado local; sin permiso en Firestore (verifica sesión admin).'
        : '⭐ ¡Fijado como tu nuevo Reinicio Eterno!');
    setTimeout(() => {
      feedback.style.display = 'none';
    }, 4000);
  }
  if (btn) {
    const originalText = btn.textContent;
    btn.textContent = '⭐ ¡Reinicio Eterno Guardado!';
    btn.style.background = '#16a34a';
    btn.style.borderColor = '#15803d';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '#2563eb';
      btn.style.borderColor = '#1d4ed8';
    }, 1800);
  }
}

function aplicarAjusteCalibracion(campo, valor, elementId, formatter) {
  const c = getCalibActiva();
  c[campo] = parseFloat(valor);
  const el = document.getElementById(elementId);
  if (el) el.textContent = formatter(c[campo]);
  actualizarTransformacion();
  autoGuardarLocal();
  if (state.map) state.map.triggerRepaint();
}

export function ajustarRotacion(valor) {
  aplicarAjusteCalibracion('heading', valor, 'valRotacion', v => `${Math.round(v)}°`);
}

export function ajustarInclinacion(valor) {
  aplicarAjusteCalibracion('pitch', valor, 'valInclinacion', v => `${Math.round(v)}°`);
}

export function ajustarOffsetX(valor) {
  aplicarAjusteCalibracion('offsetX', valor, 'valOffsetX', v => `${v > 0 ? '+' : ''}${v.toFixed(1)} m`);
}

export function ajustarOffsetY(valor) {
  aplicarAjusteCalibracion('offsetY', valor, 'valOffsetY', v => `${v > 0 ? '+' : ''}${v.toFixed(1)} m`);
}

export function ajustarEscala(valor) {
  aplicarAjusteCalibracion('scale', valor, 'valEscala', v => `${v.toFixed(2)}x`);
}

export function ajustarElevacion(valor) {
  aplicarAjusteCalibracion('altitude', valor, 'valElevacion', v => `${v.toFixed(1)} m`);
}

export function restablecerCalibracion() {
  let restaurado = false;
  try {
    const baseGuardada = localStorage.getItem(STORAGE_KEYS.BASE_ETERNA);
    if (baseGuardada) {
      const data = JSON.parse(baseGuardada);
      if (state.modeloActivoCalibracion === 'exterior' && data.exterior) {
        Object.assign(state.calibExterior, data.exterior);
        restaurado = true;
      } else if (state.modeloActivoCalibracion === 'interior' && data.interior) {
        Object.assign(state.calibInterior, data.interior);
        restaurado = true;
      }
    }
  } catch (e) {
    console.warn('Error al restaurar base eterna:', e);
  }

  if (!restaurado) {
    if (state.modeloActivoCalibracion === 'exterior') {
      Object.assign(state.calibExterior, BASE_INICIAL_MURONTO.exterior);
    } else {
      Object.assign(state.calibInterior, BASE_INICIAL_MURONTO.interior);
    }
  }

  sincronizarSlidersUI();
  actualizarTransformacion();
  autoGuardarLocal();
  if (state.map) state.map.triggerRepaint();

  const feedback = document.getElementById('saveFeedback');
  if (feedback) {
    feedback.style.display = 'block';
    feedback.style.color = '#1e40af';
    feedback.textContent = '↺ Restaurado a tu posición de Reinicio Eterno';
    setTimeout(() => {
      feedback.style.display = 'none';
      feedback.style.color = '#166534';
    }, 3000);
  }
}

export function iniciarSincronizacionCalibracionNube() {
  if (!db || !firebaseHabilitado) return;

  db.collection('edificio').doc('calibracion').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      if (data.exterior || data.interior) {
        if (data.exterior) Object.assign(state.calibExterior, data.exterior);
        if (data.interior) Object.assign(state.calibInterior, data.interior);
        actualizarTransformacion();
        sincronizarSlidersUI();
        if (state.map) state.map.triggerRepaint();
        console.log('✓ Calibración 3D sincronizada en vivo desde la nube (Firestore)');
      }
    }
  }, (err) => {
    console.warn('Error en listener de calibración en Firestore:', err);
  });
}
