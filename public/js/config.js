// ==========================================
// CONFIGURACIÓN GLOBAL Y FIREBASE - CIDE-MÜRÖNTÖ
// ==========================================

export const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoibWFydGluZXpraiIsImEiOiJjbXcyMnRib3EwMHg2MnhvbTB5djd1bmVvIn0.RIshKi9a5NeLIaYbaQyUkQ';

// Coordenada Central exacta de MÜRÖNTÖ (Prados del Este - Torre Humboldt)
export const MURONTO_CENTER = [-66.871326, 10.453025];

export const firebaseConfig = {
  apiKey: "AIzaSyBsmmXzXUXXKDGDcISKfGA7beOizFrxIo4",
  authDomain: "muronto-webgis.firebaseapp.com",
  projectId: "muronto-webgis",
  storageBucket: "muronto-webgis.firebasestorage.app",
  messagingSenderId: "206499480120",
  appId: "1:206499480120:web:0cc11fcd9bb18962121ccd",
  measurementId: "G-WLXB6C33K1"
};

export const STORAGE_KEYS = {
  CALIBRACION: 'muronto_calibracion_3d_v2',
  BASE_ETERNA: 'muronto_base_eterna_v2',
  LEGACY: 'muronto_calibracion_3d_v1',
  PUNTOS: 'muronto_puntos_usuario_v1',
  ROL: 'muronto_usuario_rol_v1',
  MAP_STYLE: 'muronto_map_style'
};

// Base oficial predeterminada (Reinicio Eterno verificado)
export const BASE_INICIAL_MURONTO = {
  exterior: {
    heading: 0,
    pitch: 0,
    offsetX: 10,
    offsetY: -3.4,
    scale: 1.05,
    altitude: 0
  },
  interior: {
    heading: 86,
    pitch: 0,
    offsetX: 8.8,
    offsetY: -4,
    scale: 1,
    altitude: 0
  }
};

export let db = null;
export let auth = null;
export let firebaseHabilitado = false;

try {
  if (typeof firebase !== 'undefined' && firebase.initializeApp) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    if (typeof firebase.auth === 'function') {
      auth = firebase.auth();
    }
    firebaseHabilitado = true;
    console.log('✓ Conectado exitosamente a Google Cloud Firestore y Firebase Auth');
  }
} catch (e) {
  console.warn('Firebase no inicializado (modo local/offline):', e);
}

/** Normaliza el identificador de nivel a 'PB' o 'Mezzanina'. */
export function normalizarPiso(floor) {
  return (floor === 1 || floor === '1' || floor === 'PB' || floor === 'pb') ? 'PB' : 'Mezzanina';
}

/** Devuelve la elevación Z por defecto en metros según el nivel. */
export function elevacionPorDefecto(floor) {
  return normalizarPiso(floor) === 'Mezzanina' ? 3.6 : 0.8;
}
