// ==========================================
// PUNTO DE ENTRADA MODULAR - WEBGIS 3D CIDE-MÜRÖNTÖ
// ==========================================
import {
  aplicarRolUsuario,
  cerrarSesionUsuario,
  cerrarVentanaLogin,
  inicializarSistemaUsuarios,
  iniciarSesionVisitante,
  intentarLoginAdmin,
  mostrarVentanaLogin
} from './auth.js';
import {
  ajustarElevacion,
  ajustarEscala,
  ajustarInclinacion,
  ajustarOffsetX,
  ajustarOffsetY,
  ajustarRotacion,
  cambiarOpacidadManual,
  cargarCalibracionGuardada,
  copiarPosicionExteriorAInterior,
  guardarCalibracion,
  restablecerCalibracion,
  seleccionarModeloCalibrar,
  sincronizarSlidersUI,
  toggleFachadaExterior,
  toggleModeloInterior,
  toggleModoRayosX
} from './calibracion.js';
import {
  abrirEditorPunto,
  actualizarElevacionInput,
  actualizarElevacionSlider,
  actualizarEscalaDinamicaPuntos,
  actualizarOrientacionCamaraPuntos,
  actualizarPuntos3D,
  cancelarAccionEditor,
  cerrarModalPunto,
  eliminarPunto,
  fijarAlturaRapida,
  guardarPuntoModal,
  guardarPuntosEnNube,
  iniciarMoverPunto,
  onCambiarPisoModal,
  previsualizarElevacionPunto,
  seleccionarCategoriaPorDefecto,
  seleccionarEmoji,
  toggleModoInsercion
} from './puntos3d.js';
import { inicializarMapa } from './scene3d.js';
import {
  autoCerrarPanelEnMovil,
  cambiarEstiloMapa,
  centrarSede,
  filtrarPorNivel,
  inicializarBarraCoordenadas,
  inicializarBuscador,
  seleccionarResultado,
  toggleCapa,
  toggleColapsoControlPanel,
  toggleColapsoEstilos,
  togglePanelMovil,
  verVista2D,
  verVista3D
} from './ui.js';
import {
  abrirVisor360,
  ajustarZoom360,
  cerrarVisor360,
  toggleAutoGiro360
} from './visor360.js';

// Exponer manejadores globales requeridos por atributos HTML (onclick / oninput / onchange)
Object.assign(window, {
  // Usuarios y roles
  iniciarSesionVisitante,
  intentarLoginAdmin,
  cerrarSesionUsuario,
  aplicarRolUsuario,
  mostrarVentanaLogin,
  cerrarVentanaLogin,

  // Navegación, estilos y paneles UI
  filtrarPorNivel,
  toggleCapa,
  cambiarEstiloMapa,
  toggleColapsoEstilos,
  toggleColapsoControlPanel,
  togglePanelMovil,
  autoCerrarPanelEnMovil,
  seleccionarResultado,
  verVista3D,
  verVista2D,
  centrarSede,

  // Calibración 3D y Rayos X
  seleccionarModeloCalibrar,
  copiarPosicionExteriorAInterior,
  ajustarRotacion,
  ajustarInclinacion,
  ajustarOffsetX,
  ajustarOffsetY,
  ajustarEscala,
  ajustarElevacion,
  guardarCalibracion,
  restablecerCalibracion,
  sincronizarSlidersUI,
  cambiarOpacidadManual,
  toggleModoRayosX,
  toggleFachadaExterior,
  toggleModeloInterior,

  // Gestor de puntos espaciales 3D
  onCambiarPisoModal,
  actualizarElevacionInput,
  actualizarElevacionSlider,
  fijarAlturaRapida,
  previsualizarElevacionPunto,
  abrirEditorPunto,
  iniciarMoverPunto,
  eliminarPunto,
  toggleModoInsercion,
  cancelarAccionEditor,
  cerrarModalPunto,
  seleccionarEmoji,
  seleccionarCategoriaPorDefecto,
  guardarPuntoModal,
  actualizarPuntos3D,
  actualizarEscalaDinamicaPuntos,
  actualizarOrientacionCamaraPuntos,
  guardarPuntosEnNube,

  // Visor inmersivo 360°
  abrirVisor360,
  cerrarVisor360,
  toggleAutoGiro360,
  ajustarZoom360
});

function arrancarAplicacion() {
  cargarCalibracionGuardada();
  inicializarMapa();
  inicializarBuscador();
  inicializarBarraCoordenadas();
  inicializarSistemaUsuarios();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', arrancarAplicacion);
} else {
  arrancarAplicacion();
}
