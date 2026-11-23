// ==========================================
// MAPA INTERACTIVO 3D - CIDE-MÜRÖNTÖ
// ==========================================

// Token de Mapbox (Kevin Martinez)
mapboxgl.accessToken = 'pk.eyJ1IjoibWFydGluZXpraiIsImEiOiJjbXcyMnRib3EwMHg2MnhvbTB5djd1bmVvIn0.RIshKi9a5NeLIaYbaQyUkQ';

// Coordenada Central exacta de MÜRÖNTÖ (Prados del Este - Torre Humboldt)
const MURONTO_CENTER = [-66.871326, 10.453025];

// ==========================================
// CONEXIÓN A BASE DE DATOS EN LA NUBE (FIREBASE FIRESTORE)
// Sincronización automática de puntos y calibración en tiempo real para todo el mundo
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBsmmXzXUXXKDGDcISKfGA7beOizFrxIo4",
  authDomain: "muronto-webgis.firebaseapp.com",
  projectId: "muronto-webgis",
  storageBucket: "muronto-webgis.firebasestorage.app",
  messagingSenderId: "206499480120",
  appId: "1:206499480120:web:0cc11fcd9bb18962121ccd",
  measurementId: "G-WLXB6C33K1"
};

let db = null;
let firebaseHabilitado = false;

try {
  if (typeof firebase !== 'undefined' && firebase.initializeApp) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    firebaseHabilitado = true;
    console.log('✓ Conectado exitosamente a Google Cloud Firestore');
  }
} catch (e) {
  console.warn('Firebase no inicializado (modo local/offline):', e);
}

const STORAGE_KEY_CALIBRACION = 'muronto_calibracion_3d_v2';
const STORAGE_KEY_BASE_ETERNA = 'muronto_base_eterna_v2';
const STORAGE_KEY_LEGACY = 'muronto_calibracion_3d_v1';
const STORAGE_KEY_PUNTOS = 'muronto_puntos_usuario_v1';
const STORAGE_KEY_ROL = 'muronto_usuario_rol_v1';

// Clave de acceso del Administrador (configurable por código)
const ADMIN_PASSWORD_CORRECTA = '12345';

// Rol activo del usuario: 'admin' | 'visitante' | null
let usuarioRolActual = null;

// Estado global del gestor y editor de puntos espaciales
let coleccionPuntos = [];
let modoInsercionPunto = false;
let puntoEnMovimientoId = null;

// Base oficial predeterminada (Reinicio Eterno verificado por el usuario)
const BASE_INICIAL_MURONTO = {
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

// Variables de Calibración Independiente para Exterior e Interior
let modeloActivoCalibracion = 'exterior'; // 'exterior' | 'interior'

let calibExterior = { ...BASE_INICIAL_MURONTO.exterior };
let calibInterior = { ...BASE_INICIAL_MURONTO.interior };

// 1. CARGA SÍNCRONA INMEDIATA DESDE LOCALSTORAGE
// Garantiza que al recargar (F5) los valores calibrados se mantengan intactos
try {
  let guardadoPrevio = localStorage.getItem(STORAGE_KEY_CALIBRACION);
  if (!guardadoPrevio) {
    guardadoPrevio = localStorage.getItem(STORAGE_KEY_BASE_ETERNA);
  }
  if (!guardadoPrevio) {
    guardadoPrevio = localStorage.getItem(STORAGE_KEY_LEGACY);
  }
  if (guardadoPrevio) {
    const c = JSON.parse(guardadoPrevio);
    if (c.exterior || c.interior) {
      if (c.exterior) Object.assign(calibExterior, c.exterior);
      if (c.interior) Object.assign(calibInterior, c.interior);
    } else if (typeof c.heading === 'number') {
      calibExterior.heading = c.heading || 0;
      calibExterior.offsetX = c.offsetX || 0;
      calibExterior.offsetY = c.offsetY || 0;
      calibExterior.scale = typeof c.scale === 'number' ? c.scale : 1.0;
      calibExterior.altitude = c.altitude || 0;

      // Usar mismos valores como punto de partida para el interior
      calibInterior.heading = calibExterior.heading;
      calibInterior.offsetX = calibExterior.offsetX;
      calibInterior.offsetY = calibExterior.offsetY;
      calibInterior.scale = calibExterior.scale;
      calibInterior.altitude = calibExterior.altitude;
    }
    console.log('✓ Posiciones 3D restauradas inmediatamente de localStorage:', { exterior: calibExterior, interior: calibInterior });
  }
} catch (e) {
  console.warn('Error leyendo localStorage al inicio:', e);
}

let modeloRealVisible = true;
let fachadaExteriorVisible = true;
let modeloInteriorVisible = true;
let modoRayosXAutomatico = true;
let exteriorMeshes = [];
let currentFachadaOpacity = 1.0;

let rootModelGroup = null;
let grupoExterior = null;       // Grupo Three.js independiente para Fachada Exterior
let grupoInterior = null;       // Grupo Three.js independiente para Estructura Interior
let grupoPuntos3D = null;       // Grupo Three.js independiente para Puntos Espaciales 3D con elevación Z
let gltfModelScene = null;      // Fachada Exterior (edificioM-v1.glb)
let gltfInteriorScene = null;   // Estructura Interior (medidasmetros-v2.glb)
let nodoTerreno = null;
let modelTransform = {};

// Sincronizar matriz base de Mapbox y aplicar transformaciones a cada grupo
function actualizarTransformacion() {
  const modelAsMercatorCoordinate = mapboxgl.MercatorCoordinate.fromLngLat(
    MURONTO_CENTER,
    0
  );

  const baseScale = modelAsMercatorCoordinate.meterInMercatorCoordinateUnits();

  modelTransform = {
    translateX: modelAsMercatorCoordinate.x,
    translateY: modelAsMercatorCoordinate.y,
    translateZ: modelAsMercatorCoordinate.z,
    rotateX: Math.PI / 2, // 90° para orientar eje vertical Three.js con Mapbox
    rotateY: 0,
    rotateZ: 0,
    scale: baseScale
  };

  // 1. Aplicar posición, rotación horizontal y escala a la Fachada Exterior
  if (grupoExterior) {
    grupoExterior.position.set(
      calibExterior.offsetX,
      calibExterior.altitude,
      -calibExterior.offsetY
    );
    grupoExterior.rotation.order = 'YXZ';
    grupoExterior.rotation.y = -(calibExterior.heading * Math.PI) / 180;
    grupoExterior.rotation.x = ((calibExterior.pitch || 0) * Math.PI) / 180;
    grupoExterior.scale.setScalar(calibExterior.scale);
    grupoExterior.updateMatrixWorld(true);
  }

  // 2. Aplicar posición, rotación horizontal y escala a la Estructura Interior
  if (grupoInterior) {
    grupoInterior.position.set(
      calibInterior.offsetX,
      calibInterior.altitude,
      -calibInterior.offsetY
    );
    grupoInterior.rotation.order = 'YXZ';
    grupoInterior.rotation.y = -(calibInterior.heading * Math.PI) / 180;
    grupoInterior.rotation.x = ((calibInterior.pitch || 0) * Math.PI) / 180;
    grupoInterior.scale.setScalar(calibInterior.scale);
    grupoInterior.updateMatrixWorld(true);
  }
}

actualizarTransformacion();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cargarCalibracionGuardada);
} else {
  cargarCalibracionGuardada();
}

// Inicialización del Mapa
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: MURONTO_CENTER,
  zoom: 19.2,
  pitch: 55,
  bearing: -15,
  antialias: true
});

// Controles nativos de Mapbox
map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new mapboxgl.FullscreenControl(), 'top-right');
map.addControl(new mapboxgl.ScaleControl(), 'bottom-right');

// Variable global para popup activo y marcador temporal
let popupActivo = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 20 });
let puntoSeleccionadoActivo = null;
popupActivo.on('close', () => { puntoSeleccionadoActivo = null; });
let marcadorBusqueda = null;
let currentFloor = 'all';

// ==========================================
// CAPA PERSONALIZADA THREE.JS (MODELO SKETCHUP / GLB)
// ==========================================
const custom3DLayer = {
  id: 'capa-modelo-3d-real',
  type: 'custom',
  renderingMode: '3d',
  onAdd: function (mapInstance, gl) {
    this.map = mapInstance;
    this.renderer = new THREE.WebGLRenderer({
      canvas: mapInstance.getCanvas(),
      context: gl,
      antialias: true
    });
    this.renderer.autoClear = false;

    if (this.scene) {
      console.log('✓ Re-vinculando capa Three.js al nuevo estilo de mapa');
      return;
    }

    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();

    // Grupo raíz anclado en coordenadas MÜRÖNTÖ
    rootModelGroup = new THREE.Group();
    this.scene.add(rootModelGroup);

    // Grupos Three.js independientes para Fachada e Interior
    grupoExterior = new THREE.Group();
    grupoExterior.rotation.order = 'YXZ';
    rootModelGroup.add(grupoExterior);

    grupoInterior = new THREE.Group();
    grupoInterior.rotation.order = 'YXZ';
    rootModelGroup.add(grupoInterior);

    // Grupo Three.js para Puntos Espaciales 3D elevados en el eje Z (PB y Mezzanina)
    grupoPuntos3D = new THREE.Group();
    rootModelGroup.add(grupoPuntos3D);

    // 1. Iluminación realista para destacar fachadas y volúmenes
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight1.position.set(60, -90, 120).normalize();
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.45);
    dirLight2.position.set(-60, 90, 80).normalize();
    this.scene.add(dirLight2);

    // Luz interior suave para iluminar oficinas y divisiones internas
    const interiorLight = new THREE.PointLight(0xffffff, 0.7, 50);
    interiorLight.position.set(0, 5, 0);
    this.scene.add(interiorLight);

    // 2. Cargar modelo exterior (Fachada edificioM-v1.glb)
    const loader = new THREE.GLTFLoader();
    const statusContainer = document.getElementById('modelStatus');
    const statusText = document.getElementById('modelStatusText');

    loader.load(
      'models/edificioM-v1.glb',
      (gltf) => {
        gltfModelScene = gltf.scene;

        // Auto-centrar la fachada en su base geométrica para girar sobre su propio eje
        const bbox = new THREE.Box3().setFromObject(gltfModelScene);
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());

        gltfModelScene.position.set(-center.x, -bbox.min.y, -center.z);
        grupoExterior.add(gltfModelScene);

        // Configurar todos los materiales de la fachada para permitir transparencia
        exteriorMeshes = [];
        gltfModelScene.traverse((child) => {
          if (child.isMesh) {
            if (Array.isArray(child.material)) {
              child.material = child.material.map(m => m.clone());
              child.material.forEach(m => { m.transparent = true; m.needsUpdate = true; });
            } else if (child.material) {
              child.material = child.material.clone();
              child.material.transparent = true;
              child.material.needsUpdate = true;
            }
            exteriorMeshes.push(child);
          }
        });

        if (statusContainer && statusText) {
          statusContainer.className = 'model-status-indicator ready';
          statusText.textContent = `✓ Fachada cargada (${size.x.toFixed(0)}m x ${size.z.toFixed(0)}m, Alt: ${size.y.toFixed(1)}m)`;
        }
        console.log('✓ Fachada exterior edificioM-v1.glb cargada:', size);

        actualizarTransformacion();
        actualizarTransparenciaPorZoom();
        this.map.triggerRepaint();
      },
      undefined,
      (error) => {
        console.warn('Aviso al cargar fachada exterior:', error);
      }
    );

    // 3. Cargar segundo modelo: Estructura Interior (medidasmetros-v2.glb)
    const loaderInterior = new THREE.GLTFLoader();
    const interiorStatus = document.getElementById('interiorStatus');
    const interiorText = document.getElementById('interiorStatusText');

    loaderInterior.load(
      'models/medidasmetros-v2.glb',
      (gltfInt) => {
        gltfInteriorScene = gltfInt.scene;

        // Centrar el interior en su propia base geométrica para girar sobre su propio eje
        const bboxInt = new THREE.Box3().setFromObject(gltfInteriorScene);
        const centerInt = bboxInt.getCenter(new THREE.Vector3());
        const sizeInt = bboxInt.getSize(new THREE.Vector3());

        gltfInteriorScene.position.set(-centerInt.x, -bboxInt.min.y, -centerInt.z);

        // Activar doble cara en polígonos del interior para paredes y divisiones visibles
        gltfInteriorScene.traverse((child) => {
          if (child.isMesh) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => { m.side = THREE.DoubleSide; });
            } else if (child.material) {
              child.material.side = THREE.DoubleSide;
            }
          }
        });

        grupoInterior.add(gltfInteriorScene);

        if (interiorStatus && interiorText) {
          interiorStatus.className = 'model-status-indicator ready';
          interiorText.textContent = `✓ Interior cargado (${sizeInt.x.toFixed(0)}m x ${sizeInt.z.toFixed(0)}m, Alt: ${sizeInt.y.toFixed(1)}m)`;
        }
        console.log('✓ Estructura interior medidasmetros-v2.glb cargada exitosamente:', sizeInt);

        actualizarTransformacion();
        this.map.triggerRepaint();
      },
      undefined,
      (errInt) => {
        if (interiorStatus && interiorText) {
          interiorStatus.className = 'model-status-indicator waiting';
          interiorText.textContent = 'Esperando models/medidasmetros-v2.glb';
        }
        console.info('Aviso: Coloca tu archivo en public/models/medidasmetros-v2.glb para ver el interior.');
      }
    );
  },
  render: function (gl, matrix) {
    if (!this.scene || !this.camera || !modeloRealVisible) return;

    // Respetar visibilidad individual de exterior e interior
    if (grupoExterior) grupoExterior.visible = fachadaExteriorVisible;
    if (grupoInterior) grupoInterior.visible = modeloInteriorVisible;

    actualizarTransformacion();

    const rotationX = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(1, 0, 0),
      modelTransform.rotateX
    );
    const rotationY = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 1, 0),
      modelTransform.rotateY
    );
    const rotationZ = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 0, 1),
      modelTransform.rotateZ
    );

    const m = new THREE.Matrix4().fromArray(matrix);
    const l = new THREE.Matrix4()
      .makeTranslation(
        modelTransform.translateX,
        modelTransform.translateY,
        modelTransform.translateZ
      )
      .scale(
        new THREE.Vector3(
          modelTransform.scale,
          -modelTransform.scale,
          modelTransform.scale
        )
      )
      .multiply(rotationX)
      .multiply(rotationY)
      .multiply(rotationZ);

    // Ajustar escala y orientación adaptativa de los puntos 3D según el zoom y giro de cámara (360°)
    if (typeof actualizarEscalaDinamicaPuntos === 'function') {
      actualizarEscalaDinamicaPuntos();
    }
    if (typeof actualizarOrientacionCamaraPuntos === 'function') {
      actualizarOrientacionCamaraPuntos();
    }

    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }
};

// ==========================================
// GESTOR DE ESTILOS Y CAPAS DE MAPA (LADO DERECHO)
// ==========================================
let estiloMapaActual = 'mapbox://styles/mapbox/light-v11';

function reconfigurarFuentesYCapasGeoJSON() {
  if (!map.getSource('puestos-source')) {
    map.addSource('puestos-source', {
      type: 'geojson',
      data: puestosData
    });
    map.addLayer({
      id: 'capa-puestos',
      type: 'circle',
      source: 'puestos-source',
      layout: { 'visibility': 'none' },
      paint: {
        'circle-radius': 0,
        'circle-opacity': 0,
        'circle-stroke-width': 0,
        'circle-stroke-opacity': 0
      }
    });
  }

  if (!map.getSource('zonas-source')) {
    map.addSource('zonas-source', {
      type: 'geojson',
      data: zonasData
    });
    map.addLayer({
      id: 'capa-zonas',
      type: 'circle',
      source: 'zonas-source',
      layout: { 'visibility': 'none' },
      paint: {
        'circle-radius': 0,
        'circle-opacity': 0,
        'circle-stroke-width': 0,
        'circle-stroke-opacity': 0
      }
    });
  }

  if (!map.getSource('equipos-source')) {
    map.addSource('equipos-source', {
      type: 'geojson',
      data: equipamientoData
    });
    map.addLayer({
      id: 'capa-equipos',
      type: 'circle',
      source: 'equipos-source',
      layout: { 'visibility': 'none' },
      paint: {
        'circle-radius': 0,
        'circle-opacity': 0,
        'circle-stroke-width': 0,
        'circle-stroke-opacity': 0
      }
    });
  }
}

function cambiarEstiloMapa(nuevoEstilo, botonElement) {
  if (estiloMapaActual === nuevoEstilo) return;
  estiloMapaActual = nuevoEstilo;

  // Actualizar estado activo en los botones de estilo
  document.querySelectorAll('.style-card-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-style') === nuevoEstilo);
  });

  try {
    localStorage.setItem('muronto_map_style', nuevoEstilo);
  } catch (e) {}

  // Si está en celular, colapsar el menú de estilos tras elegir opción para ver el mapa
  if (window.innerWidth <= 768) {
    const panel = document.getElementById('map-styles-panel');
    if (panel && !panel.classList.contains('collapsed')) {
      toggleColapsoEstilos();
    }
  }

  // Aplicar nuevo estilo en Mapbox
  map.setStyle(nuevoEstilo);

  // Re-conectar Three.js y capas GeoJSON cuando el nuevo estilo termine de cargar
  map.once('style.load', () => {
    if (!map.getLayer(custom3DLayer.id)) {
      map.addLayer(custom3DLayer);
    }
    reconfigurarFuentesYCapasGeoJSON();
    sincronizarCapasDesdeColeccion();
    actualizarTransparenciaPorZoom();
    actualizarTransformacion();
    if (typeof actualizarPuntos3D === 'function') {
      actualizarPuntos3D();
    }
    map.triggerRepaint();
  });
}

function toggleColapsoEstilos() {
  const panel = document.getElementById('map-styles-panel');
  const btn = document.getElementById('btnColapsarEstilos');
  if (panel) {
    const colapsado = panel.classList.toggle('collapsed');
    if (btn) {
      btn.textContent = colapsado ? '▼' : '▲';
      btn.title = colapsado ? 'Expandir panel' : 'Minimizar panel';
    }
  }
}

function cargarEstiloMapaGuardado() {
  try {
    const guardado = localStorage.getItem('muronto_map_style');
    if (guardado === 'mapbox://styles/mapbox/satellite-streets-v12') {
      localStorage.removeItem('muronto_map_style');
      return;
    }
    if (guardado && guardado !== estiloMapaActual) {
      cambiarEstiloMapa(guardado);
    }
  } catch (e) {}
}

// ==========================================
// CONTROL DEL PANEL EN DISPOSITIVOS MÓVILES (CELULARES)
// ==========================================
function togglePanelMovil(abrir) {
  const panel = document.getElementById('control-panel');
  const backdrop = document.getElementById('mobilePanelBackdrop');
  const btnAbrir = document.getElementById('btnAbrirPanelMovil');

  const debeAbrir = typeof abrir === 'boolean'
    ? abrir
    : (panel ? !panel.classList.contains('mobile-open') : false);

  if (panel) {
    panel.classList.toggle('mobile-open', debeAbrir);
  }
  if (backdrop) {
    backdrop.classList.toggle('active', debeAbrir);
  }
  if (btnAbrir) {
    btnAbrir.style.display = debeAbrir ? 'none' : '';
  }
}

function autoCerrarPanelEnMovil() {
  if (window.innerWidth <= 768) {
    togglePanelMovil(false);
  }
}

// ==========================================
// CARGA DE CAPAS AL INICIAR MAPBOX
// ==========================================
map.on('load', () => {
  // Cargar calibración persistente guardada
  cargarCalibracionGuardada();

  // 1. Agregar capa del modelo 3D externo (Three.js)
  map.addLayer(custom3DLayer);

  // 2. Fuentes GeoJSON para datos de búsqueda y capas
  reconfigurarFuentesYCapasGeoJSON();

  // Cargar puntos de interior (desde localStorage o archivo office_data.js)
  cargarPuntosIniciales();

  // Inicializar control de acceso / roles de usuario
  inicializarSistemaUsuarios();

  // Iniciar sincronización en tiempo real con Firebase Firestore
  iniciarSincronizacionPuntosNube();
  iniciarSincronizacionCalibracionNube();

  // Cargar estilo preferido guardado si existe
  cargarEstiloMapaGuardado();

  // En celulares, colapsar el menú de estilos por defecto para máxima visibilidad 3D
  if (window.innerWidth <= 768) {
    const panelEstilos = document.getElementById('map-styles-panel');
    if (panelEstilos) {
      panelEstilos.classList.add('collapsed');
      const btn = document.getElementById('btnColapsarEstilos');
      if (btn) btn.textContent = '▼';
    }
  }

  // Click interactivo en Puestos de Trabajo
  map.on('click', 'capa-puestos', (e) => {
    if (modoInsercionPunto || puntoEnMovimientoId) return;
    e.originalEvent.stopPropagation();
    mostrarPopupPunto(e.features[0], e.lngLat);
  });

  // Click interactivo en Salas y Zonas
  map.on('click', 'capa-zonas', (e) => {
    if (modoInsercionPunto || puntoEnMovimientoId) return;
    e.originalEvent.stopPropagation();
    mostrarPopupPunto(e.features[0], e.lngLat);
  });

  // Click interactivo en Equipamiento
  map.on('click', 'capa-equipos', (e) => {
    if (modoInsercionPunto || puntoEnMovimientoId) return;
    e.originalEvent.stopPropagation();
    mostrarPopupPunto(e.features[0], e.lngLat);
  });

  // Monitorear zoom y movimiento de cámara para actualizar transparencia y posición del popup 3D
  map.on('zoom', actualizarTransparenciaPorZoom);
  map.on('move', () => {
    actualizarTransparenciaPorZoom();
    if (popupActivo && popupActivo.isOpen() && puntoSeleccionadoActivo && typeof calcularAnchorLngLat3D === 'function') {
      const nuevoAnchor = calcularAnchorLngLat3D(
        puntoSeleccionadoActivo.coords,
        puntoSeleccionadoActivo.altitude,
        puntoSeleccionadoActivo.floor
      );
      popupActivo.setLngLat(nuevoAnchor);
    }
  });
});

// ==========================================
// EFECTO RAYOS X Y TRANSPARENCIA DINÁMICA
// ==========================================
function aplicarOpacidadFachada(opacidad) {
  currentFachadaOpacity = opacidad;
  exteriorMeshes.forEach(mesh => {
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
  if (map) map.triggerRepaint();
}

function actualizarTransparenciaPorZoom() {
  if (!modoRayosXAutomatico || exteriorMeshes.length === 0) return;
  const zoom = map.getZoom();

  // A distancia (zoom <= 18.2): Fachada sólida al 100%
  // Al acercarse (zoom >= 20.0): Fachada transparente al 15% (interior visible)
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

function cambiarOpacidadManual(valor) {
  const opacidad = parseFloat(valor) / 100;
  const txt = document.getElementById('valOpacidadFachada');
  if (txt) txt.textContent = `${Math.round(valor)}%`;

  modoRayosXAutomatico = false;
  const chk = document.getElementById('toggleAutoRayosX');
  if (chk) chk.checked = false;

  aplicarOpacidadFachada(opacidad);
}

function toggleModoRayosX(activado) {
  modoRayosXAutomatico = activado;
  if (activado) {
    actualizarTransparenciaPorZoom();
  }
}

function toggleFachadaExterior() {
  const chk = document.getElementById('toggle-fachada-exterior');
  fachadaExteriorVisible = chk ? chk.checked : true;
  if (grupoExterior) grupoExterior.visible = fachadaExteriorVisible;
  if (map) map.triggerRepaint();
}

function toggleModeloInterior() {
  const chk = document.getElementById('toggle-modelo-interior');
  modeloInteriorVisible = chk ? chk.checked : true;
  if (grupoInterior) grupoInterior.visible = modeloInteriorVisible;
  if (map) map.triggerRepaint();
}

// ==========================================
// FUNCIONES DE CALIBRACIÓN INDEPENDIENTE (EXTERIOR / INTERIOR)
// ==========================================

function getCalibActiva() {
  return modeloActivoCalibracion === 'exterior' ? calibExterior : calibInterior;
}

function seleccionarModeloCalibrar(tipo) {
  modeloActivoCalibracion = tipo; // 'exterior' | 'interior'

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
    btnCopiar.style.display = (tipo === 'interior') ? 'block' : 'none';
  }

  sincronizarSlidersUI();
}

function copiarPosicionExteriorAInterior() {
  calibInterior = { ...calibExterior };
  sincronizarSlidersUI();
  actualizarTransformacion();
  autoGuardarLocal();
  if (map) map.triggerRepaint();

  const btnCopiar = document.getElementById('btnCopiarExterior');
  if (btnCopiar) {
    const originalText = btnCopiar.textContent;
    btnCopiar.textContent = '✓ ¡Copiado de Fachada!';
    setTimeout(() => {
      btnCopiar.textContent = originalText;
    }, 1500);
  }
}

function sincronizarSlidersUI() {
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
    exterior: { ...calibExterior },
    interior: { ...calibInterior }
  };
}

function autoGuardarLocal() {
  const config = obtenerConfigCalibracion();
  localStorage.setItem(STORAGE_KEY_CALIBRACION, JSON.stringify(config));
}

// Cargar calibración persistente (dando prioridad a los ajustes locales guardados)
async function cargarCalibracionGuardada() {
  let aplicadaDesdeLocal = false;

  // 1. Prioridad: Lo que el usuario calibró y guardó en su navegador
  try {
    let local = localStorage.getItem(STORAGE_KEY_CALIBRACION);
    if (!local) {
      local = localStorage.getItem(STORAGE_KEY_LEGACY);
    }
    if (local) {
      const data = JSON.parse(local);
      if (data.exterior || data.interior) {
        if (data.exterior) Object.assign(calibExterior, data.exterior);
        if (data.interior) Object.assign(calibInterior, data.interior);
        aplicadaDesdeLocal = true;
      } else if (typeof data.heading === 'number') {
        calibExterior.heading = data.heading || 0;
        calibExterior.offsetX = data.offsetX || 0;
        calibExterior.offsetY = data.offsetY || 0;
        calibExterior.scale = typeof data.scale === 'number' ? data.scale : 1.0;
        calibExterior.altitude = data.altitude || 0;

        calibInterior.heading = calibExterior.heading;
        calibInterior.offsetX = calibExterior.offsetX;
        calibInterior.offsetY = calibExterior.offsetY;
        calibInterior.scale = calibExterior.scale;
        calibInterior.altitude = calibExterior.altitude;
        aplicadaDesdeLocal = true;
      }
    }
  } catch (e) {
    console.warn('Error leyendo localStorage:', e);
  }

  // 2. Si no hay nada en el navegador (primer inicio), leer calibracion.json del servidor
  if (!aplicadaDesdeLocal) {
    try {
      const res = await fetch('data/calibracion.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (data.exterior || data.interior) {
          if (data.exterior) Object.assign(calibExterior, data.exterior);
          if (data.interior) Object.assign(calibInterior, data.interior);
        } else if (typeof data.heading === 'number') {
          calibExterior.heading = data.heading || 0;
          calibExterior.offsetX = data.offsetX || 0;
          calibExterior.offsetY = data.offsetY || 0;
          calibExterior.scale = typeof data.scale === 'number' ? data.scale : 1.0;
          calibExterior.altitude = data.altitude || 0;

          calibInterior.heading = calibExterior.heading;
          calibInterior.offsetX = calibExterior.offsetX;
          calibInterior.offsetY = calibExterior.offsetY;
          calibInterior.scale = calibExterior.scale;
          calibInterior.altitude = calibExterior.altitude;
        }
      }
    } catch (err) {}
  }

  sincronizarSlidersUI();
  actualizarTransformacion();
  if (map) map.triggerRepaint();
}

async function guardarCalibracion() {
  if (usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede guardar la calibración.');
    return;
  }

  const config = obtenerConfigCalibracion();

  // 1. Guardar en navegador como estado activo Y como Base Eterna de Reinicio
  localStorage.setItem(STORAGE_KEY_CALIBRACION, JSON.stringify(config));
  localStorage.setItem(STORAGE_KEY_BASE_ETERNA, JSON.stringify(config));
  console.log('✓ Guardado como Reinicio Eterno en localStorage:', config);

  // 2. Sincronizar en la Nube (Google Cloud Firestore) para todos los usuarios
  let guardadoEnNube = false;
  if (db && firebaseHabilitado) {
    try {
      await db.collection('edificio').doc('calibracion').set({
        ...config,
        actualizadoEn: new Date().toISOString()
      });
      guardadoEnNube = true;
      console.log('✓ Calibración guardada exitosamente en la nube (Firestore)');
    } catch (e) {
      console.warn('Error guardando calibración en Firestore:', e);
    }
  }

  // Feedback visual para el usuario
  const feedback = document.getElementById('saveFeedback');
  const btn = document.getElementById('btnGuardarCalibracion');
  if (feedback) {
    feedback.style.display = 'block';
    feedback.style.color = '#166534';
    feedback.textContent = guardadoEnNube
      ? '⭐ ¡Calibración guardada en la Nube con éxito!'
      : '⭐ ¡Fijado como tu nuevo Reinicio Eterno!';
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

function ajustarRotacion(valor) {
  const c = getCalibActiva();
  c.heading = parseFloat(valor);
  const el = document.getElementById('valRotacion');
  if (el) el.textContent = `${Math.round(c.heading)}°`;
  actualizarTransformacion();
  autoGuardarLocal();
  if (map) map.triggerRepaint();
}

function ajustarInclinacion(valor) {
  const c = getCalibActiva();
  c.pitch = parseFloat(valor);
  const el = document.getElementById('valInclinacion');
  if (el) el.textContent = `${Math.round(c.pitch)}°`;
  actualizarTransformacion();
  autoGuardarLocal();
  if (map) map.triggerRepaint();
}

function ajustarOffsetX(valor) {
  const c = getCalibActiva();
  c.offsetX = parseFloat(valor);
  const el = document.getElementById('valOffsetX');
  if (el) el.textContent = `${c.offsetX > 0 ? '+' : ''}${c.offsetX.toFixed(1)} m`;
  actualizarTransformacion();
  autoGuardarLocal();
  if (map) map.triggerRepaint();
}

function ajustarOffsetY(valor) {
  const c = getCalibActiva();
  c.offsetY = parseFloat(valor);
  const el = document.getElementById('valOffsetY');
  if (el) el.textContent = `${c.offsetY > 0 ? '+' : ''}${c.offsetY.toFixed(1)} m`;
  actualizarTransformacion();
  autoGuardarLocal();
  if (map) map.triggerRepaint();
}

function ajustarEscala(valor) {
  const c = getCalibActiva();
  c.scale = parseFloat(valor);
  const el = document.getElementById('valEscala');
  if (el) el.textContent = `${c.scale.toFixed(2)}x`;
  actualizarTransformacion();
  autoGuardarLocal();
  if (map) map.triggerRepaint();
}

function ajustarElevacion(valor) {
  const c = getCalibActiva();
  c.altitude = parseFloat(valor);
  const el = document.getElementById('valElevacion');
  if (el) el.textContent = `${c.altitude.toFixed(1)} m`;
  actualizarTransformacion();
  autoGuardarLocal();
  if (map) map.triggerRepaint();
}

// NUNCA regresar a ceros: Restaura al Reinicio Eterno que guardó el usuario
function restablecerCalibracion() {
  let restaurado = false;
  try {
    const baseGuardada = localStorage.getItem(STORAGE_KEY_BASE_ETERNA);
    if (baseGuardada) {
      const data = JSON.parse(baseGuardada);
      if (modeloActivoCalibracion === 'exterior' && data.exterior) {
        Object.assign(calibExterior, data.exterior);
        restaurado = true;
      } else if (modeloActivoCalibracion === 'interior' && data.interior) {
        Object.assign(calibInterior, data.interior);
        restaurado = true;
      }
    }
  } catch (e) {
    console.warn('Error al restaurar base eterna:', e);
  }

  if (!restaurado) {
    // Si aún no se guardó base en este navegador, usar la base oficial inicial (Torre Humboldt)
    if (modeloActivoCalibracion === 'exterior') {
      Object.assign(calibExterior, BASE_INICIAL_MURONTO.exterior);
    } else {
      Object.assign(calibInterior, BASE_INICIAL_MURONTO.interior);
    }
  }

  sincronizarSlidersUI();
  actualizarTransformacion();
  autoGuardarLocal();
  if (map) map.triggerRepaint();

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

// Copiar configuración al portapapeles para pegarla en el chat con Antigravity
function copiarCalibracionParaChat() {
  const config = obtenerConfigCalibracion();
  const jsonStr = JSON.stringify(config, null, 2);
  navigator.clipboard.writeText(jsonStr).then(() => {
    const feedback = document.getElementById('saveFeedback');
    if (feedback) {
      feedback.style.display = 'block';
      feedback.style.color = '#1e40af';
      feedback.textContent = '📋 ¡Coordenadas copiadas! Pégalas en el chat de Antigravity.';
      setTimeout(() => {
        feedback.style.display = 'none';
        feedback.style.color = '#166534';
      }, 4000);
    }
  }).catch(() => {
    prompt('Copia manualmente este texto para pegarlo en el chat:', jsonStr);
  });
}

// Descargar calibracion.json directamente con el navegador
function descargarCalibracionJson() {
  const config = obtenerConfigCalibracion();
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(config, null, 2));
  const a = document.createElement('a');
  a.setAttribute('href', dataStr);
  a.setAttribute('download', 'calibracion.json');
  document.body.appendChild(a);
  a.click();
  a.remove();

  const feedback = document.getElementById('saveFeedback');
  if (feedback) {
    feedback.style.display = 'block';
    feedback.style.color = '#166534';
    feedback.textContent = '📥 Descargando calibracion.json con tus ajustes actuales...';
    setTimeout(() => { feedback.style.display = 'none'; }, 4000);
  }
}

function toggleModeloReal() {
  const checkbox = document.getElementById('toggle-modelo-real');
  modeloRealVisible = checkbox ? checkbox.checked : true;
  map.triggerRepaint();
}

function toggleTerrenoModelo() {
  const checkbox = document.getElementById('toggle-terreno-glb');
  if (nodoTerreno) {
    nodoTerreno.visible = checkbox ? checkbox.checked : true;
    map.triggerRepaint();
  }
}

// ==========================================
// FILTRADO POR NIVELES / PISOS (PB Y MEZZANINA)
// ==========================================
function filtrarPorNivel(piso) {
  currentFloor = piso;
  autoCerrarPanelEnMovil();

  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-level') === String(piso));
  });

  if (piso === 'all') {
    map.setFilter('capa-puestos', null);
    map.setFilter('capa-zonas', null);
    map.setFilter('capa-equipos', null);
  } else if (piso === 'PB' || piso === 1 || piso === '1') {
    const filterCond = ['any', 
      ['==', ['get', 'floor'], 'PB'], 
      ['==', ['get', 'floor'], 1], 
      ['==', ['get', 'pisoNum'], 1]
    ];
    map.setFilter('capa-puestos', filterCond);
    map.setFilter('capa-zonas', filterCond);
    map.setFilter('capa-equipos', filterCond);
  } else if (piso === 'Mezzanina' || piso === 2 || piso === '2') {
    const filterCond = ['any', 
      ['==', ['get', 'floor'], 'Mezzanina'], 
      ['==', ['get', 'floor'], 2], 
      ['==', ['get', 'pisoNum'], 2]
    ];
    map.setFilter('capa-puestos', filterCond);
    map.setFilter('capa-zonas', filterCond);
    map.setFilter('capa-equipos', filterCond);
  } else {
    map.setFilter('capa-puestos', ['==', ['get', 'floor'], piso]);
    map.setFilter('capa-zonas', ['==', ['get', 'floor'], piso]);
    map.setFilter('capa-equipos', ['==', ['get', 'floor'], piso]);
  }

  // Garantizar que las capas 2D del suelo permanezcan siempre apagadas para evitar puntos dobles en el suelo
  ['capa-puestos', 'capa-zonas', 'capa-equipos'].forEach(lid => {
    if (map.getLayer(lid)) {
      map.setLayoutProperty(lid, 'visibility', 'none');
    }
  });

  if (typeof actualizarPuntos3D === 'function') {
    actualizarPuntos3D();
  }
}

// ==========================================
// ALTERNADOR DE CAPAS (TOGGLES)
// ==========================================
function toggleCapa(checkboxId, layerId) {
  // Asegurar que las capas 2D del suelo permanezcan siempre invisibles (0 duplicados en el suelo)
  if (layerId && map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, 'visibility', 'none');
  }

  // Actualizar exclusivamente los marcadores 3D flotantes con su elevación en Z
  if (typeof actualizarPuntos3D === 'function') {
    actualizarPuntos3D();
  }
}

// ==========================================
// BÚSQUEDA INTELIGENTE Y AUTOCOMPLETADO
// ==========================================
const searchInput = document.getElementById('searchBox');
const searchSuggestions = document.getElementById('searchSuggestions');
const clearSearchBtn = document.getElementById('clearSearchBtn');

function normalizarTexto(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function actualizarSugerencias(query) {
  if (!query) {
    searchSuggestions.style.display = 'none';
    searchSuggestions.innerHTML = '';
    clearSearchBtn.style.display = 'none';
    return;
  }

  clearSearchBtn.style.display = 'block';
  const queryNorm = normalizarTexto(query);

  const resultados = searchData.filter(item => {
    return normalizarTexto(item.label).includes(queryNorm) ||
           normalizarTexto(item.info).includes(queryNorm) ||
           normalizarTexto(item.category).includes(queryNorm);
  });

  if (resultados.length === 0) {
    searchSuggestions.innerHTML = `
      <div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
        No se encontraron coincidencias
      </div>
    `;
    searchSuggestions.style.display = 'block';
    return;
  }

  searchSuggestions.innerHTML = resultados.slice(0, 6).map(item => `
    <div class="suggestion-item" onclick="seleccionarResultado(${item.id})">
      <div class="suggestion-left">
        <span style="font-size: 16px;">${item.icon}</span>
        <div>
          <div class="suggestion-title">${item.label}</div>
          <div class="suggestion-subtitle">${item.info}</div>
        </div>
      </div>
      <span class="suggestion-badge">Piso ${item.floor}</span>
    </div>
  `).join('');

  searchSuggestions.style.display = 'block';
}

function seleccionarResultado(id) {
  autoCerrarPanelEnMovil();
  const item = searchData.find(i => String(i.id) === String(id));
  if (!item) return;

  searchInput.value = item.label;
  searchSuggestions.style.display = 'none';

  if (currentFloor !== 'all' && currentFloor !== String(item.floor)) {
    filtrarPorNivel(item.floor);
  }

  map.flyTo({
    center: item.coords,
    zoom: 20.5,
    pitch: 60,
    bearing: -15,
    essential: true,
    speed: 1.2
  });

  if (marcadorBusqueda) marcadorBusqueda.remove();
  
  marcadorBusqueda = new mapboxgl.Marker({ color: '#ef4444' })
    .setLngLat(item.coords)
    .addTo(map);

  const puntoReal = coleccionPuntos.find(p => String(p.id) === String(id));
  if (puntoReal) {
    mostrarPopupPunto({
      properties: {
        id: puntoReal.id,
        nombre: puntoReal.nombre,
        categoria: puntoReal.categoria,
        floor: puntoReal.floor,
        altitude: puntoReal.altitude,
        icono: puntoReal.icono,
        detalle: puntoReal.detalle
      },
      geometry: { coordinates: puntoReal.coords }
    }, item.coords);
  }
}

// Eventos del buscador
if (searchInput) {
  searchInput.addEventListener('input', (e) => actualizarSugerencias(e.target.value.trim()));
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const queryNorm = normalizarTexto(searchInput.value.trim());
      const primerResultado = searchData.find(item => 
        normalizarTexto(item.label).includes(queryNorm) || 
        normalizarTexto(item.info).includes(queryNorm)
      );
      if (primerResultado) {
        seleccionarResultado(primerResultado.id);
      }
    }
  });
}

if (clearSearchBtn) {
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    actualizarSugerencias('');
    if (marcadorBusqueda) marcadorBusqueda.remove();
    popupActivo.remove();
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrapper')) {
    searchSuggestions.style.display = 'none';
  }
});

// ==========================================
// VISTAS RÁPIDAS (PRESETS)
// ==========================================
function verVista3D() {
  autoCerrarPanelEnMovil();
  map.flyTo({
    center: MURONTO_CENTER,
    zoom: 19.3,
    pitch: 60,
    bearing: -20,
    speed: 1.2
  });
}

function verVista2D() {
  autoCerrarPanelEnMovil();
  map.flyTo({
    center: MURONTO_CENTER,
    zoom: 19.6,
    pitch: 0,
    bearing: 0,
    speed: 1.2
  });
}

function centrarSede() {
  autoCerrarPanelEnMovil();
  filtrarPorNivel('all');
  map.flyTo({
    center: MURONTO_CENTER,
    zoom: 19.2,
    pitch: 55,
    bearing: -15,
    speed: 1.2
  });
}

// ==========================================
// INSPECTOR DE COORDENADAS (Barra Inferior)
// ==========================================
const coordsDisplay = document.getElementById('coords-display');
const copyCoordsBtn = document.getElementById('copy-coords-btn');

let ultimaCoordenada = MURONTO_CENTER;

map.on('mousemove', (e) => {
  const lng = e.lngLat.lng.toFixed(6);
  const lat = e.lngLat.lat.toFixed(6);
  coordsDisplay.textContent = `Longitud: ${lng} | Latitud: ${lat}`;
  ultimaCoordenada = [parseFloat(lng), parseFloat(lat)];

  if (!modoInsercionPunto && !puntoEnMovimientoId && typeof buscarPunto3DEnClick === 'function') {
    const p3d = buscarPunto3DEnClick(e.point);
    map.getCanvas().style.cursor = p3d ? 'pointer' : '';
  }
});

map.on('click', (e) => {
  // 1. Modo de inserción de nuevo punto
  if (modoInsercionPunto) {
    const lng = parseFloat(e.lngLat.lng.toFixed(6));
    const lat = parseFloat(e.lngLat.lat.toFixed(6));
    abrirModalCrearPunto([lng, lat]);
    cancelarAccionEditor();
    return;
  }

  // 2. Modo de reubicar / mover punto existente
  if (puntoEnMovimientoId) {
    const lng = parseFloat(e.lngLat.lng.toFixed(6));
    const lat = parseFloat(e.lngLat.lat.toFixed(6));
    const punto = coleccionPuntos.find(p => String(p.id) === String(puntoEnMovimientoId));
    if (punto) {
      punto.coords = [lng, lat];
      sincronizarCapasDesdeColeccion();
      autoGuardarPuntosEnDisco();
      mostrarPopupPunto({
        properties: {
          id: punto.id,
          nombre: punto.nombre,
          categoria: punto.categoria,
          floor: punto.floor,
          altitude: punto.altitude,
          icono: punto.icono,
          detalle: punto.detalle
        },
        geometry: { coordinates: punto.coords }
      }, punto.coords);
    }
    cancelarAccionEditor();
    return;
  }

  // 3. Detección interactiva de clics en Pines 3D elevados en el espacio
  if (typeof buscarPunto3DEnClick === 'function') {
    const punto3D = buscarPunto3DEnClick(e.point);
    if (punto3D) {
      mostrarPopupPunto({
        properties: {
          id: punto3D.id,
          nombre: punto3D.nombre,
          categoria: punto3D.categoria,
          floor: punto3D.floor,
          altitude: punto3D.altitude,
          icono: punto3D.icono,
          detalle: punto3D.detalle
        },
        geometry: { coordinates: punto3D.coords }
      }, punto3D.coords);
      return;
    }
  }

  // Inspector de coordenadas normal
  const lng = e.lngLat.lng.toFixed(6);
  const lat = e.lngLat.lat.toFixed(6);
  ultimaCoordenada = [parseFloat(lng), parseFloat(lat)];
  if (coordsDisplay) coordsDisplay.textContent = `Punto Seleccionado: [${lng}, ${lat}]`;
});

if (copyCoordsBtn) {
  copyCoordsBtn.addEventListener('click', () => {
    const texto = `[${ultimaCoordenada[0]}, ${ultimaCoordenada[1]}]`;
    navigator.clipboard.writeText(texto).then(() => {
      const originalText = copyCoordsBtn.textContent;
      copyCoordsBtn.textContent = '¡Copiado!';
      copyCoordsBtn.style.background = '#86efac';
      setTimeout(() => {
        copyCoordsBtn.textContent = originalText;
        copyCoordsBtn.style.background = '';
      }, 1500);
    });
  });
}

// ==========================================
// GESTOR Y EDITOR DE PUNTOS ESPACIALES (PB Y MEZZANINA)
// ==========================================

function cargarPuntosIniciales() {
  let cargados = false;
  try {
    const local = localStorage.getItem(STORAGE_KEY_PUNTOS);
    if (local) {
      const arr = JSON.parse(local);
      if (Array.isArray(arr)) {
        coleccionPuntos = arr.map(p => {
          if (typeof p.altitude !== 'number') {
            const fNorm = (p.floor === 1 || p.floor === '1' || p.floor === 'PB' || p.floor === 'pb') ? 'PB' : 'Mezzanina';
            p.altitude = fNorm === 'Mezzanina' ? 3.6 : 0.8;
          }
          return p;
        });
        cargados = true;
        console.log(`✓ Cargados ${coleccionPuntos.length} puntos desde localStorage con elevación Z`);
      }
    }
  } catch (e) {
    console.warn('Error leyendo puntos de localStorage:', e);
  }

  if (!cargados) {
    coleccionPuntos = [];
    if (typeof puestosData !== 'undefined' && Array.isArray(puestosData.features)) {
      puestosData.features.forEach(f => {
        const fNorm = (f.properties.floor === 1 || f.properties.floor === 'PB') ? 'PB' : 'Mezzanina';
        coleccionPuntos.push({
          id: f.properties.id || Date.now() + Math.random(),
          nombre: f.properties.nombre || f.properties.label || 'Puesto',
          categoria: 'puesto',
          floor: fNorm,
          altitude: typeof f.properties.altitude === 'number' ? f.properties.altitude : (fNorm === 'Mezzanina' ? 3.6 : 0.8),
          icono: f.properties.icono || '💻',
          detalle: f.properties.cargo || f.properties.detalle || '',
          coords: f.geometry.coordinates.slice()
        });
      });
    }
    if (typeof zonasData !== 'undefined' && Array.isArray(zonasData.features)) {
      zonasData.features.forEach(f => {
        const fNorm = (f.properties.floor === 1 || f.properties.floor === 'PB') ? 'PB' : 'Mezzanina';
        coleccionPuntos.push({
          id: f.properties.id || Date.now() + Math.random(),
          nombre: f.properties.nombre || f.properties.label || 'Zona',
          categoria: 'zona',
          floor: fNorm,
          altitude: typeof f.properties.altitude === 'number' ? f.properties.altitude : (fNorm === 'Mezzanina' ? 3.6 : 0.8),
          icono: f.properties.icono || '🚪',
          detalle: f.properties.recursos || f.properties.capacidad || f.properties.detalle || '',
          coords: f.geometry.coordinates.slice()
        });
      });
    }
    if (typeof equipamientoData !== 'undefined' && Array.isArray(equipamientoData.features)) {
      equipamientoData.features.forEach(f => {
        const fNorm = (f.properties.floor === 1 || f.properties.floor === 'PB') ? 'PB' : 'Mezzanina';
        coleccionPuntos.push({
          id: f.properties.id || Date.now() + Math.random(),
          nombre: f.properties.nombre || f.properties.label || 'Equipo',
          categoria: 'equipo',
          floor: fNorm,
          altitude: typeof f.properties.altitude === 'number' ? f.properties.altitude : (fNorm === 'Mezzanina' ? 3.6 : 0.8),
          icono: f.properties.icono || '⚙️',
          detalle: f.properties.tipo || f.properties.detalle || '',
          coords: f.geometry.coordinates.slice()
        });
      });
    }
  }

  sincronizarCapasDesdeColeccion();
}

function sincronizarCapasDesdeColeccion() {
  const featuresPuestos = [];
  const featuresZonas = [];
  const featuresEquipos = [];
  const listaBusqueda = [];

  coleccionPuntos.forEach(p => {
    const floorNorm = (p.floor === 1 || p.floor === '1' || p.floor === 'PB' || p.floor === 'pb') ? 'PB' : 'Mezzanina';
    const floorNum = floorNorm === 'PB' ? 1 : 2;
    const altZ = typeof p.altitude === 'number' ? p.altitude : (floorNorm === 'Mezzanina' ? 3.6 : 0.8);

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
        detalle: p.detalle || ''
      }
    };

    if (p.categoria === 'puesto') {
      featuresPuestos.push(feature);
    } else if (p.categoria === 'zona') {
      featuresZonas.push(feature);
    } else {
      featuresEquipos.push(feature);
    }

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

  puestosData.features = featuresPuestos;
  zonasData.features = featuresZonas;
  equipamientoData.features = featuresEquipos;

  searchData.length = 0;
  listaBusqueda.forEach(item => searchData.push(item));

  if (map && map.getSource('puestos-source')) {
    map.getSource('puestos-source').setData(puestosData);
  }
  if (map && map.getSource('zonas-source')) {
    map.getSource('zonas-source').setData(zonasData);
  }
  if (map && map.getSource('equipos-source')) {
    map.getSource('equipos-source').setData(equipamientoData);
  }

  const contador = document.getElementById('contadorPuntos');
  if (contador) {
    contador.textContent = `${coleccionPuntos.length} punto${coleccionPuntos.length === 1 ? '' : 's'}`;
  }

  try {
    localStorage.setItem(STORAGE_KEY_PUNTOS, JSON.stringify(coleccionPuntos));
  } catch (e) {}

  if (typeof currentFloor !== 'undefined' && currentFloor !== 'all') {
    filtrarPorNivel(currentFloor);
  }

  // Sincronizar pines tridimensionales en Three.js con elevación Z
  if (typeof actualizarPuntos3D === 'function') {
    actualizarPuntos3D();
  }
}

function calcularAnchorLngLat3D(coords, altitude, floor) {
  if (!custom3DLayer || !custom3DLayer.camera) return coords;

  const originCoord = mapboxgl.MercatorCoordinate.fromLngLat(MURONTO_CENTER, 0);
  const meterUnits = originCoord.meterInMercatorCoordinateUnits();
  const ptCoord = mapboxgl.MercatorCoordinate.fromLngLat(coords, 0);
  const dx = (ptCoord.x - originCoord.x) / meterUnits;
  const dz = (ptCoord.y - originCoord.y) / meterUnits;
  const altZ = typeof altitude === 'number' ? altitude : (floor === 'Mezzanina' ? 3.6 : 0.8);

  const pos3D = new THREE.Vector3(dx, altZ, dz);
  pos3D.applyMatrix4(custom3DLayer.camera.projectionMatrix);

  if (pos3D.z >= -1 && pos3D.z <= 1) {
    const canvas = map.getCanvas();
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    const screenX = (pos3D.x + 1) * 0.5 * width;
    const screenY = (1 - pos3D.y) * 0.5 * height;
    return map.unproject([screenX, screenY]);
  }
  return coords;
}

function mostrarPopupPunto(feature, lngLat) {
  const prop = feature.properties;
  const coords = feature.geometry.coordinates.slice();
  const altNum = typeof prop.altitude === 'number' ? prop.altitude : (prop.floor === 'Mezzanina' ? 3.6 : 0.8);
  const altZ = altNum.toFixed(1);

  puntoSeleccionadoActivo = {
    id: prop.id,
    coords: coords,
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

  const subtituloHtml = usuarioRolActual === 'admin'
    ? `${catTexto} • Altura Z: <b style="color: #2563eb;">+${altZ} m</b>`
    : `${catTexto}`;

  popupActivo
    .setLngLat(anchor)
    .setHTML(`
      <div class="popup-title">${prop.icono || '📍'} ${prop.nombre}</div>
      <div class="popup-subtitle">${subtituloHtml}</div>
      ${prop.detalle ? `<div class="popup-detail">${prop.detalle}</div>` : ''}
      <div class="popup-badge ${badgeClass}">${prop.floor}</div>
      ${usuarioRolActual === 'admin' ? `
        <div style="display: flex; gap: 5px; margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          <button class="btn-popup-action" onclick="abrirEditorPunto(${prop.id})">✏️ Editar</button>
          <button class="btn-popup-action" onclick="iniciarMoverPunto(${prop.id})">📍 Mover</button>
          <button class="btn-popup-action btn-popup-danger" onclick="eliminarPunto(${prop.id})">🗑️ Borrar</button>
        </div>
      ` : `
        <div style="margin-top: 8px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 11px; color: #64748b; display: flex; align-items: center; justify-content: space-between;">
          <span>👁️ Modo visualización</span>
          <span style="font-size: 9px; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Solo Lectura</span>
        </div>
      `}
    `)
    .addTo(map);
}

function toggleModoInsercion() {
  if (usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede insertar nuevos puntos.');
    return;
  }

  if (puntoEnMovimientoId) {
    cancelarAccionEditor();
  }

  modoInsercionPunto = !modoInsercionPunto;
  const btn = document.getElementById('btnModoInsertar');
  const banner = document.getElementById('editorBanner');
  const bannerTexto = document.getElementById('editorBannerTexto');

  if (modoInsercionPunto) {
    map.getCanvas().style.cursor = 'crosshair';
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
    map.getCanvas().style.cursor = '';
    if (btn) {
      btn.style.background = '#10b981';
      btn.style.borderColor = '#059669';
      btn.textContent = '➕ Insertar Nuevo Punto';
    }
    if (banner) banner.style.display = 'none';
  }
}

function cancelarAccionEditor() {
  modoInsercionPunto = false;
  puntoEnMovimientoId = null;
  map.getCanvas().style.cursor = '';

  const btn = document.getElementById('btnModoInsertar');
  if (btn) {
    btn.style.background = '#10b981';
    btn.style.borderColor = '#059669';
    btn.textContent = '➕ Insertar Nuevo Punto';
  }

  const banner = document.getElementById('editorBanner');
  if (banner) banner.style.display = 'none';
}

function abrirModalCrearPunto(coords) {
  if (usuarioRolActual !== 'admin') return;

  document.getElementById('modalTitulo').textContent = '➕ Nuevo Punto Espacial';
  document.getElementById('puntoEditandoId').value = '';
  document.getElementById('puntoLng').value = coords[0];
  document.getElementById('puntoLat').value = coords[1];
  document.getElementById('puntoNombre').value = '';
  document.getElementById('puntoDetalle').value = '';
  const pisoDefecto = currentFloor === 'Mezzanina' ? 'Mezzanina' : 'PB';
  document.getElementById('puntoPiso').value = pisoDefecto;
  document.getElementById('puntoCategoria').value = 'puesto';
  document.getElementById('puntoIcono').value = '💻';
  document.getElementById('puntoCoordsTexto').textContent = `Long: ${coords[0]} | Lat: ${coords[1]}`;

  const altDefecto = pisoDefecto === 'Mezzanina' ? 3.6 : 0.8;
  fijarAlturaRapida(altDefecto);

  document.getElementById('puntoModal').style.display = 'flex';
  setTimeout(() => document.getElementById('puntoNombre').focus(), 100);
}

function abrirEditorPunto(id) {
  if (usuarioRolActual !== 'admin') return;

  if (popupActivo) popupActivo.remove();
  const punto = coleccionPuntos.find(p => String(p.id) === String(id));
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

  const alt = typeof punto.altitude === 'number' ? punto.altitude : (punto.floor === 'Mezzanina' ? 3.6 : 0.8);
  fijarAlturaRapida(alt);

  document.getElementById('puntoModal').style.display = 'flex';
  setTimeout(() => document.getElementById('puntoNombre').focus(), 100);
}

function cerrarModalPunto() {
  document.getElementById('puntoModal').style.display = 'none';
}

function seleccionarEmoji(emoji) {
  document.getElementById('puntoIcono').value = emoji;
}

function seleccionarCategoriaPorDefecto(cat) {
  const iconInput = document.getElementById('puntoIcono');
  if (cat === 'puesto') iconInput.value = '💻';
  else if (cat === 'zona') iconInput.value = '🚪';
  else if (cat === 'equipo') iconInput.value = '⚙️';
}

// ==========================================
// CONTROLADORES DE ELEVACIÓN EN EJE Z (ALTURA)
// ==========================================

function onCambiarPisoModal(piso) {
  const elevInput = document.getElementById('puntoElevacion');
  if (!elevInput) return;
  const valActual = parseFloat(elevInput.value) || 0;
  if (piso === 'Mezzanina' && valActual < 2.0) {
    fijarAlturaRapida(3.6);
  } else if (piso === 'PB' && valActual >= 3.0) {
    fijarAlturaRapida(0.8);
  }
}

function actualizarElevacionInput(val) {
  const num = parseFloat(val);
  const txt = (num >= 0 ? '+' : '') + num.toFixed(1) + ' m';
  const span = document.getElementById('valPuntoElevacion');
  const inp = document.getElementById('puntoElevacion');
  if (span) span.textContent = txt;
  if (inp) inp.value = num.toFixed(1);
  previsualizarElevacionPunto(num);
}

function actualizarElevacionSlider(val) {
  let num = parseFloat(val);
  if (isNaN(num)) num = 0;
  const span = document.getElementById('valPuntoElevacion');
  const slider = document.getElementById('sliderPuntoElevacion');
  if (span) span.textContent = (num >= 0 ? '+' : '') + num.toFixed(1) + ' m';
  if (slider) slider.value = Math.min(12, Math.max(-1, num));
  previsualizarElevacionPunto(num);
}

function fijarAlturaRapida(alt) {
  const num = parseFloat(alt);
  const span = document.getElementById('valPuntoElevacion');
  const slider = document.getElementById('sliderPuntoElevacion');
  const inp = document.getElementById('puntoElevacion');
  if (span) span.textContent = (num >= 0 ? '+' : '') + num.toFixed(1) + ' m';
  if (slider) slider.value = Math.min(12, Math.max(-1, num));
  if (inp) inp.value = num.toFixed(1);
  previsualizarElevacionPunto(num);
}

function previsualizarElevacionPunto(alt) {
  const editId = document.getElementById('puntoEditandoId').value;
  if (editId) {
    const p = coleccionPuntos.find(pt => String(pt.id) === String(editId));
    if (p) {
      p.altitude = alt;
      if (typeof actualizarPuntos3D === 'function') {
        actualizarPuntos3D();
      }
      if (puntoSeleccionadoActivo && String(puntoSeleccionadoActivo.id) === String(editId)) {
        puntoSeleccionadoActivo.altitude = alt;
        if (popupActivo && popupActivo.isOpen()) {
          popupActivo.setLngLat(calcularAnchorLngLat3D(p.coords, alt, p.floor));
        }
      }
    }
  }
}

function guardarPuntoModal() {
  if (usuarioRolActual !== 'admin') {
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

  const elevacion = parseFloat(document.getElementById('puntoElevacion').value);
  const altitude = isNaN(elevacion) ? (floor === 'Mezzanina' ? 3.6 : 0.8) : Math.round(elevacion * 10) / 10;

  if (editId) {
    const punto = coleccionPuntos.find(p => String(p.id) === String(editId));
    if (punto) {
      punto.nombre = nombre;
      punto.floor = floor;
      punto.categoria = categoria;
      punto.altitude = altitude;
      punto.icono = icono;
      punto.detalle = detalle;
    }
  } else {
    const nuevoPunto = {
      id: Date.now(),
      nombre,
      categoria,
      floor,
      altitude,
      icono,
      detalle,
      coords: [lng, lat]
    };
    coleccionPuntos.push(nuevoPunto);
  }

  sincronizarCapasDesdeColeccion();
  cerrarModalPunto();
  autoGuardarPuntosEnDisco();
}

function iniciarMoverPunto(id) {
  if (usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede reubicar puntos.');
    return;
  }
  if (popupActivo) popupActivo.remove();
  const punto = coleccionPuntos.find(p => String(p.id) === String(id));
  if (!punto) return;

  puntoEnMovimientoId = id;
  modoInsercionPunto = false;

  map.getCanvas().style.cursor = 'crosshair';
  const banner = document.getElementById('editorBanner');
  const bannerTexto = document.getElementById('editorBannerTexto');
  if (banner && bannerTexto) {
    bannerTexto.textContent = `📍 Haz clic en la nueva ubicación para "${punto.nombre}"`;
    banner.style.display = 'flex';
  }
}

function eliminarPunto(id) {
  if (usuarioRolActual !== 'admin') {
    alert('Acceso restringido: Solo el usuario Administrador puede eliminar puntos.');
    return;
  }
  if (popupActivo) popupActivo.remove();
  const punto = coleccionPuntos.find(p => String(p.id) === String(id));
  if (!punto) return;

  if (confirm(`¿Estás seguro de eliminar el punto "${punto.nombre}"?`)) {
    coleccionPuntos = coleccionPuntos.filter(p => String(p.id) !== String(id));
    sincronizarCapasDesdeColeccion();
    autoGuardarPuntosEnDisco();
  }
}

function generarCodigoOfficeData() {
  const puestos = coleccionPuntos.filter(p => p.categoria === 'puesto');
  const zonas = coleccionPuntos.filter(p => p.categoria === 'zona');
  const equipos = coleccionPuntos.filter(p => p.categoria === 'equipo');

  const formatoFeature = (p) => `    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [${p.coords[0]}, ${p.coords[1]}] },
      properties: {
        id: ${p.id},
        nombre: ${JSON.stringify(p.nombre)},
        categoria: ${JSON.stringify(p.categoria)},
        floor: ${JSON.stringify(p.floor)},
        altitude: ${typeof p.altitude === 'number' ? p.altitude : (p.floor === 'Mezzanina' ? 3.6 : 0.8)},
        icono: ${JSON.stringify(p.icono || '📍')},
        detalle: ${JSON.stringify(p.detalle || '')}
      }
    }`;

  return `// ==========================================
// DATOS ESPACIALES DE INTERIOR - CIDE-MÜRÖNTÖ
// Coordenada Central Sede: [-66.871326, 10.453025]
// Niveles Arquitectónicos: PB (Planta Baja) y Mezzanina
// ==========================================

// 1. PUESTOS DE TRABAJO
const puestosData = {
  type: 'FeatureCollection',
  features: [
${puestos.map(formatoFeature).join(',\n')}
  ]
};

// 2. SALAS Y ZONAS COMUNES
const zonasData = {
  type: 'FeatureCollection',
  features: [
${zonas.map(formatoFeature).join(',\n')}
  ]
};

// 3. EQUIPAMIENTO Y SERVICIOS
const equipamientoData = {
  type: 'FeatureCollection',
  features: [
${equipos.map(formatoFeature).join(',\n')}
  ]
};

// 4. ÍNDICE DE BÚSQUEDA Y AUTOCOMPLETADO
const searchData = ${JSON.stringify(searchData, null, 2)};
`;
}

function copiarPuntosCodigo() {
  const jsContent = generarCodigoOfficeData();
  navigator.clipboard.writeText(jsContent).then(() => {
    alert('✓ ¡Código copiado al portapapeles!\n\nPégalo en el chat de Antigravity o reemplaza el contenido de public/office_data.js para guardarlo de por vida.');
  }).catch(() => {
    prompt('Copia manualmente este código:', jsContent);
  });
}

function descargarOfficeDataJs() {
  const jsContent = generarCodigoOfficeData();
  const dataStr = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(jsContent);
  const a = document.createElement('a');
  a.setAttribute('href', dataStr);
  a.setAttribute('download', 'office_data.js');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function autoGuardarPuntosEnDisco() {
  // Sincronizar automáticamente en la Nube (Google Cloud Firestore) para todos los usuarios
  await guardarPuntosEnNube();
}

// ==========================================
// SINCRONIZACIÓN EN LA NUBE (FIREBASE FIRESTORE)
// ==========================================
async function guardarPuntosEnNube() {
  if (!db || !firebaseHabilitado) return;
  try {
    await db.collection('edificio').doc('puntos').set({
      lista: coleccionPuntos,
      actualizadoEn: new Date().toISOString()
    });
    console.log(`✓ Sincronización en la Nube: ${coleccionPuntos.length} puntos guardados en Firestore.`);
  } catch (err) {
    console.warn('Aviso al guardar puntos en Firestore (verifica que iniciaste Firestore en modo prueba):', err);
  }
}

function iniciarSincronizacionPuntosNube() {
  if (!db || !firebaseHabilitado) return;

  db.collection('edificio').doc('puntos').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      if (Array.isArray(data.lista)) {
        // Evitar sobrescribir si el usuario está activamente en medio de crear/editar en el modal
        const editandoModal = document.getElementById('puntoModal') && document.getElementById('puntoModal').style.display !== 'none';
        if (!modoInsercionPunto && !puntoEnMovimientoId && !editandoModal) {
          coleccionPuntos = data.lista.map(p => {
            if (typeof p.altitude !== 'number') {
              const fNorm = (p.floor === 1 || p.floor === '1' || p.floor === 'PB' || p.floor === 'pb') ? 'PB' : 'Mezzanina';
              p.altitude = fNorm === 'Mezzanina' ? 3.6 : 0.8;
            }
            return p;
          });
          sincronizarCapasDesdeColeccion();
          console.log(`✓ Sincronización en vivo: ${coleccionPuntos.length} puntos cargados desde la nube (Firestore)`);
        }
      }
    } else {
      // Si la base de datos está vacía y hay puntos locales disponibles, inicializar Firestore
      if (coleccionPuntos.length > 0 && usuarioRolActual === 'admin') {
        guardarPuntosEnNube();
      }
    }
  }, (err) => {
    console.warn('Error en listener de puntos en Firestore:', err);
  });
}

function iniciarSincronizacionCalibracionNube() {
  if (!db || !firebaseHabilitado) return;

  db.collection('edificio').doc('calibracion').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      if (data.exterior || data.interior) {
        if (data.exterior) Object.assign(calibExterior, data.exterior);
        if (data.interior) Object.assign(calibInterior, data.interior);
        actualizarTransformacion();
        if (typeof sincronizarSlidersUI === 'function') {
          sincronizarSlidersUI();
        }
        if (map) map.triggerRepaint();
        console.log('✓ Calibración 3D sincronizada en vivo desde la nube (Firestore)');
      }
    }
  }, (err) => {
    console.warn('Error en listener de calibración en Firestore:', err);
  });
}

// ==========================================
// RENDERIZADO DE PUNTOS ESPACIALES 3D CON ELEVACIÓN Z (THREE.JS)
// ==========================================

function crearMarkerPunto3D(emoji, categoria) {
  const container = new THREE.Group();

  // 1. Esfera central 3D volumétrica (Garantiza visibilidad sólida en 360° desde cualquier ángulo)
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

  // 2. Disco circular con textura de alta definición y doble cara (Visible frente, lados y detrás)
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const cx = 128;
  const cy = 122;
  const radius = 94;

  // Sombra exterior
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;

  // Fondo gradiente vivo según categoría
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

  // Borde blanco de alto contraste
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Anillo interior de bisel
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 10, 0, Math.PI * 2);
  ctx.stroke();

  // Icono Emoji centrado
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

  // Plano 2D doble cara orientado
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const planeMat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide, // Se ve siempre por el frente y por detrás sin desaparecer
    depthTest: false,
    transparent: true
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.renderOrder = 9999;
  container.add(plane);

  return container;
}

// Escala adaptativa calibrada:
// Mantiene el tamaño proporcional (entre 18px y 26px en pantalla) sin sobrecargar el espacio visual
function actualizarEscalaDinamicaPuntos() {
  if (!grupoPuntos3D || grupoPuntos3D.children.length === 0 || !map) return;

  const zoom = map.getZoom();
  const metersPerPixel = 153948 / Math.pow(2, zoom);

  // Tamaño visual reducido y equilibrado (~18px a 26px)
  const targetPixels = Math.min(26, Math.max(18, 18 + (zoom - 18) * 1.8));
  const meterScale = Math.max(0.65, Math.min(16.0, targetPixels * metersPerPixel));

  grupoPuntos3D.children.forEach(group => {
    group.scale.set(meterScale, meterScale, meterScale);
  });
}

// Orientación continua hacia la cámara de Mapbox (360°):
// Gira activamente cada marcador según el bearing y pitch de la vista para que jamás desaparezca por los lados
function actualizarOrientacionCamaraPuntos() {
  if (!grupoPuntos3D || grupoPuntos3D.children.length === 0 || !map) return;

  const bearingRad = (map.getBearing() * Math.PI) / 180;
  const pitchRad = (map.getPitch() * Math.PI) / 180;

  grupoPuntos3D.children.forEach(group => {
    group.rotation.order = 'YXZ';
    group.rotation.y = -bearingRad;
    group.rotation.x = pitchRad - Math.PI / 2;
  });
}

function actualizarPuntos3D() {
  if (!grupoPuntos3D) return;

  // Limpiar grupo anterior liberando recursos
  while (grupoPuntos3D.children.length > 0) {
    const obj = grupoPuntos3D.children[0];
    grupoPuntos3D.remove(obj);
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }

  const puestosVisibles = document.getElementById('toggle-puestos') ? document.getElementById('toggle-puestos').checked : true;
  const zonasVisibles = (document.getElementById('toggle-salas') || document.getElementById('toggle-zonas')) ? (document.getElementById('toggle-salas') || document.getElementById('toggle-zonas')).checked : true;
  const equiposVisibles = document.getElementById('toggle-equipos') ? document.getElementById('toggle-equipos').checked : true;

  const originCoord = mapboxgl.MercatorCoordinate.fromLngLat(MURONTO_CENTER, 0);
  const meterUnits = originCoord.meterInMercatorCoordinateUnits();

  coleccionPuntos.forEach(p => {
    const floorNorm = (p.floor === 1 || p.floor === '1' || p.floor === 'PB' || p.floor === 'pb') ? 'PB' : 'Mezzanina';

    // Filtrar por piso actual
    if (typeof currentFloor !== 'undefined' && currentFloor !== 'all' && currentFloor !== floorNorm) {
      return;
    }

    // Filtrar por capa
    if (p.categoria === 'puesto' && !puestosVisibles) return;
    if (p.categoria === 'zona' && !zonasVisibles) return;
    if (p.categoria === 'equipo' && !equiposVisibles) return;

    const ptCoord = mapboxgl.MercatorCoordinate.fromLngLat([p.coords[0], p.coords[1]], 0);
    const dx = (ptCoord.x - originCoord.x) / meterUnits;
    const dz = (ptCoord.y - originCoord.y) / meterUnits;
    const altZ = typeof p.altitude === 'number' ? p.altitude : (floorNorm === 'Mezzanina' ? 3.6 : 0.8);

    const puntoObj = new THREE.Group();
    puntoObj.position.set(dx, altZ, dz);
    puntoObj.userData = {
      puntoId: p.id,
      puntoData: p,
      coords: p.coords,
      altitude: altZ
    };

    // Crear marcador 3D visible en 360°
    const markerVisual = crearMarkerPunto3D(p.icono || '📍', p.categoria);
    puntoObj.add(markerVisual);

    grupoPuntos3D.add(puntoObj);
  });

  actualizarEscalaDinamicaPuntos();
  actualizarOrientacionCamaraPuntos();
  if (map) map.triggerRepaint();
}

function buscarPunto3DEnClick(pixel) {
  if (!grupoPuntos3D || !custom3DLayer || !custom3DLayer.camera || grupoPuntos3D.children.length === 0) {
    return null;
  }

  const canvas = map.getCanvas();
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;

  let mejorPunto = null;
  let menorDist = 26; // Tolerancia de clic adaptada al nuevo tamaño

  grupoPuntos3D.children.forEach(group => {
    const p = group.userData.puntoData;
    if (!p) return;

    const worldPos = new THREE.Vector3();
    group.getWorldPosition(worldPos);

    worldPos.applyMatrix4(custom3DLayer.camera.projectionMatrix);

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

// Exportar funciones globalmente para interacción con botones y modales
window.onCambiarPisoModal = onCambiarPisoModal;
window.actualizarElevacionInput = actualizarElevacionInput;
window.actualizarElevacionSlider = actualizarElevacionSlider;
window.fijarAlturaRapida = fijarAlturaRapida;
window.previsualizarElevacionPunto = previsualizarElevacionPunto;
window.abrirEditorPunto = abrirEditorPunto;
window.iniciarMoverPunto = iniciarMoverPunto;
window.eliminarPunto = eliminarPunto;
window.toggleModoInsercion = toggleModoInsercion;
window.cerrarModalPunto = cerrarModalPunto;
window.seleccionarEmoji = seleccionarEmoji;
window.seleccionarCategoriaPorDefecto = seleccionarCategoriaPorDefecto;
window.guardarPuntoModal = guardarPuntoModal;
window.copiarPuntosCodigo = copiarPuntosCodigo;
window.descargarOfficeDataJs = descargarOfficeDataJs;
window.filtrarPorNivel = filtrarPorNivel;
window.toggleCapa = toggleCapa;
window.actualizarPuntos3D = actualizarPuntos3D;
window.actualizarEscalaDinamicaPuntos = actualizarEscalaDinamicaPuntos;
window.actualizarOrientacionCamaraPuntos = actualizarOrientacionCamaraPuntos;

// Exportar funciones de calibración y posición de estructuras 3D (Exclusivo Administrador)
window.seleccionarModeloCalibrar = seleccionarModeloCalibrar;
window.cambiarModeloCalibracion = seleccionarModeloCalibrar;
window.copiarPosicionExteriorAInterior = copiarPosicionExteriorAInterior;
window.ajustarRotacion = ajustarRotacion;
window.ajustarInclinacion = ajustarInclinacion;
window.ajustarOffsetX = ajustarOffsetX;
window.ajustarOffsetY = ajustarOffsetY;
window.ajustarEscala = ajustarEscala;
window.ajustarElevacion = ajustarElevacion;
window.guardarCalibracion = guardarCalibracion;
window.restablecerCalibracion = restablecerCalibracion;
window.copiarCalibracionParaChat = copiarCalibracionParaChat;
window.descargarCalibracionJson = descargarCalibracionJson;
window.sincronizarSlidersUI = sincronizarSlidersUI;
window.guardarPuntosEnNube = guardarPuntosEnNube;

// ==========================================
// SISTEMA DE USUARIOS Y ROLES (ADMIN / VISITANTE)
// ==========================================
function inicializarSistemaUsuarios() {
  try {
    const rolGuardado = sessionStorage.getItem(STORAGE_KEY_ROL);
    if (rolGuardado === 'admin' || rolGuardado === 'visitante') {
      aplicarRolUsuario(rolGuardado);
      cerrarVentanaLogin();
    } else {
      mostrarVentanaLogin();
    }
  } catch (e) {
    mostrarVentanaLogin();
  }
}

function mostrarVentanaLogin() {
  if (window.innerWidth <= 768) {
    togglePanelMovil(false);
  }
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    const pwd = document.getElementById('adminPasswordInput');
    if (pwd) {
      pwd.value = '';
      setTimeout(() => pwd.focus(), 150);
    }
    const err = document.getElementById('adminLoginError');
    if (err) err.style.display = 'none';
  }
}

function cerrarVentanaLogin() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
  // En pantallas móviles, asegurar que el panel inicie cerrado para mostrar el edificio 3D en pantalla completa
  if (window.innerWidth <= 768) {
    togglePanelMovil(false);
  }
}

function iniciarSesionVisitante() {
  usuarioRolActual = 'visitante';
  try {
    sessionStorage.setItem(STORAGE_KEY_ROL, 'visitante');
  } catch (e) {}
  aplicarRolUsuario('visitante');
  cerrarVentanaLogin();
}

function intentarLoginAdmin() {
  const input = document.getElementById('adminPasswordInput');
  const err = document.getElementById('adminLoginError');
  const clave = input ? input.value.trim() : '';

  if (clave === ADMIN_PASSWORD_CORRECTA) {
    if (err) err.style.display = 'none';
    usuarioRolActual = 'admin';
    try {
      sessionStorage.setItem(STORAGE_KEY_ROL, 'admin');
    } catch (e) {}
    aplicarRolUsuario('admin');
    cerrarVentanaLogin();
  } else {
    if (err) {
      err.style.display = 'block';
      err.textContent = '⚠️ Contraseña incorrecta. Intenta nuevamente.';
    }
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function cerrarSesionUsuario() {
  usuarioRolActual = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY_ROL);
  } catch (e) {}
  cancelarAccionEditor();
  if (popupActivo) popupActivo.remove();
  mostrarVentanaLogin();
}

function aplicarRolUsuario(rol) {
  usuarioRolActual = rol;
  const roleText = document.getElementById('roleInfoText');
  const seccionAdmin = document.getElementById('seccionEditorAdmin');
  const seccionCalib = document.getElementById('seccionCalibracionAdmin');
  const lblFachada = document.getElementById('labelFachadaExterior');
  const lblInterior = document.getElementById('labelModeloInterior');

  if (rol === 'admin') {
    if (roleText) {
      roleText.innerHTML = '<span style="color: #059669; font-weight: 700;">👑 Administrador</span> <span style="font-size: 9px; background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 4px; font-weight: 700;">Edición Total</span>';
    }
    if (seccionAdmin) {
      seccionAdmin.style.display = 'block';
    }
    if (seccionCalib) {
      seccionCalib.style.display = 'block';
    }
    if (lblFachada) lblFachada.textContent = '🏛️ Fachada Exterior (edificioM-v1)';
    if (lblInterior) lblInterior.textContent = '🚪 Estructura Interior (medidasmetros-v2)';
    if (typeof sincronizarSlidersUI === 'function') {
      sincronizarSlidersUI();
    }
  } else {
    if (roleText) {
      roleText.innerHTML = '<span style="color: #2563eb; font-weight: 700;">👤 Visitante</span> <span style="font-size: 9px; background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: 700;">Solo Lectura</span>';
    }
    if (seccionAdmin) {
      seccionAdmin.style.display = 'none';
    }
    if (seccionCalib) {
      seccionCalib.style.display = 'none';
    }
    if (lblFachada) lblFachada.textContent = '🏛️ Fachada Exterior';
    if (lblInterior) lblInterior.textContent = '🚪 Estructura Interior';
    cancelarAccionEditor();
  }

  // Si hay un popup abierto en pantalla, actualizarlo para reflejar los nuevos permisos
  if (popupActivo && popupActivo.isOpen() && puntoSeleccionadoActivo) {
    const p = coleccionPuntos.find(pt => pt.id === puntoSeleccionadoActivo.id);
    if (p) {
      mostrarPopupPunto({
        properties: {
          id: p.id,
          nombre: p.nombre,
          categoria: p.categoria,
          floor: p.floor,
          altitude: p.altitude,
          icono: p.icono,
          detalle: p.detalle
        },
        geometry: { coordinates: p.coords }
      }, p.coords);
    }
  }
}

// Ejecutar inmediatamente al cargar el DOM para que el modal aparezca de inmediato
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarSistemaUsuarios);
} else {
  inicializarSistemaUsuarios();
}

// Exportar funciones del sistema de usuarios y estilos globalmente
window.iniciarSesionVisitante = iniciarSesionVisitante;
window.intentarLoginAdmin = intentarLoginAdmin;
window.cerrarSesionUsuario = cerrarSesionUsuario;
window.aplicarRolUsuario = aplicarRolUsuario;
window.mostrarVentanaLogin = mostrarVentanaLogin;
window.cerrarVentanaLogin = cerrarVentanaLogin;
window.cambiarEstiloMapa = cambiarEstiloMapa;
window.toggleColapsoEstilos = toggleColapsoEstilos;
window.togglePanelMovil = togglePanelMovil;
window.autoCerrarPanelEnMovil = autoCerrarPanelEnMovil;
