const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para procesar JSON en solicitudes
app.use(express.json());

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint para guardar la calibración del modelo 3D permanentemente en disco
app.post('/api/calibracion', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'public', 'data', 'calibracion.json');
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true, message: 'Calibración guardada exitosamente en disco' });
  } catch (error) {
    console.error('Error al guardar calibracion.json:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Endpoint para guardar los puntos espaciales (office_data.js) permanentemente en disco
app.post('/api/puntos', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'public', 'office_data.js');
    if (req.body && typeof req.body.jsContent === 'string') {
      fs.writeFileSync(filePath, req.body.jsContent, 'utf8');
      res.json({ ok: true, message: 'Puntos guardados exitosamente en office_data.js' });
    } else {
      res.status(400).json({ ok: false, error: 'Contenido inválido' });
    }
  } catch (error) {
    console.error('Error al guardar office_data.js:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor WebGIS corriendo exitosamente en http://localhost:${PORT}`);
});
