import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const JS_DIR = path.join(PUBLIC_DIR, 'js');

const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error(`FAIL: ${msg}`);
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

/** Verifica sintaxis de módulos ES y servidor Node.js. */
function checkSyntax() {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'server.js')], { stdio: 'pipe' });
  pass('Sintaxis de server.js');

  const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  for (const file of jsFiles) {
    const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    execFileSync(process.execPath, ['--input-type=module', '--check'], { input: code, stdio: 'pipe' });
  }
  pass(`Sintaxis ES Module en ${jsFiles.length} archivos de public/js/`);
}

/** Verifica que todas las importaciones relativas resuelvan a exportaciones reales. */
function checkModuleGraph() {
  const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const exportsByFile = new Map();

  for (const file of jsFiles) {
    const content = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    const exports = new Set();
    for (const match of content.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_]+)/g)) {
      exports.add(match[1]);
    }
    exportsByFile.set(file, exports);
  }

  for (const file of jsFiles) {
    const content = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    for (const match of content.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) {
      const importedNames = match[1]
        .split(',')
        .map(part => part.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      const targetFile = match[2];
      const targetExports = exportsByFile.get(targetFile);

      if (!targetExports) {
        fail(`Archivo importado no encontrado: ./${targetFile} desde ${file}`);
        continue;
      }
      for (const name of importedNames) {
        if (!targetExports.has(name)) {
          fail(`Exportación faltante '${name}' en ./${targetFile} (importada por ${file})`);
        }
      }
    }
  }
  pass('Grafo de importaciones/exportaciones ES completo');
}

/** Verifica que los manejadores inline de index.html estén expuestos en main.js. */
function checkHtmlHandlers() {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const mainJs = fs.readFileSync(path.join(JS_DIR, 'main.js'), 'utf8');

  const exposedBlockMatch = mainJs.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\);/);
  if (!exposedBlockMatch) {
    fail('No se encontró Object.assign(window, {...}) en public/js/main.js');
    return;
  }

  const exposedNames = new Set(
    exposedBlockMatch[1]
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
      .map(line => line.split(':')[0].replace(/,$/, '').trim())
      .filter(Boolean)
  );

  const handlerMatches = html.matchAll(/on(?:click|change|input|keydown)="([^"]+)"/g);
  for (const match of handlerMatches) {
    const expr = match[1];
    for (const fnCall of expr.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const fnName = fnCall[1];
      if (fnName === 'if') continue;
      if (!exposedNames.has(fnName)) {
        fail(`Manejador HTML '${fnName}()' no está expuesto en window dentro de main.js`);
      }
    }
  }
  pass('Todos los manejadores inline de index.html están expuestos en window');
}

/** Valida JSONs y GeoJSON del proyecto. */
function checkJsonFiles() {
  const jsonPaths = [
    'package.json',
    'vercel.json',
    'public/data/calibracion.json',
    'public/data/edificio.geojson'
  ];

  for (const rel of jsonPaths) {
    const full = path.join(ROOT, rel);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (rel.endsWith('.geojson') && parsed.type !== 'FeatureCollection') {
        fail(`${rel} debe tener type="FeatureCollection"`);
      }
    } catch (err) {
      fail(`JSON inválido en ${rel}: ${err.message}`);
    }
  }
  pass('Archivos JSON y GeoJSON válidos');
}

/** Verifica existencia de activos locales referenciados y ausencia de espacios en nombres. */
function checkAssetsAndSecurity() {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const sceneJs = fs.readFileSync(path.join(JS_DIR, 'scene3d.js'), 'utf8');

  const expectedAssets = [
    'public/css/main.css',
    'public/office_data.js',
    'public/data/calibracion.json'
  ];

  for (const m of html.matchAll(/value="(panoramas\/[^"]+)"/g)) {
    expectedAssets.push(path.join('public', m[1]));
  }
  for (const m of sceneJs.matchAll(/'(models\/[^']+\.glb)'/g)) {
    expectedAssets.push(path.join('public', m[1]));
  }

  for (const rel of expectedAssets) {
    const normalizedRel = rel.replace(/\\/g, '/');
    const full = path.join(ROOT, normalizedRel);
    if (!fs.existsSync(full)) {
      fail(`Activo referenciado no existe: ${normalizedRel}`);
    }
    if (/\s/.test(path.basename(full))) {
      fail(`El archivo contiene espacios en su nombre: ${normalizedRel}`);
    }
  }

  for (const dirName of ['models', 'panoramas']) {
    const dirPath = path.join(PUBLIC_DIR, dirName);
    for (const entry of fs.readdirSync(dirPath)) {
      if (/\s/.test(entry)) {
        fail(`Archivo con espacios en public/${dirName}/: '${entry}'`);
      }
    }
  }
  pass('Activos locales existentes y nombres normalizados sin espacios');

  const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  for (const file of jsFiles) {
    const content = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    if (content.includes('ADMIN_PASSWORD_CORRECTA')) {
      fail(`Secreto legado detectado en public/js/${file}`);
    }
  }
  pass('Sin contraseñas de administrador hardcodeadas en public/js/');
}

try {
  checkSyntax();
  checkModuleGraph();
  checkHtmlHandlers();
  checkJsonFiles();
  checkAssetsAndSecurity();
} catch (err) {
  fail(err.message);
}

if (failures.length > 0) {
  console.error(`\nVerificación fallida con ${failures.length} error(es).`);
  process.exit(1);
}

console.log('\n✓ Todas las verificaciones QA pasaron correctamente.');
