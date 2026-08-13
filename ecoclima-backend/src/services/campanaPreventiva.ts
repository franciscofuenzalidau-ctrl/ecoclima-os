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
import { cuposLibres, etiquetaDeFecha, leerConfigAgenda, Slot } from './agenda';

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

// ---------------------------------------------------------------------------
// Seguimiento a las 24 h
//
// Si al día siguiente el cliente no contestó la oferta, se le insiste UNA vez,
// esta vez con los días concretos que hay libres para que solo tenga que elegir.
// ---------------------------------------------------------------------------

/** Horas desde el envío de la campaña antes de insistir. */
const HORAS_PARA_SEGUIMIENTO = 24;

/** Cuántas opciones concretas de día y hora se le ofrecen en el mensaje. */
const OPCIONES_A_OFRECER = 3;

function respondioDespuesDe(lead: any, desde: Date): boolean {
  // Basta con que exista cualquier mensaje del cliente en la conversación guardada:
  // la campaña se escribe como 'model', así que un 'user' posterior es respuesta suya.
  if (!Array.isArray(lead.conversation)) return false;
  const idx = lead.conversation.findIndex(
    (m: any) => m?.role === 'model' && String(m.text || '').includes('mantención preventiva anual')
  );
  const posteriores = idx >= 0 ? lead.conversation.slice(idx + 1) : lead.conversation;
  return posteriores.some((m: any) => m?.role === 'user');
}

export function seleccionarParaSeguimiento(allLeads: any[], ahora: Date = new Date()): CandidatoCampana[] {
  const limite = new Date(ahora.getTime() - HORAS_PARA_SEGUIMIENTO * 60 * 60 * 1000);
  const salida: CandidatoCampana[] = [];

  for (const lead of allLeads) {
    if (!lead.phone) continue;
    if (TELEFONOS_TECNICOS.has(String(lead.phone))) continue;

    // Ya agendó, lo cancelaron o lo tomó una persona: no se insiste.
    if (lead.appointment_time) continue;
    if (lead.status === 'Cancelado' || lead.status === 'derivado_ventas' || lead.status === 'Agendado') continue;

    // Solo a quien se le mandó la campaña y ya pasaron las 24 h.
    const enviada = fechaValida(lead.campaign_sent_at);
    if (!enviada || enviada > limite) continue;

    // Se insiste UNA sola vez.
    if (lead.followup_sent_at) continue;

    let motivo: string;

    if (respondioDespuesDe(lead, enviada)) {
      // Contestó pero no llegó a agendar. Si la conversación sigue caliente se la deja
      // correr; si lleva más de 24 h detenida, se enfrió y hay que retomarla.
      //
      // Este es el caso más valioso de todos: alguien que YA mostró interés y quedó a
      // medio camino. Antes quedaba en tierra de nadie —no recibía seguimiento por haber
      // respondido, y no avanzaba porque nadie lo retomaba— y la venta se perdía sola.
      const ultimoMensaje = fechaValida(lead.last_message_at);
      if (!ultimoMensaje || ultimoMensaje > limite) continue;
      motivo = `Conversó pero no agendó; última actividad el ${ultimoMensaje.toLocaleDateString('es-CL')}`;
    } else {
      motivo = `Sin respuesta desde el ${enviada.toLocaleDateString('es-CL')}`;
    }

    salida.push({
      phone: String(lead.phone),
      client_name: lead.client_name,
      motivo,
      ultimaAtencion: null
    });
  }

  return salida;
}

function armarMensajeSeguimiento(lead: any, disponibles: Slot[]): string {
  // Numeradas y con UNA hora por línea: si van dos horas juntas ("09:15 o 14:00") y el
  // cliente responde "la primera", no se sabe cuál eligió y hay que preguntarle de nuevo.
  const lineas = disponibles
    .slice(0, OPCIONES_A_OFRECER)
    .map((c, i) => `${i + 1}) ${c.label}`)
    .join('\n');

  const equipos = lead.equipment_count && lead.equipment_count > 1 ? 'tus equipos' : 'tu equipo';

  return (
    `¡Hola de nuevo! 👋 Soy el asistente de *Furtz Clima*.\n\n` +
    `Te escribí por la *mantención preventiva anual* de ${equipos}. ` +
    `Para hacértelo más fácil, estos son los horarios que tenemos libres:\n\n` +
    `${lineas}\n\n` +
    `Respóndeme con el número de la opción que prefieras y te dejo la visita agendada al instante. 😊\n\n` +
    `Si ninguno te acomoda, dime qué día te sirve y busco disponibilidad.`
  );
}

export async function ejecutarSeguimiento24h(
  opciones: { preview?: boolean } = {}
): Promise<ResultadoCampana> {
  const preview = opciones.preview === true;
  const allLeads = await cargarLeads();
  const porTelefono = new Map(allLeads.map(l => [String(l.phone), l]));
  const candidatos = seleccionarParaSeguimiento(allLeads);
  const aEnviar = candidatos.slice(0, TOPE_POR_CORRIDA);

  if (preview) {
    return { preview: true, candidatos: candidatos.length, enviados: 0, fallidos: [], detalle: aEnviar };
  }
  if (aEnviar.length === 0) {
    return { preview: false, candidatos: 0, enviados: 0, fallidos: [], detalle: [] };
  }

  // Los cupos se leen UNA vez y se reparten entre todos: si se leyeran por cliente,
  // dos personas podrían recibir el mismo horario como "libre" en la misma corrida.
  const ocupados: string[] = [];
  for (const l of allLeads) {
    if (l.appointment_iso && l.status !== 'Cancelado') ocupados.push(l.appointment_iso);
  }
  const configAgenda = await leerConfigAgenda();
  const disponibles = cuposLibres(ocupados, 21, new Date(), configAgenda);

  if (disponibles.length === 0) {
    console.log('[SEGUIMIENTO] No hay cupos libres: no se insiste para no ofrecer lo que no existe.');
    return { preview: false, candidatos: candidatos.length, enviados: 0, fallidos: [], detalle: aEnviar };
  }

  const fallidos: Array<{ phone: string; motivo: string }> = [];
  let enviados = 0;

  for (const candidato of aEnviar) {
    const lead = porTelefono.get(candidato.phone);
    if (!lead) continue;

    const mensaje = armarMensajeSeguimiento(lead, disponibles);
    const equipos = lead.equipment_count && lead.equipment_count > 1
      ? `tus ${lead.equipment_count} equipos`
      : 'tu equipo';

    // Se intenta el texto con los horarios concretos. Si la ventana de 24 h de Meta
    // está cerrada —lo habitual con quien no contestó— cae a la plantilla aprobada,
    // que sí puede entrar pero no lleva los días dentro.
    const r = await enviarWhatsApp({
      to: candidato.phone,
      texto: mensaje,
      plantilla: { nombre: 'recordatorio_mantencion_anual', variables: [equipos] },
      preferirTexto: true
    });

    if (!r.enviado) {
      console.error(`[SEGUIMIENTO] Falló para +${candidato.phone}: ${r.motivo}`);
      fallidos.push({ phone: candidato.phone, motivo: r.motivo || 'desconocido' });
      continue;
    }

    console.log(`[SEGUIMIENTO] Insistencia enviada a +${candidato.phone} vía ${r.via}`);

    const conversacionPrevia = Array.isArray(lead.conversation) ? lead.conversation : [];
    const ahoraISO = new Date().toISOString();

    const updateData: Record<string, any> = {
      notes: (lead.notes ? lead.notes + '\n' : '') +
        `[Seguimiento 24h]: Segundo aviso con horarios enviado el ${new Date().toLocaleDateString('es-CL')}.`,
      conversation: [...conversacionPrevia, { role: 'model', text: mensaje }].slice(-60),
      last_message_at: ahoraISO,
      followup_sent_at: ahoraISO
    };

    if (db) {
      await db.collection('leads').doc(candidato.phone).update(updateData).catch(() => {});
    }
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

    // En la misma pasada se insiste con quienes no contestaron la oferta de ayer.
    const s = await ejecutarSeguimiento24h();
    if (s.candidatos > 0) {
      console.log(`[SEGUIMIENTO automático] ${s.enviados} insistencias de ${s.candidatos} sin respuesta.`);
    }

    await ref.set({
      ultimo_resultado: {
        enviados: r.enviados,
        candidatos: r.candidatos,
        seguimientos: s.enviados
      }
    }, { merge: true });
  } catch (err: any) {
    console.error('[CAMPAÑA automática] Error:', err.message);
  } finally {
    corriendo = false;
  }
}
