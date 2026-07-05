import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import whatsappRouter from './routes/whatsapp';
import leadsRouter from './routes/leads';
import aiControlRouter from './routes/aiControl';
import financesRouter from './routes/finances';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
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
