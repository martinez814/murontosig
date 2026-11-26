// ==========================================
// ESTADO COMPARTIDO DE LA APLICACIÓN WEBGIS 3D
// ==========================================
import { BASE_INICIAL_MURONTO, STORAGE_KEYS } from './config.js';

/** Aplica datos de calibración (formato v2 o legado v1) sobre los objetos destino. */
export function aplicarDatosCalibracion(data, exteriorTarget, interiorTarget) {
  if (!data || typeof data !== 'object') return false;

  if (data.exterior || data.interior) {
    if (data.exterior) Object.assign(exteriorTarget, data.exterior);
    if (data.interior) Object.assign(interiorTarget, data.interior);
    return true;
  }

  if (typeof data.heading === 'number') {
    exteriorTarget.heading = data.heading || 0;
    exteriorTarget.offsetX = data.offsetX || 0;
    exteriorTarget.offsetY = data.offsetY || 0;
    exteriorTarget.scale = typeof data.scale === 'number' ? data.scale : 1.0;
    exteriorTarget.altitude = data.altitude || 0;

    Object.assign(interiorTarget, exteriorTarget);
    return true;
  }

  return false;
}

export const state = {
  // Instancia Mapbox y elementos de interacción
  map: null,
  popupActivo: null,
  puntoSeleccionadoActivo: null,
  marcadorBusqueda: null,
  currentFloor: 'all',
  estiloMapaActual: 'mapbox://styles/mapbox/light-v11',

  // Roles y editor espacial
  usuarioRolActual: null,
  coleccionPuntos: [],
  modoInsercionPunto: false,
  puntoEnMovimientoId: null,

  // Calibración independiente (Exterior / Interior)
  modeloActivoCalibracion: 'exterior',
  calibExterior: { ...BASE_INICIAL_MURONTO.exterior },
  calibInterior: { ...BASE_INICIAL_MURONTO.interior },

  // Visibilidad y Rayos X 3D
  modeloRealVisible: true,
  fachadaExteriorVisible: true,
  modeloInteriorVisible: true,
  modoRayosXAutomatico: true,
  exteriorMeshes: [],
  currentFachadaOpacity: 1.0,

  // Referencias Three.js
  rootModelGroup: null,
  grupoExterior: null,
  grupoInterior: null,
  grupoPuntos3D: null,
  gltfModelScene: null,
  gltfInteriorScene: null,
  modelTransform: {}
};

// Carga síncrona inmediata desde localStorage para evitar parpadeos al recargar (F5)
try {
  const guardadoPrevio =
    localStorage.getItem(STORAGE_KEYS.CALIBRACION) ||
    localStorage.getItem(STORAGE_KEYS.BASE_ETERNA) ||
    localStorage.getItem(STORAGE_KEYS.LEGACY);

  if (guardadoPrevio) {
    const parsed = JSON.parse(guardadoPrevio);
    if (aplicarDatosCalibracion(parsed, state.calibExterior, state.calibInterior)) {
      console.log('✓ Posiciones 3D restauradas inmediatamente de localStorage:', {
        exterior: state.calibExterior,
        interior: state.calibInterior
      });
    }
  }
} catch (e) {
  console.warn('Error leyendo localStorage al inicio:', e);
}
