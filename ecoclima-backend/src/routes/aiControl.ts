import { Router } from 'express';
import { aiLogger } from '../services/aiLogger';

const router = Router();

// GET /api/ai-control/metrics - Retrieve aggregated AI performance metrics
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await aiLogger.getMetricsAsync();
    res.status(200).json(metrics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ai-control/logs - Retrieve latest 50 AI agent execution logs
router.get('/logs', async (req, res) => {
  try {
    const logs = await aiLogger.getLogsAsync();
    res.status(200).json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ai-control/reset - Clear execution logs and reset metrics
router.post('/reset', async (req, res) => {
  try {
    await aiLogger.resetAsync();
    res.status(200).json({ success: true, message: 'Logs y métricas de IA reiniciados con éxito.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
