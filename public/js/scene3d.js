// ==========================================
// ESCENA 3D MAPBOX + THREE.JS (FACHADA E INTERIOR)
// ==========================================
import { MAPBOX_ACCESS_TOKEN, MURONTO_CENTER } from './config.js';
import { state } from './state.js';
import {
  actualizarTransformacion,
  actualizarTransparenciaPorZoom,
  cargarCalibracionGuardada,
  iniciarSincronizacionCalibracionNube
} from './calibracion.js';
import {
  abrirModalCrearPunto,
  actualizarEscalaDinamicaPuntos,
  actualizarOrientacionCamaraPuntos,
  buscarPunto3DEnClick,
  calcularAnchorLngLat3D,
  cancelarAccionEditor,
  cargarPuntosIniciales,
  construirFeatureDesdePunto,
  guardarPuntosEnNube,
  iniciarSincronizacionPuntosNube,
  mostrarPopupPunto,
  reconstruirIndiceBusqueda,
  sincronizarCapasDesdeColeccion
} from './puntos3d.js';
import {
  agregarVerticeEspacio,
  cargarEspaciosIniciales,
  finalizarPoligonoEspacio,
  inicializarCapasEspacios,
  iniciarSincronizacionEspaciosNube,
  mostrarPopupEspacio
} from './espacios.js';
import { inicializarSistemaUsuarios } from './auth.js';
import { actualizarTextoCoordenadas, cargarEstiloMapaGuardado } from './ui.js';

export const custom3DLayer = {
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

    state.rootModelGroup = new THREE.Group();
    this.scene.add(state.rootModelGroup);

    state.grupoExterior = new THREE.Group();
    state.grupoExterior.rotation.order = 'YXZ';
    state.rootModelGroup.add(state.grupoExterior);

    state.grupoInterior = new THREE.Group();
    state.grupoInterior.rotation.order = 'YXZ';
    state.rootModelGroup.add(state.grupoInterior);

    state.grupoPuntos3D = new THREE.Group();
    state.rootModelGroup.add(state.grupoPuntos3D);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight1.position.set(60, -90, 120).normalize();
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.45);
    dirLight2.position.set(-60, 90, 80).normalize();
    this.scene.add(dirLight2);

    const interiorLight = new THREE.PointLight(0xffffff, 0.7, 50);
    interiorLight.position.set(0, 5, 0);
    this.scene.add(interiorLight);

    const loader = new THREE.GLTFLoader();
    loader.load(
      'models/edificioM-v1.glb',
      (gltf) => {
        state.gltfModelScene = gltf.scene;

        const bbox = new THREE.Box3().setFromObject(state.gltfModelScene);
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());

        state.gltfModelScene.position.set(-center.x, -bbox.min.y, -center.z);
        state.grupoExterior.add(state.gltfModelScene);

        state.exteriorMeshes = [];
        state.gltfModelScene.traverse((child) => {
          if (child.isMesh) {
            if (Array.isArray(child.material)) {
              child.material = child.material.map(m => m.clone());
              child.material.forEach(m => { m.transparent = true; m.needsUpdate = true; });
            } else if (child.material) {
              child.material = child.material.clone();
              child.material.transparent = true;
              child.material.needsUpdate = true;
            }
            state.exteriorMeshes.push(child);
          }
        });

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

    const loaderInterior = new THREE.GLTFLoader();
    loaderInterior.load(
      'models/medidasmetros-v2.glb',
      (gltfInt) => {
        state.gltfInteriorScene = gltfInt.scene;

        const bboxInt = new THREE.Box3().setFromObject(state.gltfInteriorScene);
        const centerInt = bboxInt.getCenter(new THREE.Vector3());
        const sizeInt = bboxInt.getSize(new THREE.Vector3());

        state.gltfInteriorScene.position.set(-centerInt.x, -bboxInt.min.y, -centerInt.z);

        state.gltfInteriorScene.traverse((child) => {
          if (child.isMesh) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => { m.side = THREE.DoubleSide; });
            } else if (child.material) {
              child.material.side = THREE.DoubleSide;
            }
          }
        });

        state.grupoInterior.add(state.gltfInteriorScene);
        console.log('✓ Estructura interior medidasmetros-v2.glb cargada exitosamente:', sizeInt);
        actualizarTransformacion();
        this.map.triggerRepaint();
      },
      undefined,
      () => {
        console.info('Aviso: Coloca tu archivo en public/models/medidasmetros-v2.glb para ver el interior.');
      }
    );
  },
  render: function (gl, matrix) {
    if (!this.scene || !this.camera || !state.modeloRealVisible) return;

    if (state.grupoExterior) state.grupoExterior.visible = state.fachadaExteriorVisible;
    if (state.grupoInterior) state.grupoInterior.visible = state.modeloInteriorVisible;

    actualizarTransformacion();

    const rotationX = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(1, 0, 0),
      state.modelTransform.rotateX
    );
    const rotationY = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 1, 0),
      state.modelTransform.rotateY
    );
    const rotationZ = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 0, 1),
      state.modelTransform.rotateZ
    );

    const m = new THREE.Matrix4().fromArray(matrix);
    const l = new THREE.Matrix4()
      .makeTranslation(
        state.modelTransform.translateX,
        state.modelTransform.translateY,
        state.modelTransform.translateZ
      )
      .scale(
        new THREE.Vector3(
          state.modelTransform.scale,
          -state.modelTransform.scale,
          state.modelTransform.scale
        )
      )
      .multiply(rotationX)
      .multiply(rotationY)
      .multiply(rotationZ);

    actualizarEscalaDinamicaPuntos();
    actualizarOrientacionCamaraPuntos();

    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }
};

function asegurarCapaOcultaGeoJSON(map, sourceId, layerId, dataObj) {
  if (map.getSource(sourceId) || !dataObj) return;
  map.addSource(sourceId, { type: 'geojson', data: dataObj });
  map.addLayer({
    id: layerId,
    type: 'circle',
    source: sourceId,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 0,
      'circle-opacity': 0,
      'circle-stroke-width': 0,
      'circle-stroke-opacity': 0
    }
  });
}

export function reconfigurarFuentesYCapasGeoJSON() {
  if (!state.map) return;
  if (typeof puestosData !== 'undefined') asegurarCapaOcultaGeoJSON(state.map, 'puestos-source', 'capa-puestos', puestosData);
  if (typeof zonasData !== 'undefined') asegurarCapaOcultaGeoJSON(state.map, 'zonas-source', 'capa-zonas', zonasData);
  if (typeof equipamientoData !== 'undefined') asegurarCapaOcultaGeoJSON(state.map, 'equipos-source', 'capa-equipos', equipamientoData);
  inicializarCapasEspacios();
}

/** Inicializa el mapa Mapbox, capas Three.js, eventos de interacción y sincronización. */
export function inicializarMapa() {
  mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

  const map = new mapboxgl.Map({
    container: 'map',
    style: state.estiloMapaActual,
    center: MURONTO_CENTER,
    zoom: 19.2,
    pitch: 55,
    bearing: -15,
    antialias: true
  });

  state.map = map;
  state.custom3DLayer = custom3DLayer;
  state.reconfigurarCapasGeoJSON = reconfigurarFuentesYCapasGeoJSON;

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new mapboxgl.FullscreenControl(), 'top-right');
  map.addControl(new mapboxgl.ScaleControl(), 'bottom-right');

  state.popupActivo = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 20 });
  state.popupActivo.on('close', () => {
    state.puntoSeleccionadoActivo = null;
  });

  actualizarTransformacion();

  map.on('load', () => {
    cargarCalibracionGuardada();
    map.addLayer(custom3DLayer);
    reconfigurarFuentesYCapasGeoJSON();
    cargarPuntosIniciales();
    cargarEspaciosIniciales(reconstruirIndiceBusqueda);
    inicializarSistemaUsuarios();
    iniciarSincronizacionPuntosNube();
    iniciarSincronizacionEspaciosNube(reconstruirIndiceBusqueda);
    iniciarSincronizacionCalibracionNube();
    cargarEstiloMapaGuardado();

    if (window.innerWidth <= 768) {
      const panelEstilos = document.getElementById('map-styles-panel');
      if (panelEstilos) {
        panelEstilos.classList.add('collapsed');
        const btn = document.getElementById('btnColapsarEstilos');
        if (btn) btn.textContent = '▼';
      }
    }

    ['capa-puestos', 'capa-zonas', 'capa-equipos'].forEach(layerId => {
      map.on('click', layerId, (e) => {
        if (state.modoInsercionPunto || state.puntoEnMovimientoId) return;
        e.originalEvent.stopPropagation();
        mostrarPopupPunto(e.features[0], e.lngLat);
      });
    });

    map.on('zoom', actualizarTransparenciaPorZoom);
    map.on('move', () => {
      actualizarTransparenciaPorZoom();
      if (state.popupActivo && state.popupActivo.isOpen() && state.puntoSeleccionadoActivo) {
        const nuevoAnchor = calcularAnchorLngLat3D(
          state.puntoSeleccionadoActivo.coords,
          state.puntoSeleccionadoActivo.altitude,
          state.puntoSeleccionadoActivo.floor
        );
        state.popupActivo.setLngLat(nuevoAnchor);
      }
    });
  });

  map.on('mousemove', (e) => {
    actualizarTextoCoordenadas(e.lngLat, 'Longitud');
    if (!state.modoInsercionPunto && !state.puntoEnMovimientoId && !state.modoDibujoEspacio) {
      const p3d = buscarPunto3DEnClick(e.point);
      const sobreEspacio = map.getLayer('capa-espacios-extrusion')
        ? map.queryRenderedFeatures(e.point, { layers: ['capa-espacios-extrusion'] }).length > 0
        : false;
      map.getCanvas().style.cursor = (p3d || sobreEspacio) ? 'pointer' : '';
    }
  });

  map.on('dblclick', (e) => {
    if (state.modoDibujoEspacio && state.verticesDibujoEspacio.length >= 3) {
      e.preventDefault();
      finalizarPoligonoEspacio();
    }
  });

  map.on('click', (e) => {
    if (state.modoDibujoEspacio) {
      agregarVerticeEspacio(e.lngLat);
      return;
    }

    if (state.modoInsercionPunto) {
      const lng = parseFloat(e.lngLat.lng.toFixed(6));
      const lat = parseFloat(e.lngLat.lat.toFixed(6));
      abrirModalCrearPunto([lng, lat]);
      cancelarAccionEditor();
      return;
    }

    if (state.puntoEnMovimientoId) {
      const lng = parseFloat(e.lngLat.lng.toFixed(6));
      const lat = parseFloat(e.lngLat.lat.toFixed(6));
      const punto = state.coleccionPuntos.find(p => String(p.id) === String(state.puntoEnMovimientoId));
      if (punto) {
        punto.coords = [lng, lat];
        sincronizarCapasDesdeColeccion();
        guardarPuntosEnNube();
        mostrarPopupPunto(construirFeatureDesdePunto(punto), punto.coords);
      }
      cancelarAccionEditor();
      return;
    }

    const punto3D = buscarPunto3DEnClick(e.point);
    if (punto3D) {
      mostrarPopupPunto(construirFeatureDesdePunto(punto3D), punto3D.coords);
      return;
    }

    if (map.getLayer('capa-espacios-extrusion')) {
      const feats = map.queryRenderedFeatures(e.point, { layers: ['capa-espacios-extrusion'] });
      if (feats.length > 0) {
        const espId = feats[0].properties && feats[0].properties.id;
        const espacio = state.coleccionEspacios.find(es => String(es.id) === String(espId));
        if (espacio) {
          mostrarPopupEspacio(espacio, e.lngLat);
          return;
        }
      }
    }

    actualizarTextoCoordenadas(e.lngLat, 'Punto Seleccionado');
  });
}
