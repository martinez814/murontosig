// ==========================================
// VISOR INMERSIVO 360° NATIVO CON THREE.JS
// ==========================================

let visor360Scene = null;
let visor360Camera = null;
let visor360Renderer = null;
let visor360SphereMesh = null;
let visor360AnimId = null;

let visor360IsUserInteracting = false;
let visor360OnPointerDownPointerX = 0;
let visor360OnPointerDownPointerY = 0;
let visor360OnPointerDownLon = 0;
let visor360OnPointerDownLat = 0;
let visor360Lon = 0;
let visor360Lat = 0;
let visor360Fov = 75;
let visor360AutoGiro = true;
let visor360Target = null;

function inicializarVisor360() {
  if (visor360Renderer) return;

  const container = document.getElementById('canvasContainer360');
  if (!container) return;

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  visor360Scene = new THREE.Scene();
  visor360Camera = new THREE.PerspectiveCamera(visor360Fov, width / height, 1, 1100);
  visor360Target = new THREE.Vector3();

  const geometry = new THREE.SphereGeometry(500, 60, 40);
  geometry.scale(-1, 1, 1);

  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  visor360SphereMesh = new THREE.Mesh(geometry, material);
  visor360Scene.add(visor360SphereMesh);

  visor360Renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  visor360Renderer.outputEncoding = THREE.sRGBEncoding;
  visor360Renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  visor360Renderer.setSize(width, height);
  container.appendChild(visor360Renderer.domElement);

  container.addEventListener('pointerdown', onVisor360PointerDown, false);
  document.addEventListener('pointermove', onVisor360PointerMove, false);
  document.addEventListener('pointerup', onVisor360PointerUp, false);
  container.addEventListener('wheel', onVisor360Wheel, { passive: false });
  window.addEventListener('resize', onVisor360WindowResize, false);
}

function onVisor360PointerDown(event) {
  if (event.isPrimary === false) return;
  visor360IsUserInteracting = true;
  visor360OnPointerDownPointerX = event.clientX;
  visor360OnPointerDownPointerY = event.clientY;
  visor360OnPointerDownLon = visor360Lon;
  visor360OnPointerDownLat = visor360Lat;
}

function onVisor360PointerMove(event) {
  if (event.isPrimary === false || !visor360IsUserInteracting) return;
  visor360Lon = (visor360OnPointerDownPointerX - event.clientX) * 0.15 + visor360OnPointerDownLon;
  visor360Lat = (event.clientY - visor360OnPointerDownPointerY) * 0.15 + visor360OnPointerDownLat;
}

function onVisor360PointerUp(event) {
  if (event.isPrimary === false) return;
  visor360IsUserInteracting = false;
}

function onVisor360Wheel(event) {
  event.preventDefault();
  ajustarZoom360(event.deltaY * 0.05);
}

export function ajustarZoom360(delta) {
  visor360Fov = Math.max(30, Math.min(100, visor360Fov + delta));
  if (visor360Camera) {
    visor360Camera.fov = visor360Fov;
    visor360Camera.updateProjectionMatrix();
  }
}

export function toggleAutoGiro360() {
  visor360AutoGiro = !visor360AutoGiro;
  const btn = document.getElementById('btn360AutoGiro');
  if (btn) {
    if (visor360AutoGiro) {
      btn.classList.add('active');
      btn.textContent = '🔄 Auto Giro: ON';
    } else {
      btn.classList.remove('active');
      btn.textContent = '⏸️ Auto Giro: OFF';
    }
  }
}

function onVisor360WindowResize() {
  const container = document.getElementById('canvasContainer360');
  if (!container || !visor360Camera || !visor360Renderer) return;
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  visor360Camera.aspect = width / height;
  visor360Camera.updateProjectionMatrix();
  visor360Renderer.setSize(width, height);
}

function animarVisor360() {
  const modal = document.getElementById('modalVisor360');
  if (!modal || modal.style.display === 'none') {
    if (visor360AnimId) cancelAnimationFrame(visor360AnimId);
    visor360AnimId = null;
    return;
  }

  visor360AnimId = requestAnimationFrame(animarVisor360);

  if (!visor360IsUserInteracting && visor360AutoGiro) {
    visor360Lon += 0.08;
  }

  visor360Lat = Math.max(-85, Math.min(85, visor360Lat));
  const phi = THREE.MathUtils.degToRad(90 - visor360Lat);
  const theta = THREE.MathUtils.degToRad(visor360Lon);

  visor360Target.x = 500 * Math.sin(phi) * Math.cos(theta);
  visor360Target.y = 500 * Math.cos(phi);
  visor360Target.z = 500 * Math.sin(phi) * Math.sin(theta);

  visor360Camera.lookAt(visor360Target);
  visor360Renderer.render(visor360Scene, visor360Camera);
}

export function abrirVisor360(urlImagen, titulo, subtitulo) {
  const modal = document.getElementById('modalVisor360');
  const titElem = document.getElementById('visor360Titulo');
  const subElem = document.getElementById('visor360Subtitulo');
  const loading = document.getElementById('visor360Cargando');
  const btnAuto = document.getElementById('btn360AutoGiro');

  if (!modal) return;

  if (titElem) titElem.textContent = titulo || 'Vista Panorámica 360°';
  if (subElem) subElem.textContent = subtitulo || 'Torre Humboldt • MÜRÖNTÖ';
  if (loading) loading.style.display = 'flex';
  if (btnAuto) {
    btnAuto.classList.add('active');
    btnAuto.textContent = '🔄 Auto Giro: ON';
  }

  modal.style.display = 'flex';
  inicializarVisor360();
  onVisor360WindowResize();

  visor360Lon = 0;
  visor360Lat = 0;
  visor360Fov = 75;
  visor360AutoGiro = true;
  if (visor360Camera) {
    visor360Camera.fov = visor360Fov;
    visor360Camera.updateProjectionMatrix();
  }

  const loader = new THREE.TextureLoader();
  loader.load(
    urlImagen,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.encoding = THREE.sRGBEncoding;
      if (visor360SphereMesh) {
        if (visor360SphereMesh.material.map) {
          visor360SphereMesh.material.map.dispose();
        }
        visor360SphereMesh.material.color.set(0xffffff);
        visor360SphereMesh.material.map = texture;
        visor360SphereMesh.material.needsUpdate = true;
      }
      if (loading) loading.style.display = 'none';
      if (!visor360AnimId) animarVisor360();
    },
    undefined,
    (err) => {
      console.error('Error al cargar textura 360:', err);
      if (loading) {
        loading.innerHTML = '<span style="color: #f87171; text-align: center; padding: 20px;">⚠️ No se pudo cargar la imagen panorámica. Verifica que el archivo exista en public/panoramas/</span><button class="btn-visor-control" style="margin-top: 10px;" onclick="cerrarVisor360()">Volver al mapa</button>';
      }
    }
  );

  if (!visor360AnimId) animarVisor360();
}

export function cerrarVisor360() {
  const modal = document.getElementById('modalVisor360');
  if (modal) modal.style.display = 'none';
  if (visor360AnimId) {
    cancelAnimationFrame(visor360AnimId);
    visor360AnimId = null;
  }
}
