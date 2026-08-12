import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import whatsappRouter from './routes/whatsapp';
import leadsRouter from './routes/leads';
import aiControlRouter from './routes/aiControl';
import financesRouter from './routes/finances';
import { tal_vez_correr_campana_diaria } from './services/campanaPreventiva';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Momento en que arrancó este contenedor. Sirve para saber si un despliegue ya
// entró en producción: si `startedAt` es reciente, Cloud Run levantó una revisión nueva.
const STARTED_AT = new Date();

// Health check endpoint
//
// Además de informar el estado, sirve de reloj: Cloud Run apaga el contenedor cuando
// no hay tráfico, así que un temporizador en memoria no sobrevive. El uptime check
// golpea esta ruta cada minuto, y ahí se aprovecha para preguntar si toca correr la
// campaña preventiva del día. No bloquea la respuesta.
app.get('/health', (req, res) => {
  tal_vez_correr_campana_diaria().catch(err =>
    console.error('[CAMPAÑA automática] Error no controlado:', err)
  );

  res.status(200).json({
    status: 'OK',
    timestamp: new Date(),
    startedAt: STARTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    campanaAutomatica: process.env.CAMPANA_AUTOMATICA === 'true'
  });
});

// WhatsApp Webhook endpoint
app.use('/webhook', whatsappRouter);

// Leads API endpoint
app.use('/api/leads', leadsRouter);

// AI Control API endpoint
app.use('/api/ai-control', aiControlRouter);

// Finances API endpoint
app.use('/api/finances', financesRouter);

import path from 'path';
import fs from 'fs';

// Serve static frontend files if build exists
const frontendDistPath = path.resolve(process.cwd(), '../ecoclima-dashboard/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  console.log(`[STATIC] Sirviendo frontend estático desde: ${frontendDistPath}`);
  
  // Client-side routing fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else {
  console.warn(`[STATIC] Carpeta frontend dist no encontrada en: ${frontendDistPath}`);
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
