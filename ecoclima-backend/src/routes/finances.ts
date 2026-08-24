import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../services/firebase';
import ExcelJS from 'exceljs';
import { ahoraEnChile } from '../services/agenda';
import { etiquetaDeMes, precioMantencion, precioInstalacion, parametrosFinancieros } from '../services/tarifas';

/**
 * Métricas financieras del panel (módulo Finanzas y Auditoría).
 *
 * Antes esto vivía SOLO en data_mock/financial_metrics.json, y eso lo hacía inservible en
 * producción por dos razones a la vez: el archivo está en .gitignore, así que nunca llegaba al
 * contenedor y la API devolvía vacío (el panel mostraba $0); y aunque se llenara desde el panel,
 * Cloud Run borra el disco del contenedor en cada reinicio, así que el dato se perdía igual.
 * Es el mismo error que ya había tenido el aviso al técnico.
 *
 * Ahora el dato vive en Firestore. El archivo local queda solo como respaldo para desarrollo,
 * cuando no hay credenciales de base de datos.
 */
const router = Router();
const filePath = path.resolve(process.cwd(), 'data_mock', 'financial_metrics.json');

/** Un único documento con el arreglo completo: evita problemas de orden entre meses. */
const DOC_FINANZAS = { coleccion: 'system_config', doc: 'finanzas' };

async function readFinancials(): Promise<any[]> {
  if (db) {
    try {
      const doc = await db.collection(DOC_FINANZAS.coleccion).doc(DOC_FINANZAS.doc).get();
      if (doc.exists) {
        const meses = doc.data()?.meses;
        if (Array.isArray(meses)) return meses;
      }
      return [];
    } catch (error) {
      console.error('Error al leer finanzas desde Firestore:', error);
      return [];
    }
  }

  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (error) {
    console.error('Error al leer datos financieros del archivo local:', error);
  }
  return [];
}

async function writeFinancials(data: any[]): Promise<boolean> {
  if (db) {
    try {
      await db.collection(DOC_FINANZAS.coleccion).doc(DOC_FINANZAS.doc).set({
        meses: data,
        actualizado_el: new Date().toISOString()
      });
      return true;
    } catch (error) {
      console.error('Error al guardar finanzas en Firestore:', error);
      return false;
    }
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error al escribir datos financieros en el archivo local:', error);
  }
  return false;
}

/**
 * Ingresos del mes, sumados desde los servicios realmente cerrados.
 *
 * Antes esta cifra se escribía a mano y podía no tener relación con el trabajo hecho. Ahora sale
 * de las fichas: cada servicio marcado como completado guarda su monto, y aquí se agrupan por mes.
 *
 * Van a la línea de clientes preexistentes porque hoy todos los clientes del sistema vienen de la
 * base instalada de Furtz. Si más adelante el agente capta clientes nuevos, habrá que distinguirlos
 * con una marca de origen en la ficha: el sistema todavía no sabe hacer esa diferencia solo.
 */
async function ingresosPorMes(): Promise<Record<string, number>> {
  const porMes: Record<string, number> = {};
  if (!db) return porMes;

  try {
    const snap = await db.collection('leads').get();
    snap.forEach(doc => {
      const l = doc.data() as any;
      const usd = Number(l.service_amount_usd);
      if (!Number.isFinite(usd) || usd <= 0) return;

      const fecha = l.completed_at || l.installation_date || l.last_maintenance_date;
      if (!fecha) return;
      const mes = etiquetaDeMes(String(fecha));
      if (!mes) return;

      porMes[mes] = Math.round(((porMes[mes] || 0) + usd) * 100) / 100;
    });
  } catch (error) {
    console.error('Error al sumar ingresos desde las fichas:', error);
  }
  return porMes;
}

/** Une los costos guardados a mano con los ingresos calculados desde las fichas. */
async function finanzasCompletas(): Promise<any[]> {
  const guardado = await readFinancials();
  const ingresos = await ingresosPorMes();

  const meses = new Map<string, any>();
  guardado.forEach(m => meses.set(String(m.month), { ...m }));

  for (const [mes, usd] of Object.entries(ingresos)) {
    const fila = meses.get(mes) || {
      month: mes,
      client_revenue: 0,
      operating_costs: 0,
      marketing_spend: 0,
      cost_description: ''
    };
    fila.related_revenue = usd;
    meses.set(mes, fila);
  }

  // Un mes SIN servicios cerrados conserva lo que se haya cargado a mano. Ponerlo en cero
  // borraria el historial anterior a esta funcion: los servicios cerrados antes no tienen
  // monto en la ficha, y su ingreso solo existe en lo que se cargo manualmente.

  return [...meses.values()];
}

/**
 * GET /api/finances/ingresos - Detalle servicio por servicio.
 *
 * El total del panel no se puede auditar solo: si dice USD 133,33 no se sabe de qué trabajos
 * salió. Esto devuelve cada servicio cobrado con su fecha, cliente y monto, para poder revisar
 * de dónde viene cada peso y detectar un cierre mal cargado.
 */
router.get('/ingresos', async (req: Request, res: Response) => {
  if (!db) return res.status(200).json([]);
  try {
    const snap = await db.collection('leads').get();
    const filas: any[] = [];

    snap.forEach(doc => {
      const l = doc.data() as any;
      const usd = Number(l.service_amount_usd);
      if (!Number.isFinite(usd) || usd <= 0) return;

      const fecha = l.completed_at || l.installation_date || l.last_maintenance_date || null;
      filas.push({
        fecha,
        mes: fecha ? etiquetaDeMes(String(fecha)) : null,
        cliente: l.client_name || null,
        phone: doc.id,
        service_type: l.service_type || null,
        unidades: l.service_units ?? null,
        tamano: l.equipment_size || null,
        monto_clp: Number(l.service_amount_clp) || null,
        monto_usd: usd
      });
    });

    // Del más reciente al más antiguo: lo último cerrado es lo que uno viene a revisar.
    filas.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    return res.status(200).json(filas);
  } catch (error: any) {
    console.error('Error al listar el detalle de ingresos:', error.message);
    return res.status(500).json({ error: error.message });
  }
});
/**
 * GET /api/finances/servicios.xlsx?mes=YYYY-MM - Planilla de los servicios cerrados del mes.
 *
 * Se genera un .xlsx de verdad y no un CSV a proposito: Excel en configuracion regional de Chile
 * espera punto y coma como separador, asi que un CSV con comas abre todo apretado en una sola
 * columna. Con xlsx eso no pasa, y ademas los montos quedan como numeros con formato, no como
 * texto que hay que volver a convertir para sumar.
 *
 * Sin el parametro mes se usa el mes en curso.
 */
router.get('/servicios.xlsx', async (req: Request, res: Response) => {
  if (!db) return res.status(500).json({ error: 'Firestore no está inicializado.' });

  try {
    const hoy = ahoraEnChile().date;               // YYYY-MM-DD en hora de Chile
    const mes = String(req.query.mes || hoy.slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: 'El mes debe venir como YYYY-MM.' });
    }

    const snapshot = await db.collection('leads').get();
    const filas: any[] = [];

    snapshot.forEach(doc => {
      const l = doc.data() as any;
      if (l.status !== 'Instalado') return;

      const fecha = l.completed_at || l.installation_date || l.last_maintenance_date;
      if (!fecha || String(fecha).slice(0, 7) !== mes) return;

      filas.push({
        fecha: String(fecha).slice(0, 10),
        cliente: l.client_name || '',
        telefono: `+${doc.id}`,
        servicio: l.service_type === 'installation' ? 'Instalación' : 'Mantención',
        unidades: l.service_units ?? null,
        tamano: l.equipment_size || '',
        direccion: l.address || '',
        referencia: l.address_reference || '',
        tecnico: l.technician || '',
        cobradoCLP: Number(l.service_amount_clp) || null,
        ingresoUSD: Number(l.service_amount_usd) || null,
        nota: l.satisfaction_rating ?? null,
        comentario: l.satisfaction_comment || ''
      });
    });

    filas.sort((a, b) => a.fecha.localeCompare(b.fecha));

    const libro = new ExcelJS.Workbook();
    libro.creator = 'Furtz Clima OS';
    libro.created = new Date();
    const hoja = libro.addWorksheet(`Servicios ${mes}`);

    hoja.columns = [
      { header: 'Fecha',            key: 'fecha',      width: 12 },
      { header: 'Cliente',          key: 'cliente',    width: 32 },
      { header: 'Teléfono',         key: 'telefono',   width: 15 },
      { header: 'Servicio',         key: 'servicio',   width: 13 },
      { header: 'Unidades',         key: 'unidades',   width: 10 },
      { header: 'Tamaño',           key: 'tamano',     width: 10 },
      { header: 'Dirección',        key: 'direccion',  width: 34 },
      { header: 'Referencia',       key: 'referencia', width: 26 },
      { header: 'Técnico',          key: 'tecnico',    width: 14 },
      { header: 'Cobrado (CLP)',    key: 'cobradoCLP', width: 15 },
      { header: 'Ingreso (USD)',    key: 'ingresoUSD', width: 14 },
      { header: 'Nota (1-7)',       key: 'nota',       width: 11 },
      { header: 'Comentario',       key: 'comentario', width: 44 }
    ];

    hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    hoja.getRow(1).alignment = { vertical: 'middle' };
    hoja.views = [{ state: 'frozen', ySplit: 1 }];

    filas.forEach(f => hoja.addRow(f));

    // Los montos como numero con formato: asi se pueden sumar en la planilla sin convertir nada.
    hoja.getColumn('cobradoCLP').numFmt = '#,##0';
    hoja.getColumn('ingresoUSD').numFmt = '#,##0.00';

    if (filas.length > 0) {
      const total = hoja.addRow({
        cliente: 'TOTAL',
        cobradoCLP: filas.reduce((a, f) => a + (f.cobradoCLP || 0), 0),
        ingresoUSD: Math.round(filas.reduce((a, f) => a + (f.ingresoUSD || 0), 0) * 100) / 100
      });
      total.font = { bold: true };
      total.getCell('cobradoCLP').numFmt = '#,##0';
      total.getCell('ingresoUSD').numFmt = '#,##0.00';
    } else {
      hoja.addRow({ cliente: `Sin servicios cerrados en ${mes}.` });
    }

    const buffer = await libro.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=servicios_furtz_${mes}.xlsx`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('[EXCEL] Error al generar la planilla:', error.message);
    return res.status(500).json({ error: error.message });
  }
});
// GET /api/finances/tarifas - Precios vigentes, para que el panel muestre el monto calculado
// sin tener que repetir la regla de precios en el código del dashboard.
router.get('/tarifas', (req: Request, res: Response) => {
  const { iva, clpPorUsd } = parametrosFinancieros();
  res.status(200).json({
    mantencion_chica: precioMantencion('chico'),
    mantencion_grande: precioMantencion('grande'),
    instalacion_promedio: precioInstalacion(),
    iva_porcentaje: iva,
    clp_por_usd: clpPorUsd
  });
});
// GET /api/finances
router.get('/', async (req: Request, res: Response) => {
  res.status(200).json(await finanzasCompletas());
});

// PUT /api/finances
router.put('/', async (req: Request, res: Response) => {
  const updatedData = req.body; // Espera el arreglo completo
  if (!Array.isArray(updatedData)) {
    return res.status(400).json({ error: 'El cuerpo de la petición debe ser un arreglo de métricas mensuales.' });
  }

  if (await writeFinancials(updatedData)) {
    return res.status(200).json({ success: true, message: 'Datos financieros actualizados con éxito.' });
  } else {
    return res.status(500).json({ error: 'No se pudo guardar la información financiera.' });
  }
});

// POST /api/finances/export-audit - CSV con el formato que pide Devpost
router.post('/export-audit', async (req: Request, res: Response) => {
  try {
    const data = await finanzasCompletas();

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

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=xprize_financial_audit_report.csv');
    return res.status(200).send(csvContent);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
