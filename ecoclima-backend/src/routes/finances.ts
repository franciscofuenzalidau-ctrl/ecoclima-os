import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();
const filePath = path.resolve(process.cwd(), 'data_mock', 'financial_metrics.json');

// Helper to read data
function readFinancials(): any[] {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (error) {
    console.error('Error al leer datos financieros:', error);
  }
  return [];
}

// Helper to write data
function writeFinancials(data: any[]): boolean {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error al escribir datos financieros:', error);
  }
  return false;
}

// GET /api/finances - Get all financials
router.get('/', (req: Request, res: Response) => {
  res.status(200).json(readFinancials());
});

// PUT /api/finances - Update financials
router.put('/', (req: Request, res: Response) => {
  const updatedData = req.body; // Expects the full array
  if (!Array.isArray(updatedData)) {
    return res.status(400).json({ error: 'El cuerpo de la petición debe ser un arreglo de métricas mensuales.' });
  }

  if (writeFinancials(updatedData)) {
    return res.status(200).json({ success: true, message: 'Datos financieros actualizados con éxito.' });
  } else {
    return res.status(500).json({ error: 'No se pudo guardar la información financiera.' });
  }
});

// POST /api/finances/export-audit - Generate and export XPRIZE audit CSV
router.post('/export-audit', (req: Request, res: Response) => {
  try {
    const data = readFinancials();
    
    // Headers matching Devpost XPRIZE criteria exactly
    const headers = [
      'Period',
      'Total Revenue (USD)',
      'Independent Client Revenue (USD)',
      'Related Party Revenue (USD)',
      'Total Costs (USD) (Excl. Marketing)',
      'Marketing & Customer Acquisition Spend (USD)',
      'Cost Description / Explanation'
    ];

    const rows = data.map(item => {
      const clientRev = Number(item.client_revenue || 0);
      const relatedRev = Number(item.related_revenue || 0);
      const totalRev = clientRev + relatedRev;
      const opCosts = Number(item.operating_costs || 0);
      const mktSpend = Number(item.marketing_spend || 0);
      
      return [
        item.month,
        totalRev,
        clientRev,
        relatedRev,
        opCosts,
        mktSpend,
        item.cost_description || ''
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Return as file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=xprize_financial_audit_report.csv');
    return res.status(200).send(csvContent);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
