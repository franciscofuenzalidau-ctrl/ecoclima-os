/**
 * Planilla mensual de servicios cerrados: se arma aqui y la usan dos caminos.
 *
 * - El boton del panel, que la descarga cuando uno quiera.
 * - El envio automatico del ultimo dia habil del mes.
 *
 * Estaba escrita dentro de la ruta de finanzas; se saca a un servicio para no tener dos copias
 * que se vayan separando con el tiempo.
 */
import ExcelJS from 'exceljs';
import { db } from './firebase';
import { ahoraEnChile } from './agenda';
import nodemailer from 'nodemailer';

export interface FilaServicio {
  fecha: string; cliente: string; telefono: string; servicio: string;
  unidades: number | null; tamano: string; direccion: string; referencia: string;
  tecnico: string; cobradoCLP: number | null; ingresoUSD: number | null;
  nota: number | null; comentario: string;
}

/** Los servicios cerrados de un mes, ordenados por fecha. `mes` viene como YYYY-MM. */
export async function serviciosDelMes(mes: string): Promise<FilaServicio[]> {
  if (!db) return [];
  const snapshot = await db.collection('leads').get();
  const filas: FilaServicio[] = [];

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
  return filas;
}

/** El archivo .xlsx listo para descargar o adjuntar a un correo. */
export async function planillaDeServicios(mes: string, filas: FilaServicio[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Furtz Clima OS';
  libro.created = new Date();
  const hoja = libro.addWorksheet(`Servicios ${mes}`);

  hoja.columns = [
    { header: 'Fecha',         key: 'fecha',      width: 12 },
    { header: 'Cliente',       key: 'cliente',    width: 32 },
    { header: 'Teléfono',      key: 'telefono',   width: 15 },
    { header: 'Servicio',      key: 'servicio',   width: 13 },
    { header: 'Unidades',      key: 'unidades',   width: 10 },
    { header: 'Tamaño',        key: 'tamano',     width: 10 },
    { header: 'Dirección',     key: 'direccion',  width: 34 },
    { header: 'Referencia',    key: 'referencia', width: 26 },
    { header: 'Técnico',       key: 'tecnico',    width: 14 },
    { header: 'Cobrado (CLP)', key: 'cobradoCLP', width: 15 },
    { header: 'Ingreso (USD)', key: 'ingresoUSD', width: 14 },
    { header: 'Nota (1-7)',    key: 'nota',       width: 11 },
    { header: 'Comentario',    key: 'comentario', width: 44 }
  ];

  hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  filas.forEach(f => hoja.addRow(f));

  // Numeros con formato, no texto: asi se pueden sumar y filtrar en la planilla sin convertir.
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

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/**
 * Si la fecha dada es el ultimo dia habil (lunes a viernes) de su mes.
 *
 * OJO: no considera feriados. Si el ultimo dia habil cae en un feriado chileno, la planilla se
 * manda igual ese dia. Se prefirio eso a no mandarla: un calendario de feriados hay que
 * mantenerlo todos los años y quedarse sin reporte es peor que recibirlo un dia antes.
 */
export function esUltimoDiaHabilDelMes(fechaISO: string): boolean {
  const [a, m, d] = fechaISO.split('-').map(Number);
  const diaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 domingo, 6 sabado
  if (diaSemana === 0 || diaSemana === 6) return false;

  const ultimoDelMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  // Es el ultimo habil si todos los dias que quedan del mes caen en fin de semana.
  for (let siguiente = d + 1; siguiente <= ultimoDelMes; siguiente++) {
    const ds = new Date(Date.UTC(a, m - 1, siguiente)).getUTCDay();
    if (ds !== 0 && ds !== 6) return false;
  }
  return true;
}

/** A quien llega la planilla. Se puede cambiar sin tocar codigo con PLANILLA_DESTINATARIO. */
const DESTINATARIO = process.env.PLANILLA_DESTINATARIO || 'Franciscofuenzalidau@gmail.com';

/** Desde que hora se manda. Al final del dia, para que alcancen a cerrarse los servicios. */
const HORA_DE_ENVIO = '18:00';

/** Cada cuanto se revisa, para no consultar la base en cada golpe del health check. */
const MINUTOS_ENTRE_REVISIONES = 30;
let ultimaRevision = 0;
let revisando = false;

/** True si hay credenciales SMTP de verdad. Sin ellas nodemailer no entrega nada. */
export function hayCorreoConfigurado(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Manda la planilla del mes el ultimo dia habil, una sola vez.
 *
 * Se dispara desde /health igual que la campana preventiva: Cloud Run apaga el contenedor cuando
 * no hay trafico, asi que el uptime check es el unico reloj confiable que hay.
 *
 * La marca de "ya enviado" vive en Firestore y no en memoria: el contenedor se reinicia varias
 * veces al dia y en memoria se mandaria la planilla una y otra vez.
 */
export async function tal_vez_enviar_planilla_mensual(): Promise<void> {
  if (!db) return;
  if (revisando) return;

  const ahora = Date.now();
  if (ahora - ultimaRevision < MINUTOS_ENTRE_REVISIONES * 60 * 1000) return;

  try {
    revisando = true;
    ultimaRevision = ahora;

    const { date: hoy, time: horaActual } = ahoraEnChile();
    if (!esUltimoDiaHabilDelMes(hoy)) return;
    if (horaActual < HORA_DE_ENVIO) return;

    const mes = hoy.slice(0, 7);
    const ref = db.collection('system_config').doc('planilla_mensual');
    const doc = await ref.get();
    if (doc.exists && doc.data()?.ultimo_mes_enviado === mes) return;

    if (!hayCorreoConfigurado()) {
      console.error(
        `[PLANILLA] Toca enviar la planilla de ${mes} pero NO hay credenciales SMTP configuradas ` +
        `(SMTP_HOST, SMTP_USER, SMTP_PASS). El correo no saldria: nodemailer caeria en una cuenta ` +
        `de prueba que no entrega nada. Se deja sin marcar para reintentar cuando se configuren.`
      );
      return;
    }

    const filas = await serviciosDelMes(mes);
    const archivo = await planillaDeServicios(mes, filas);
    const totalCLP = filas.reduce((a, f) => a + (f.cobradoCLP || 0), 0);

    const transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporte.sendMail({
      from: process.env.SMTP_USER,
      to: DESTINATARIO,
      subject: `Servicios completados ${mes} — Furtz Clima`,
      text:
        `Planilla de los servicios cerrados en ${mes}.\n\n` +
        `Servicios: ${filas.length}\n` +
        `Total cobrado: $${totalCLP.toLocaleString('es-CL')}\n\n` +
        `Solo incluye fichas marcadas como servicio completado. Si falta alguna, revisa el ` +
        `calendario: las visitas que ya pasaron y siguen sin cerrar aparecen en ambar.\n\n` +
        `Enviado automaticamente por Furtz Clima OS el ultimo dia habil del mes.`,
      attachments: [{
        filename: `servicios_furtz_${mes}.xlsx`,
        content: archivo,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }]
    });

    await ref.set({
      ultimo_mes_enviado: mes,
      enviado_el: new Date().toISOString(),
      destinatario: DESTINATARIO,
      servicios: filas.length
    }, { merge: true });

    console.log(`[PLANILLA] Enviada la planilla de ${mes} a ${DESTINATARIO} (${filas.length} servicios).`);
  } catch (err: any) {
    // No se marca como enviada: si fallo el correo, se reintenta en la siguiente revision.
    console.error('[PLANILLA] Error al enviar la planilla mensual:', err.message);
  } finally {
    revisando = false;
  }
}
