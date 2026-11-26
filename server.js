const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Servidor estático exclusivamente para desarrollo local.
// En producción (Vercel), se sirve directamente el directorio 'public/'
// y la persistencia/autenticación operan mediante Firebase Auth + Cloud Firestore.
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Servidor WebGIS de desarrollo local corriendo en http://localhost:${PORT}`);
});
