/**
 * Campaña de mantención preventiva anual.
 *
 * Antes esto vivía dentro de la ruta y solo corría cuando alguien apretaba el botón
 * del dashboard. Ahora la lógica está aquí para que la usen tres cosas:
 *   - el botón del dashboard,
 *   - el modo vista previa (mira a quién le llegaría, sin enviar nada),
 *   - el disparo automático diario.
 *
 * Reglas de seguridad, porque esto le escribe a clientes de verdad:
 *   - no se le reenvía a alguien que ya recibió la campaña hace menos de DIAS_ENTRE_ENVIOS,
 *   - no se le escribe a quien ya tiene una cita agendada,
 *   - no se le escribe a los números de los propios técnicos,
 *   - hay un tope de mensajes por corrida.
 */
import { db } from './firebase';
import { enviarWhatsApp } from './notificaciones';
import { TECNICOS } from './notificaciones';
import { clearSession } from './gemini';

/** No volver a ofrecer mantención al mismo cliente antes de este plazo. */
const DIAS_ENTRE_ENVIOS = 60;

/** Tope de mensajes por corrida, para que un error no se convierta en spam masivo. */
const TOPE_POR_CORRIDA = 25;

const TELEFONOS_TECNICOS = new Set(Object.values(TECNICOS));

export interface CandidatoCampana {
  phone: string;
  client_name?: string;
  motivo: string;
  ultimaAtencion: string | null;
}

function fechaValida(valor: any): Date | null {
  if (!valor) return null;
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Decide a quién le toca la mantención anual.
 * Función pura: recibe los leads y la fecha de referencia, no toca la base ni WhatsApp.
 */
export function seleccionarCandidatos(allLeads: any[], ahora: Date = new Date()): CandidatoCampana[] {
  const haceUnAno = new Date(ahora);
  haceUnAno.setFullYear(haceUnAno.getFullYear() - 1);

  const limiteReenvio = new Date(ahora);
  limiteReenvio.setDate(limiteReenvio.getDate() - DIAS_ENTRE_ENVIOS);

  const candidatos: CandidatoCampana[] = [];

  for (const lead of allLeads) {
    if (!lead.phone) continue;

    // Nunca escribirle a los técnicos de la propia empresa.
    if (TELEFONOS_TECNICOS.has(String(lead.phone))) continue;

    // Si ya tiene visita agendada o el cliente pidió no seguir, no se le ofrece nada.
    if (lead.appointment_time) continue;
    if (lead.status === 'Cancelado' || lead.status === 'derivado_ventas') continue;

    // Anti-duplicado: si ya recibió la campaña hace poco, se salta.
    const enviadaAntes = fechaValida(lead.campaign_sent_at);
    if (enviadaAntes && enviadaAntes > limiteReenvio) continue;

    let motivo = '';
    let ultimaAtencion: string | null = null;

    const instalacion = fechaValida(lead.installation_date);
    const mantencion = fechaValida(lead.last_maintenance_date);

    // La referencia es la atención MÁS RECIENTE: si se le hizo mantención el año
    // pasado, da igual que la instalación sea de hace tres años.
    const ultima = [instalacion, mantencion].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];

    if (ultima) {
      if (ultima < haceUnAno) {
        const esInstalacion = instalacion && ultima.getTime() === instalacion.getTime();
        motivo = esInstalacion
          ? `Instalado el ${ultima.toLocaleDateString('es-CL')}, sin mantención registrada desde entonces`
          : `Última mantención el ${ultima.toLocaleDateString('es-CL')}`;
        ultimaAtencion = ultima.toISOString().slice(0, 10);
      } else {
        // Tiene atención dentro del último año: todavía no le toca.
        continue;
      }
    } else {
      // Sin fechas: se usa lo que el cliente contó por chat.
      const info = String(lead.last_maintenance_info || '').toLowerCase();
      if (info.includes('nunca') || /a[nñ]o/.test(info)) {
        motivo = `Sin fecha registrada; el cliente indicó: "${lead.last_maintenance_info}"`;
      } else {
        continue;
      }
    }

    candidatos.push({
      phone: String(lead.phone),
      client_name: lead.client_name,
      motivo,
      ultimaAtencion
    });
  }

  return candidatos;
}

export function armarMensaje(lead: any): string {
  const equipos = lead.equipment_count && lead.equipment_count > 1
    ? `tus ${lead.equipment_count} equipos`
    : 'tu equipo';
  const referencia = lead.service_type === 'installation'
    ? `se cumple un año desde que instalamos ${equipos} de aire acondicionado`
    : `se cumple un año desde la última mantención de ${equipos} de aire acondicionado`;

  return (
    `¡Hola! 👋 Te saluda el asistente virtual de *Furtz Clima*.\n\n` +
    `Queremos contarte que ${referencia}. 🗓️\n\n` +
    `Para mantener su rendimiento, evitar fallas y prolongar su vida útil, te recomendamos realizar la *mantención preventiva anual*.\n\n` +
    `¿Te gustaría agendar tu visita? Respóndenos *SÍ* a este mensaje y coordinamos día y hora según nuestra disponibilidad. 😊`
  );
}

export async function cargarLeads(): Promise<any[]> {
  if (!db) return [];
  const snapshot = await db.collection('leads').get();
  const leads: any[] = [];
  snapshot.forEach(doc => leads.push({ phone: doc.id, ...doc.data() }));
  return leads;
}

export interface ResultadoCampana {
  preview: boolean;
  candidatos: number;
  enviados: number;
  fallidos: Array<{ phone: string; motivo: string }>;
  detalle: CandidatoCampana[];
}

/**
 * Corre la campaña. Con `preview: true` no envía nada: solo informa a quién le llegaría.
 */
export async function ejecutarCampanaPreventiva(
  opciones: { preview?: boolean; origen?: string } = {}
): Promise<ResultadoCampana> {
  const preview = opciones.preview === true;
  const origen = opciones.origen || 'manual';

  const allLeads = await cargarLeads();
  const porTelefono = new Map(allLeads.map(l => [String(l.phone), l]));
  const candidatos = seleccionarCandidatos(allLeads);
  const aEnviar = candidatos.slice(0, TOPE_POR_CORRIDA);

  if (preview) {
    return { preview: true, candidatos: candidatos.length, enviados: 0, fallidos: [], detalle: aEnviar };
  }

  const fallidos: Array<{ phone: string; motivo: string }> = [];
  let enviados = 0;

  for (const candidato of aEnviar) {
    const lead = porTelefono.get(candidato.phone);
    if (!lead) continue;

    const mensaje = armarMensaje(lead);
    const equipos = lead.equipment_count && lead.equipment_count > 1
      ? `tus ${lead.equipment_count} equipos`
      : 'tu equipo';

    const r = await enviarWhatsApp({
      to: candidato.phone,
      texto: mensaje,
      plantilla: { nombre: 'recordatorio_mantencion_anual', variables: [equipos] }
    });

    if (!r.enviado) {
      console.error(`[CAMPAÑA ${origen}] Falló para +${candidato.phone}: ${r.motivo}`);
      fallidos.push({ phone: candidato.phone, motivo: r.motivo || 'desconocido' });
      continue;
    }

    console.log(`[CAMPAÑA ${origen}] Enviada a +${candidato.phone} vía ${r.via}`);

    // El mensaje se guarda en la conversación: si el cliente responde "SÍ", el bot
    // sabe qué se le ofreció y no lo trata como si escribiera por primera vez.
    const conversacionPrevia = Array.isArray(lead.conversation) ? lead.conversation : [];
    const ahoraISO = new Date().toISOString();

    const updateData: Record<string, any> = {
      notes: (lead.notes ? lead.notes + '\n' : '') +
        `[Campaña Preventiva]: Oferta enviada el ${new Date().toLocaleDateString('es-CL')} (${origen}).`,
      last_maintenance_info: lead.last_maintenance_info || 'Hace más de 1 año',
      status: lead.status || 'Pendiente',
      service_type: lead.service_type || 'maintenance',
      conversation: [...conversacionPrevia, { role: 'model', text: mensaje }].slice(-60),
      last_message_at: ahoraISO,
      campaign_sent_at: ahoraISO
    };

    if (db) {
      await db.collection('leads').doc(candidato.phone).update(updateData).catch(() => {});
    }

    // El bot tiene la conversación en memoria; se limpia para que relea la base
    // y vea el mensaje de campaña que acabamos de enviar.
    clearSession(candidato.phone);
    enviados++;
  }

  return { preview: false, candidatos: candidatos.length, enviados, fallidos, detalle: aEnviar };
}

/**
 * Disparo automático diario.
 *
 * Cloud Run apaga el contenedor cuando no hay tráfico, así que no sirve un temporizador
 * en memoria. En vez de eso se aprovecha el uptime check, que golpea /health cada minuto:
 * en cada golpe se pregunta si ya corrió hoy, y si no, corre.
 *
 * Queda APAGADA salvo que CAMPANA_AUTOMATICA sea "true", para que nadie le escriba a
 * clientes reales por accidente.
 */
let corriendo = false;

export async function tal_vez_correr_campana_diaria(): Promise<void> {
  if (process.env.CAMPANA_AUTOMATICA !== 'true') return;
  if (corriendo || !db) return;

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // YYYY-MM-DD
  const ref = db.collection('config').doc('campana_preventiva');

  try {
    corriendo = true;

    const doc = await ref.get();
    if (doc.exists && doc.data()?.ultima_corrida === hoy) return;

    // Solo en horario hábil de Chile: nadie quiere ofertas a las 3 de la mañana.
    const horaChile = Number(
      new Date().toLocaleString('en-US', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false })
    );
    if (horaChile < 9 || horaChile >= 19) return;

    // Se marca ANTES de enviar: si algo falla a mitad de camino, no se reintenta
    // en el siguiente golpe del health check y se evita el envío duplicado.
    await ref.set({ ultima_corrida: hoy, iniciada_a: new Date().toISOString() }, { merge: true });

    const r = await ejecutarCampanaPreventiva({ origen: 'automática' });
    console.log(`[CAMPAÑA automática] ${r.enviados} enviados de ${r.candidatos} candidatos.`);

    await ref.set({ ultimo_resultado: { enviados: r.enviados, candidatos: r.candidatos } }, { merge: true });
  } catch (err: any) {
    console.error('[CAMPAÑA automática] Error:', err.message);
  } finally {
    corriendo = false;
  }
}
