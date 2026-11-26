// ==========================================
// SISTEMA DE USUARIOS Y ROLES (ADMIN CON FIREBASE AUTH / VISITANTE)
// ==========================================
import { STORAGE_KEYS, auth } from './config.js';
import { state } from './state.js';
import { sincronizarSlidersUI } from './calibracion.js';
import { cancelarAccionEditor, mostrarPopupPunto, construirFeatureDesdePunto } from './puntos3d.js';
import { toggleColapsoControlPanel, togglePanelMovil } from './ui.js';

let authListenerRegistrado = false;

function traducirErrorFirebaseAuth(err) {
  const code = err && err.code ? err.code : '';
  switch (code) {
    case 'auth/invalid-email':
      return '⚠️ El correo electrónico no tiene un formato válido.';
    case 'auth/user-disabled':
      return '⚠️ Esta cuenta de administrador está deshabilitada.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return '⚠️ Correo o contraseña incorrectos.';
    case 'auth/too-many-requests':
      return '⚠️ Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.';
    case 'auth/network-request-failed':
      return '⚠️ Error de red al conectar con Firebase Authentication.';
    default:
      return '⚠️ No se pudo iniciar sesión. Verifica tus credenciales.';
  }
}

export function inicializarSistemaUsuarios() {
  if (auth) {
    if (authListenerRegistrado) return;
    authListenerRegistrado = true;
    auth.onAuthStateChanged((user) => {
      if (user && !user.isAnonymous) {
        state.usuarioRolActual = 'admin';
        try {
          sessionStorage.setItem(STORAGE_KEYS.ROL, 'admin');
        } catch (e) {}
        aplicarRolUsuario('admin');
        cerrarVentanaLogin();
        return;
      }

      let rolGuardado = null;
      try {
        rolGuardado = sessionStorage.getItem(STORAGE_KEYS.ROL);
        if (rolGuardado === 'admin') {
          sessionStorage.removeItem(STORAGE_KEYS.ROL);
          rolGuardado = null;
        }
      } catch (e) {}

      if (rolGuardado === 'visitante') {
        aplicarRolUsuario('visitante');
        cerrarVentanaLogin();
        toggleColapsoControlPanel(true);
      } else {
        mostrarVentanaLogin();
      }
    });
    return;
  }

  try {
    const rolGuardado = sessionStorage.getItem(STORAGE_KEYS.ROL);
    if (rolGuardado === 'visitante') {
      aplicarRolUsuario('visitante');
      cerrarVentanaLogin();
      toggleColapsoControlPanel(true);
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.ROL);
      mostrarVentanaLogin();
    }
  } catch (e) {
    mostrarVentanaLogin();
  }
}

export function mostrarVentanaLogin() {
  if (window.innerWidth <= 768) {
    togglePanelMovil(false);
  }
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    const emailInput = document.getElementById('adminEmailInput');
    const pwd = document.getElementById('adminPasswordInput');
    if (pwd) pwd.value = '';
    if (emailInput) {
      setTimeout(() => emailInput.focus(), 150);
    } else if (pwd) {
      setTimeout(() => pwd.focus(), 150);
    }
    const err = document.getElementById('adminLoginError');
    if (err) err.style.display = 'none';
  }
}

export function cerrarVentanaLogin() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
  if (window.innerWidth <= 768) {
    togglePanelMovil(false);
  }
}

export function iniciarSesionVisitante() {
  state.usuarioRolActual = 'visitante';
  try {
    sessionStorage.setItem(STORAGE_KEYS.ROL, 'visitante');
  } catch (e) {}
  aplicarRolUsuario('visitante');
  cerrarVentanaLogin();
  toggleColapsoControlPanel(true);
}

export async function intentarLoginAdmin() {
  const emailInput = document.getElementById('adminEmailInput');
  const pwdInput = document.getElementById('adminPasswordInput');
  const btnLogin = document.getElementById('btnLoginAdmin');
  const err = document.getElementById('adminLoginError');

  const correo = emailInput ? emailInput.value.trim() : '';
  const clave = pwdInput ? pwdInput.value : '';

  const mostrarError = (mensaje) => {
    if (err) {
      err.style.display = 'block';
      err.textContent = mensaje;
    }
  };

  if (!correo || !clave) {
    mostrarError('⚠️ Ingresa tu correo y contraseña de administrador.');
    if (!correo && emailInput) emailInput.focus();
    else if (pwdInput) pwdInput.focus();
    return;
  }

  if (!auth) {
    mostrarError('⚠️ Servicio de autenticación no disponible sin conexión a Firebase.');
    return;
  }

  if (err) err.style.display = 'none';
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.textContent = '⏳ Verificando...';
  }

  try {
    await auth.signInWithEmailAndPassword(correo, clave);
    state.usuarioRolActual = 'admin';
    try {
      sessionStorage.setItem(STORAGE_KEYS.ROL, 'admin');
    } catch (e) {}
    aplicarRolUsuario('admin');
    cerrarVentanaLogin();
    toggleColapsoControlPanel(false);
  } catch (authErr) {
    mostrarError(traducirErrorFirebaseAuth(authErr));
    if (pwdInput) {
      pwdInput.value = '';
      pwdInput.focus();
    }
  } finally {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.textContent = '🔑 Acceder';
    }
  }
}

export async function cerrarSesionUsuario() {
  state.usuarioRolActual = null;
  try {
    sessionStorage.removeItem(STORAGE_KEYS.ROL);
  } catch (e) {}
  if (auth && auth.currentUser) {
    try {
      await auth.signOut();
    } catch (e) {
      console.warn('Error al cerrar sesión en Firebase Auth:', e);
    }
  }
  cancelarAccionEditor();
  if (state.popupActivo) state.popupActivo.remove();
  mostrarVentanaLogin();
}

export function aplicarRolUsuario(rol) {
  state.usuarioRolActual = rol;
  const roleText = document.getElementById('roleInfoText');
  const seccionAdmin = document.getElementById('seccionEditorAdmin');
  const seccionCalib = document.getElementById('seccionCalibracionAdmin');
  const lblFachada = document.getElementById('labelFachadaExterior');
  const lblInterior = document.getElementById('labelModeloInterior');

  if (rol === 'admin') {
    const adminEmail = auth && auth.currentUser && auth.currentUser.email ? auth.currentUser.email : '';
    if (roleText) {
      roleText.title = adminEmail ? `Sesión: ${adminEmail}` : 'Administrador autenticado';
      roleText.innerHTML = '<span style="color: #059669; font-weight: 700;">👑 Administrador</span> <span style="font-size: 9px; background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 4px; font-weight: 700;">Edición Total</span>';
    }
    if (seccionAdmin) seccionAdmin.style.display = 'block';
    if (seccionCalib) seccionCalib.style.display = 'block';
    if (lblFachada) lblFachada.textContent = '🏛️ Fachada Exterior (edificioM-v1)';
    if (lblInterior) lblInterior.textContent = '🚪 Estructura Interior (medidasmetros-v2)';
    sincronizarSlidersUI();
  } else {
    if (roleText) {
      roleText.title = 'Modo solo lectura';
      roleText.innerHTML = '<span style="color: #2563eb; font-weight: 700;">👤 Visitante</span> <span style="font-size: 9px; background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: 700;">Solo Lectura</span>';
    }
    if (seccionAdmin) seccionAdmin.style.display = 'none';
    if (seccionCalib) seccionCalib.style.display = 'none';
    if (lblFachada) lblFachada.textContent = '🏛️ Fachada Exterior';
    if (lblInterior) lblInterior.textContent = '🚪 Estructura Interior';
    cancelarAccionEditor();
  }

  if (state.popupActivo && state.popupActivo.isOpen() && state.puntoSeleccionadoActivo) {
    const p = state.coleccionPuntos.find(pt => pt.id === state.puntoSeleccionadoActivo.id);
    if (p) {
      mostrarPopupPunto(construirFeatureDesdePunto(p), p.coords);
    }
  }
}
