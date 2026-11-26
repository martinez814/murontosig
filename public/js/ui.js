// ==========================================
// CONTROLES DE INTERFAZ, BUSCADOR, ESTILOS Y CÁMARAS
// ==========================================
import { MURONTO_CENTER, STORAGE_KEYS } from './config.js';
import { state } from './state.js';
import { actualizarTransformacion, actualizarTransparenciaPorZoom } from './calibracion.js';
import {
  actualizarPuntos3D,
  construirFeatureDesdePunto,
  mostrarPopupPunto,
  reconstruirIndiceBusqueda,
  sincronizarCapasDesdeColeccion
} from './puntos3d.js';
import {
  aplicarVisibilidadYFiltroEspacios,
  mostrarPopupEspacio,
  sincronizarEspaciosEnMapa
} from './espacios.js';

let ultimaCoordenada = MURONTO_CENTER;

// ==========================================
// FILTRADO POR NIVELES / PISOS Y CAPAS
// ==========================================
export function filtrarPorNivel(piso) {
  state.currentFloor = piso;
  autoCerrarPanelEnMovil();

  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-level') === String(piso));
  });

  if (state.map) {
    if (piso === 'all') {
      state.map.setFilter('capa-puestos', null);
      state.map.setFilter('capa-zonas', null);
      state.map.setFilter('capa-equipos', null);
    } else if (piso === 'PB' || piso === 1 || piso === '1') {
      const filterCond = ['any',
        ['==', ['get', 'floor'], 'PB'],
        ['==', ['get', 'floor'], 1],
        ['==', ['get', 'pisoNum'], 1]
      ];
      state.map.setFilter('capa-puestos', filterCond);
      state.map.setFilter('capa-zonas', filterCond);
      state.map.setFilter('capa-equipos', filterCond);
    } else if (piso === 'Mezzanina' || piso === 2 || piso === '2') {
      const filterCond = ['any',
        ['==', ['get', 'floor'], 'Mezzanina'],
        ['==', ['get', 'floor'], 2],
        ['==', ['get', 'pisoNum'], 2]
      ];
      state.map.setFilter('capa-puestos', filterCond);
      state.map.setFilter('capa-zonas', filterCond);
      state.map.setFilter('capa-equipos', filterCond);
    } else {
      state.map.setFilter('capa-puestos', ['==', ['get', 'floor'], piso]);
      state.map.setFilter('capa-zonas', ['==', ['get', 'floor'], piso]);
      state.map.setFilter('capa-equipos', ['==', ['get', 'floor'], piso]);
    }

    ['capa-puestos', 'capa-zonas', 'capa-equipos'].forEach(lid => {
      if (state.map.getLayer(lid)) {
        state.map.setLayoutProperty(lid, 'visibility', 'none');
      }
    });
  }

  aplicarVisibilidadYFiltroEspacios();
  actualizarPuntos3D();
}

export function toggleCapa(checkboxId, layerId) {
  if (layerId === 'capa-espacios-extrusion') {
    aplicarVisibilidadYFiltroEspacios();
    return;
  }
  if (state.map && layerId && state.map.getLayer(layerId)) {
    state.map.setLayoutProperty(layerId, 'visibility', 'none');
  }
  actualizarPuntos3D();
}

// ==========================================
// GESTOR DE ESTILOS Y COLAPSO DE PANELES
// ==========================================
export function cambiarEstiloMapa(nuevoEstilo) {
  if (state.estiloMapaActual === nuevoEstilo || !state.map) return;
  state.estiloMapaActual = nuevoEstilo;

  document.querySelectorAll('.style-card-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-style') === nuevoEstilo);
  });

  try {
    localStorage.setItem(STORAGE_KEYS.MAP_STYLE, nuevoEstilo);
  } catch (e) {}

  if (window.innerWidth <= 768) {
    const panel = document.getElementById('map-styles-panel');
    if (panel && !panel.classList.contains('collapsed')) {
      toggleColapsoEstilos();
    }
  }

  state.map.setStyle(nuevoEstilo);

  state.map.once('style.load', () => {
    if (state.custom3DLayer && !state.map.getLayer(state.custom3DLayer.id)) {
      state.map.addLayer(state.custom3DLayer);
    }
    if (typeof state.reconfigurarCapasGeoJSON === 'function') {
      state.reconfigurarCapasGeoJSON();
    }
    sincronizarCapasDesdeColeccion();
    sincronizarEspaciosEnMapa(reconstruirIndiceBusqueda);
    actualizarTransparenciaPorZoom();
    actualizarTransformacion();
    actualizarPuntos3D();
    state.map.triggerRepaint();
  });
}

export function toggleColapsoEstilos() {
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

export function cargarEstiloMapaGuardado() {
  try {
    const guardado = localStorage.getItem(STORAGE_KEYS.MAP_STYLE);
    if (guardado === 'mapbox://styles/mapbox/satellite-streets-v12') {
      localStorage.removeItem(STORAGE_KEYS.MAP_STYLE);
      return;
    }
    if (guardado && guardado !== state.estiloMapaActual) {
      cambiarEstiloMapa(guardado);
    }
  } catch (e) {}
}

export function toggleColapsoControlPanel(forzarColapso) {
  const panel = document.getElementById('control-panel');
  const btn = document.getElementById('btnColapsarControlPanel');
  if (!panel) return;

  const nuevoColapso = typeof forzarColapso === 'boolean'
    ? forzarColapso
    : !panel.classList.contains('collapsed');

  if (nuevoColapso) {
    panel.classList.add('collapsed');
    if (btn) {
      btn.textContent = '▼';
      btn.title = 'Expandir ventana';
    }
  } else {
    panel.classList.remove('collapsed');
    if (btn) {
      btn.textContent = '▲';
      btn.title = 'Minimizar ventana';
    }
  }
}

export function togglePanelMovil(abrir) {
  toggleColapsoControlPanel(typeof abrir === 'boolean' ? !abrir : undefined);
}

export function autoCerrarPanelEnMovil() {
  if (window.innerWidth <= 768) {
    toggleColapsoControlPanel(true);
  }
}

// ==========================================
// BÚSQUEDA INTELIGENTE Y AUTOCOMPLETADO
// ==========================================
function normalizarTexto(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function actualizarSugerencias(query) {
  const searchSuggestions = document.getElementById('searchSuggestions');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  if (!searchSuggestions || !clearSearchBtn) return;

  if (!query) {
    searchSuggestions.style.display = 'none';
    searchSuggestions.innerHTML = '';
    clearSearchBtn.style.display = 'none';
    return;
  }

  clearSearchBtn.style.display = 'block';
  const queryNorm = normalizarTexto(query);
  const lista = typeof searchData !== 'undefined' ? searchData : [];

  const resultados = lista.filter(item =>
    normalizarTexto(item.label).includes(queryNorm) ||
    normalizarTexto(item.info).includes(queryNorm) ||
    normalizarTexto(item.category).includes(queryNorm)
  );

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
    <div class="suggestion-item" onclick="seleccionarResultado('${String(item.id).replace(/'/g, "\\'")}')">
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

export function seleccionarResultado(id) {
  autoCerrarPanelEnMovil();
  const lista = typeof searchData !== 'undefined' ? searchData : [];
  const item = lista.find(i => String(i.id) === String(id));
  if (!item || !state.map) return;

  const searchInput = document.getElementById('searchBox');
  const searchSuggestions = document.getElementById('searchSuggestions');
  if (searchInput) searchInput.value = item.label;
  if (searchSuggestions) searchSuggestions.style.display = 'none';

  if (state.currentFloor !== 'all' && state.currentFloor !== String(item.floor)) {
    filtrarPorNivel(item.floor);
  }

  state.map.flyTo({
    center: item.coords,
    zoom: item.kind === 'espacio' ? 19.8 : 20.5,
    pitch: 60,
    bearing: -15,
    essential: true,
    speed: 1.2
  });

  if (state.marcadorBusqueda) state.marcadorBusqueda.remove();
  state.marcadorBusqueda = new mapboxgl.Marker({ color: item.kind === 'espacio' ? '#7c3aed' : '#ef4444' })
    .setLngLat(item.coords)
    .addTo(state.map);

  if (item.kind === 'espacio') {
    const espacioReal = state.coleccionEspacios.find(e => String(e.id) === String(id));
    if (espacioReal) {
      mostrarPopupEspacio(espacioReal, item.coords);
    }
    return;
  }

  const puntoReal = state.coleccionPuntos.find(p => String(p.id) === String(id));
  if (puntoReal) {
    mostrarPopupPunto(construirFeatureDesdePunto(puntoReal), item.coords);
  }
}

export function inicializarBuscador() {
  const searchInput = document.getElementById('searchBox');
  const searchSuggestions = document.getElementById('searchSuggestions');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => actualizarSugerencias(e.target.value.trim()));
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const queryNorm = normalizarTexto(searchInput.value.trim());
        const lista = typeof searchData !== 'undefined' ? searchData : [];
        const primerResultado = lista.find(item =>
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
      if (searchInput) searchInput.value = '';
      actualizarSugerencias('');
      if (state.marcadorBusqueda) state.marcadorBusqueda.remove();
      if (state.popupActivo) state.popupActivo.remove();
    });
  }

  document.addEventListener('click', (e) => {
    if (searchSuggestions && !e.target.closest('.search-wrapper')) {
      searchSuggestions.style.display = 'none';
    }
  });
}

// ==========================================
// VISTAS RÁPIDAS DE CÁMARA Y BARRA DE COORDENADAS
// ==========================================
export function verVista3D() {
  autoCerrarPanelEnMovil();
  if (!state.map) return;
  state.map.flyTo({
    center: MURONTO_CENTER,
    zoom: 19.3,
    pitch: 60,
    bearing: -20,
    speed: 1.2
  });
}

export function verVista2D() {
  autoCerrarPanelEnMovil();
  if (!state.map) return;
  state.map.flyTo({
    center: MURONTO_CENTER,
    zoom: 19.6,
    pitch: 0,
    bearing: 0,
    speed: 1.2
  });
}

export function centrarSede() {
  autoCerrarPanelEnMovil();
  filtrarPorNivel('all');
  if (!state.map) return;
  state.map.flyTo({
    center: MURONTO_CENTER,
    zoom: 19.2,
    pitch: 55,
    bearing: -15,
    speed: 1.2
  });
}

export function actualizarTextoCoordenadas(lngLat, prefijo = 'Longitud') {
  const lng = lngLat.lng.toFixed(6);
  const lat = lngLat.lat.toFixed(6);
  ultimaCoordenada = [parseFloat(lng), parseFloat(lat)];

  const coordsDisplay = document.getElementById('coords-display');
  if (!coordsDisplay) return;
  coordsDisplay.textContent = prefijo === 'Punto Seleccionado'
    ? `Punto Seleccionado: [${lng}, ${lat}]`
    : `Longitud: ${lng} | Latitud: ${lat}`;
}

export function inicializarBarraCoordenadas() {
  const copyCoordsBtn = document.getElementById('copy-coords-btn');
  const coordsBarElem = document.getElementById('coords-bar');
  if (coordsBarElem) {
    coordsBarElem.style.setProperty('left', 'auto', 'important');
    coordsBarElem.style.setProperty('right', '16px', 'important');
    coordsBarElem.style.setProperty('bottom', '14px', 'important');
    coordsBarElem.style.setProperty('position', 'absolute', 'important');
  }

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
}
