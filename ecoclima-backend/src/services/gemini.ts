import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { aiLogger } from './aiLogger';
import { db } from './firebase';
import {
  ahoraEnChile, cuposLibres, detectarCupoElegido, detectarCupoPorOrdinal,
  cuposMencionadosEnOrden, etiquetaDeFecha, leerConfigAgenda, Slot
} from './agenda';
import { avisarAdministrador, TECNICO_POR_DEFECTO } from './notificaciones';

dotenv.config();

/** WhatsApp de Pilar, la ejecutiva: el único canal humano que se le ofrece al cliente. */
const WHATSAPP_PILAR = 'https://wa.me/56961897021';

/**
 * Cierre del flujo de VENTA. Va en TODOS los mensajes a propósito: quien escribe puede ser un
 * desconocido que llegó por error, y siempre tiene que tener una salida a la vista.
 */
const FRASE_AYUDA_VENTA = `Si no quieres mantención o venta de aire acondicionado, contáctate con nuestros ejecutivos acá: ${WHATSAPP_PILAR}`;

/**
 * Cierre para quien YA es cliente de Furtz: encuesta post-servicio y recordatorio anual.
 * Va UNA sola vez, en la despedida. Repetirlo en cada pregunta de la encuesta era ruido puro,
 * y encima el texto de venta no tiene ningún sentido para alguien a quien acabamos de atender.
 */
const FRASE_CIERRE_CLIENTE = `Si necesitas algún servicio adicional o tuviste algún inconveniente, puedes comunicarte con nuestra ejecutiva Pilar acá: ${WHATSAPP_PILAR}`;

// Helper to load rules dynamically
function loadConfigRules(): any {
  const configPath = path.resolve(process.cwd(), 'data_mock', 'config_reglas.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.error('Error al cargar config_reglas.json en gemini service:', err);
    }
  }
  // Fallback defaults
  return {
    btu_matrix: [
      { max_m2: 18, btu: "9.000 BTU" },
      { max_m2: 24, btu: "12.000 BTU" },
      { max_m2: 36, btu: "18.000 BTU" },
      { max_m2: 48, btu: "24.000 BTU" },
      { max_m2: 72, btu: "36.000 BTU" }
    ],
    brands: { primary: "Clark", alternatives: [] },
    installation_cost: { min: 100000, max: 150000 },
    maintenance_cost: 40000,
    feasibility_visit_cost: 5000,
    pricing_matrix: {
      "9.000 BTU": { economicas: "250.000 a 300.000", intermedias: "290.000 a 380.000", premium: "400.000 a 580.000" },
      "12.000 BTU": { economicas: "290.000 a 340.000", intermedias: "340.000 a 460.000", premium: "480.000 a 750.000" },
      "18.000 BTU": { economicas: "430.000 a 520.000", intermedias: "490.000 a 650.000", premium: "620.000 a 930.000" },
      "24.000 BTU": { economicas: "560.000 a 660.000", intermedias: "650.000 a 800.000", premium: "750.000 a 1.200.000" },
      "36.000 BTU": { economicas: "900.000 a 1.150.000", intermedias: "1.250.000 a 1.700.000", premium: "1.600.000 a 2.200.000+" }
    }
  };
}

// User conversation session storage (in-memory helper)
interface UserSession {
  history: Array<{ 
    role: 'user' | 'model'; 
    parts: Array<
      { text: string } | 
      { inlineData: { data: string; mimeType: string } }
    >;
  }>;
  leadData: {
    service_type?: 'installation' | 'maintenance';
    installation_age?: string;
    address?: string;
    appointment_time?: string;
    /** Cupo agendado en formato `YYYY-MM-DDTHH:mm` (hora de Chile). Lo usa el calendario. */
    appointment_iso?: string;
    latitude?: number;
    longitude?: number;
    area_m2?: number;
    calculated_btu?: string;
    notes?: string;
    status?: string;
    last_maintenance_info?: string;
    is_working_correctly?: boolean;
    installation_date?: string;
    last_maintenance_date?: string;
    satisfaction_rating?: number;
    satisfaction_comment?: string;
    client_type?: 'empresa' | 'particular';
    contact_phone?: string;
    equipment_count?: number;
    payment_method?: string;
    /** Técnico asignado. El bot lo fija al agendar para poder avisarle. */
    technician?: string;
    /** Quién tomó la hora: el propio bot o alguien desde el panel. */
    booked_by?: 'bot' | 'panel';
    /** Cuándo se agendó, en ISO. */
    booked_at?: string;
  };
}

const sessions: Map<string, UserSession> = new Map();

// Cuántos mensajes de la conversación se guardan en el lead.
const MAX_STORED_MESSAGES = 60;

// Campos del lead que hay que recuperar desde la base de datos al reiniciar el servidor.
const HYDRATED_FIELDS = [
  'service_type', 'installation_age', 'address', 'appointment_time', 'appointment_iso', 'latitude', 'longitude',
  'area_m2', 'calculated_btu', 'notes', 'status', 'last_maintenance_info', 'is_working_correctly',
  'installation_date', 'last_maintenance_date', 'satisfaction_rating', 'satisfaction_comment',
  'client_type', 'contact_phone', 'equipment_count', 'payment_method', 'technician',
  'booked_by', 'booked_at'
] as const;

// Helper to get or create session
function getOrCreateSession(phone: string): UserSession {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      history: [],
      leadData: {}
    });
  }
  return sessions.get(phone)!;
}

// Olvida la conversación en memoria de un cliente. Se usa al eliminar un lead desde el
// dashboard: sin esto, el bot seguiría recordando el chat de una ficha ya borrada.
export function clearSession(phone: string): boolean {
  return sessions.delete(phone.replace(/\D/g, ''));
}

// Convierte el historial de Gemini a algo guardable y legible en el dashboard.
// Las fotos NO se guardan (pesan demasiado y revientan el documento): se deja una marca.
function serializeHistory(history: UserSession['history']) {
  return history
    .slice(-MAX_STORED_MESSAGES)
    .map(turn => ({
      role: turn.role,
      text: turn.parts
        .map(part => ('text' in part ? part.text : '[Foto enviada por el cliente]'))
        .join(' ')
        .trim()
    }))
    .filter(m => m.text.length > 0);
}

// Reconstruye la sesión desde la base de datos.
//
// Cloud Run se apaga solo cuando no hay mensajes, y con él se borraba la memoria del bot:
// el cliente que respondía 15 minutos después se encontraba con un bot que lo saludaba
// de nuevo desde cero. Peor aún, la sesión vacía sobrescribía con null los datos que ya
// estaban guardados. Esto arregla las dos cosas.
function hydrateSession(session: UserSession, existingLead: any) {
  if (!existingLead) return;

  for (const field of HYDRATED_FIELDS) {
    const current = (session.leadData as any)[field];
    const stored = existingLead[field];
    if ((current === undefined || current === null) && stored !== undefined && stored !== null) {
      (session.leadData as any)[field] = stored;
    }
  }

  if (session.history.length === 0 && Array.isArray(existingLead.conversation)) {
    session.history = existingLead.conversation
      .filter((m: any) => m && typeof m.text === 'string' && m.text.trim().length > 0)
      .map((m: any) => ({
        role: m.role === 'model' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.text as string }]
      }));

    if (session.history.length > 0) {
      console.log(`[SESIÓN] Conversación restaurada desde la base de datos: ${session.history.length} mensajes.`);
    }
  }
}

async function getExistingLead(phone: string): Promise<any> {
  const cleanPhone = phone.replace(/\D/g, '');
  if (db) {
    try {
      const doc = await db.collection('leads').doc(cleanPhone).get();
      if (doc.exists) {
        return doc.data();
      }
    } catch (e) {
      console.error('Error fetching existing lead from Firestore:', e);
    }
  }
  try {
    const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
    if (fs.existsSync(mockLeadsPath)) {
      const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
      return mockData.find((item: any) => item.phone === cleanPhone) || null;
    }
  } catch (e) {
    console.error('Error reading existing lead from mock:', e);
  }
  return null;
}

/** Identificadores de cupo ya tomados (`appointment_iso`), para no ofrecerlos dos veces. */
/**
 * Verbos con los que el bot cierra una cita. Se usa la raíz "agend" porque el modelo
 * varía la forma cada vez: "agendaré", "agendaremos", "queda agendada", "agendado".
 */
const CONFIRMA_CITA = /\b(agend\w*|confirmad\w*|reservad\w*)\b/i;

/**
 * Cuando el cliente deja que el bot elija ("cualquiera", "el que sea"), la fecha solo
 * existe en la respuesta del bot. Esta función la rescata para poder guardarla.
 *
 * Tres filtros para no agendar por error algo que el bot solo estaba ofreciendo:
 *   1. el texto usa un verbo de cierre,
 *   2. NO es una pregunta —si pregunta, está ofreciendo y espera respuesta—,
 *   3. menciona UN solo cupo de la lista.
 * El filtro 2 es el que evita el caso peligroso: cuando queda un único cupo libre y el
 * bot pregunta "¿te sirve el lunes 24 a las 09:15?", eso no es una cita cerrada.
 */
function detectarCupoConfirmadoPorElBot(replyText: string, disponibles: Slot[]): Slot | null {
  if (!replyText || !CONFIRMA_CITA.test(replyText)) return null;

  // Se ignora el enlace de ayuda del pie, que va en todos los mensajes.
  const cuerpo = replyText.split('Si no quieres mantención')[0];
  if (cuerpo.includes('?') || cuerpo.includes('¿')) return null;

  const texto = cuerpo.toLowerCase();

  const mencionados = disponibles.filter(c => {
    // La etiqueta tal cual ("lunes 24 de agosto de 2026 a las 14:00")...
    if (texto.includes(c.label.toLowerCase())) return true;
    // ...o el día y la hora sueltos, tolerando el formato que use el modelo.
    const diaNum = Number(c.date.split('-')[2]);
    const patron = new RegExp(`\\b${diaNum}\\b[^.\\n]{0,60}?${c.time.replace(':', '[:.]')}`, 'i');
    return patron.test(texto);
  });

  return mencionados.length === 1 ? mencionados[0] : null;
}

async function getOccupiedSlotIds(): Promise<string[]> {
  const ocupados: string[] = [];
  if (db) {
    try {
      const snapshot = await db.collection('leads').get();
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data && data.appointment_iso && data.status !== 'Cancelado') {
          ocupados.push(data.appointment_iso);
        }
      });
      return ocupados;
    } catch (e) {
      console.error('Error fetching occupied slots from Firestore:', e);
    }
  }
  try {
    const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
    if (fs.existsSync(mockLeadsPath)) {
      const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
      mockData.forEach((item: any) => {
        if (item.appointment_iso && item.status !== 'Cancelado') {
          ocupados.push(item.appointment_iso);
        }
      });
    }
  } catch (e) {
    console.error('Error reading occupied slots from mock:', e);
  }
  return ocupados;
}

// Helper to notify Executive Pilar via WhatsApp Cloud API
async function notifyExecutivePilar(clientPhone: string, leadData: any) {
  try {
    const pilarPhone = '56961897021';
    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!whatsappToken || !phoneId) {
      console.log(`[SIMULACIÓN ALERTA PILAR] Alerta a ${pilarPhone} sobre cliente +${clientPhone}`);
      return;
    }

    const messageText = `🚨 *Alerta de Bot ECOCLIMA OS* 🚨\n\nEl cliente +${clientPhone} requiere tu asistencia humana.\n\n*Datos Recolectados hasta el momento:*\n- Servicio: ${leadData.service_type === 'installation' ? 'Instalación/Venta' : leadData.service_type === 'maintenance' ? 'Mantenimiento' : 'No definido'}\n- BTU/Capacidad: ${leadData.calculated_btu || 'N/A'}\n- Área: ${leadData.area_m2 ? leadData.area_m2 + ' m2' : 'N/A'}\n- Dirección: ${leadData.address || 'N/A'}\n- Fecha solicitada: ${leadData.appointment_time || 'N/A'}\n- Notas del Chat: ${leadData.notes || 'N/A'}\n\n*Por favor, asiste a este cliente desde tu WhatsApp de empresa.*`;

    const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to: pilarPhone,
      type: 'text',
      text: { body: messageText }
    }, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${whatsappToken}` }
    });
    console.log(`[WHATSAPP REAL] Alerta de derivación enviada a Pilar (+${pilarPhone}) para el cliente ${clientPhone}`);
  } catch (error: any) {
    console.error(`Error al enviar alerta a Pilar:`, error.response?.data || error.message);
  }
}

// Helper to notify assigned technician when a client shares their location
async function notifyTechnicianOfLocation(clientPhone: string, technicianName: string, lat: number, lng: number, address: string) {
  try {
    // Solo técnicos con número REAL verificado. No agregar números de relleno:
    // si el técnico no está aquí, la ubicación simplemente no se reenvía (y queda en el log).
    const techPhones: { [key: string]: string } = {
      'francisco': '56990939188'
    };

    const cleanName = technicianName.toLowerCase().trim();
    const techPhone = techPhones[cleanName];
    if (!techPhone) {
      console.log(`[NOTIFICACIÓN TÉCNICO] No se encontró número para el técnico "${technicianName}" al reenviar ubicación.`);
      return;
    }

    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const messageText = `📍 *Ubicación Recibida*\n\nEl cliente +${clientPhone} acaba de compartir su ubicación exacta por GPS.\n\nDirección aproximada: ${address}\n\nAbre este enlace para verlo en el mapa o iniciar tu navegación:\n👉 ${mapsLink}`;

    if (whatsappToken && phoneId) {
      const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
      await axios.post(
        url,
        { messaging_product: 'whatsapp', to: techPhone, type: 'text', text: { body: messageText } },
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${whatsappToken}` } }
      );
      console.log(`[WHATSAPP REAL] Ubicación reenviada con éxito al técnico ${technicianName} (+${techPhone})`);
    } else {
      console.log(`\n[SIMULACIÓN NOTIFICACIÓN TÉCNICO] Para: ${technicianName} (+${techPhone})\nMensaje:\n${messageText}\n`);
    }
  } catch (error: any) {
    console.error(`Error al enviar ubicación al técnico:`, error.response?.data || error.message);
  }
}


/** Cada cuántas horas se repite el aviso mientras la falla de cuota siga viva. */
const HORAS_ENTRE_AVISOS_DE_CUOTA = 6;

/**
 * Distingue "se acabó la cuota / falló la facturación" de cualquier otro fallo de red.
 * Importa porque son dos incidentes muy distintos: el de red se arregla solo, el de cuota
 * deja al bot mudo hasta que alguien recargue. Antes los dos se veían exactamente igual.
 */
function esErrorDeCuota(err: unknown): boolean {
  const e = err as any;
  const estado = e?.status ?? e?.code ?? e?.response?.status;
  if (estado === 429) return true;
  const partes = [e?.message, e?.response?.data ? JSON.stringify(e.response.data) : ''];
  const texto = partes.join(' ').toLowerCase();
  return texto.includes('429') || texto.includes('resource_exhausted') || texto.includes('quota');
}

/**
 * Avisa a Francisco cuando Gemini deja de responder por cuota agotada.
 *
 * Antes un 429 se veía idéntico a un corte de red pasajero: el cliente recibía una disculpa
 * genérica y nadie se enteraba, y así el bot estuvo caído semanas. El antirrepetición vive en
 * Firestore y no en memoria porque Cloud Run se apaga entre conversaciones, y un contador en
 * memoria se reiniciaría en cada arranque mandando un aviso por cada cliente que escriba.
 */
async function avisarSiEsCuotaAgotada(err: unknown): Promise<void> {
  if (!esErrorDeCuota(err)) return;

  const detalle = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  // Marca fija y reconocible, para poder montarle encima una alerta de Cloud Monitoring.
  console.error('[ALERTA CUOTA GEMINI] El bot no puede responder a los clientes: ' + detalle);

  const ahora = Date.now();
  try {
    if (db) {
      const ref = db.collection('system_alerts').doc('gemini_quota');
      const doc = await ref.get();
      const ultimo = doc.exists ? Date.parse(doc.data()?.last_notified_at || '') : NaN;
      if (!Number.isNaN(ultimo) && ahora - ultimo < HORAS_ENTRE_AVISOS_DE_CUOTA * 3600000) return;
      await ref.set({
        last_notified_at: new Date(ahora).toISOString(),
        detalle,
        estado: 'gemini sin cuota'
      }, { merge: true });
    }

    const mensaje = `🚨 EcoClima OS: el bot NO está respondiendo a los clientes.

Gemini está rechazando las llamadas por cuota agotada o problema de facturación (error 429). Mientras siga así, cada cliente que escriba va a recibir una disculpa genérica.

Revisa el saldo en Google Cloud → Facturación, proyecto ecoclima-os-7ca1b, servicio "Generative Language API".

Detalle técnico: ${detalle}`;

    const r = await avisarAdministrador(mensaje);
    if (!r.enviado) {
      console.error('[ALERTA CUOTA GEMINI] No se pudo avisar por WhatsApp: ' + r.motivo);
    }
  } catch (e) {
    console.error('[ALERTA CUOTA GEMINI] Falló el envío del aviso:', e instanceof Error ? e.message : e);
  }
}

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY no está configurada en las variables de entorno.');
    }
    // Initialize the new Google Gen AI SDK
    this.ai = new GoogleGenAI({ apiKey });
  }

  // Reverse Geocoding with Google Maps
  private async reverseGeocode(lat: number, lng: number): Promise<string> {
    const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!mapsApiKey) return 'Dirección GPS no disponible (sin API Key)';
    
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsApiKey}`;
      const response = await axios.get(url);
      if (response.data && response.data.results && response.data.results.length > 0) {
        return response.data.results[0].formatted_address;
      }
      return `Coordenadas (${lat}, ${lng})`;
    } catch (err) {
      console.error('Error al geocodificar dirección:', err);
      return `Coordenadas (${lat}, ${lng})`;
    }
  }

  // Handle WhatsApp messages, GPS coordinates, and images
  public async handleUserMessage(
    phone: string,
    message: string,
    location?: { latitude: number; longitude: number },
    image?: { base64Data: string; mimeType: string }
  ): Promise<string> {
    const cleanPhone = phone.replace(/\D/g, '');
    const session = getOrCreateSession(cleanPhone);

    // El teléfono de contacto es el mismo desde el que escribe el cliente: se registra solo.
    // Por eso el bot ya NO lo pregunta.
    session.leadData.contact_phone = cleanPhone;

    // 1. Fetch existing lead to check pause state
    const existingLead = await getExistingLead(cleanPhone);
    if (existingLead && existingLead.status === 'derivado_ventas') {
      console.log(`[GEMINI SERVICE] Bot pausado para el teléfono +${cleanPhone} (estado: derivado_ventas)`);
      return ''; // Empty return to pause bot response
    }

    // Recuperar conversación y datos previos antes de seguir (ver hydrateSession).
    hydrateSession(session, existingLead);

    // Captura de respuestas a la encuesta de satisfacción (servicio ya completado)
    // El estado "Instalado" no es la única vía: la encuesta también se dispara a mano desde el
    // panel sin tocar el estado (POST /leads/:phone/send-survey). En esos casos el bot no hacía
    // las preguntas y las respuestas del cliente se perdían sin dejar rastro.
    const surveyMode = !!(existingLead && (existingLead.status === 'Instalado' || existingLead.survey_sent_at));
    if (surveyMode && message) {
      const ratingMatch = message.trim().match(/^([1-7])\b/);
      if (ratingMatch && !existingLead.satisfaction_rating) {
        session.leadData.satisfaction_rating = parseInt(ratingMatch[1], 10);
      }
      // Solo acumular como testimonio desde que ya hay nota: antes de eso el cliente
      // está respondiendo la forma de pago, que no debe ensuciar el comentario.
      const hasRating = !!(existingLead.satisfaction_rating || session.leadData.satisfaction_rating);
      if (hasRating) {
        const prev = existingLead.satisfaction_comment ? existingLead.satisfaction_comment + ' | ' : '';
        session.leadData.satisfaction_comment = (prev + message).slice(0, 800);
      }
    }

    // If geolocation is received
    if (location) {
      session.leadData.latitude = location.latitude;
      session.leadData.longitude = location.longitude;
      const address = await this.reverseGeocode(location.latitude, location.longitude);
      session.leadData.address = address;

      aiLogger.logEvent(cleanPhone, 'location_received', `Recibió ubicación GPS y resolvió dirección: "${address}"`, 10, 500);

      // If a technician is already assigned to this client, forward the location
      if (existingLead && existingLead.technician) {
        notifyTechnicianOfLocation(cleanPhone, existingLead.technician, location.latitude, location.longitude, address).catch(err => {
          console.error("Error forwarding location to technician:", err);
        });
      }

      // La ubicación entra a la conversación como un mensaje más del cliente y el flujo
      // SIGUE hasta Gemini, que continúa con el paso siguiente (ofrecer horarios).
      //
      // Antes esto respondía con un texto fijo y hacía `return`: el bot acusaba recibo
      // de la ubicación y se quedaba mudo. El cliente esperaba los horarios que nunca
      // llegaban, y la conversación moría justo antes de agendar.
      message = `[Te compartí mi ubicación por GPS. La dirección para la visita es: ${address}]`;
    }

    // Load config dynamically for each execution to pick up dollar adjustments
    const config = loadConfigRules();
    const salesPhone = config.sales_phone || '56990939188';

    // Agenda real: cupos que existen de verdad, en hora de Chile, descontando los tomados.
    // Antes aquí solo iban los horarios OCUPADOS y nunca se le decía a Gemini qué día era
    // hoy, así que el modelo inventaba fechas (llegó a ofrecer días de mayo en agosto).
    const [ocupados, configAgenda] = await Promise.all([getOccupiedSlotIds(), leerConfigAgenda()]);
    const disponibles = cuposLibres(ocupados, 21, new Date(), configAgenda);
    const hoyChile = etiquetaDeFecha(ahoraEnChile().date);
    // Se le pasa la agenda COMPLETA agrupada por día, no solo los primeros cupos.
    // Antes solo iban 8: si el cliente pedía un día más adelante, el bot creía que no
    // había disponibilidad y se la negaba existiendo.
    const porDia = new Map<string, string[]>();
    for (const c of disponibles) {
      if (!porDia.has(c.date)) porDia.set(c.date, []);
      porDia.get(c.date)!.push(c.time);
    }

    const calendarContext = disponibles.length > 0
      ? [...porDia.entries()]
          .map(([fecha, horas]) => `- ${etiquetaDeFecha(fecha)}: ${horas.join(', ')}`)
          .join('\n')
      : 'NO HAY CUPOS LIBRES. Deriva al cliente a la ejecutiva.';

    // Lo que ya sabemos de este cliente (de conversaciones anteriores o de su ficha).
    // Se lo pasamos al modelo para que no vuelva a preguntar lo mismo, sobre todo
    // cuando vuelve un año después por el recordatorio de mantención.
    const d = session.leadData;
    const datosConocidos = [
      d.client_type ? `- Es ${d.client_type}` : null,
      d.service_type ? `- Servicio: ${d.service_type === 'installation' ? 'Instalación' : 'Mantención'}` : null,
      d.address ? `- Dirección registrada: ${d.address}` : null,
      d.installation_age ? `- Antigüedad del equipo: ${d.installation_age}` : null,
      d.last_maintenance_info ? `- Última mantención: ${d.last_maintenance_info}` : null,
      d.equipment_count ? `- Cantidad de equipos: ${d.equipment_count}` : null,
      d.calculated_btu ? `- Capacidad: ${d.calculated_btu}` : null
    ].filter(Boolean).join('\n');

    // Si el cliente YA tiene hora —la haya tomado él por el chat o se la haya puesto
    // Pilar a mano desde el panel— hay que decírselo al modelo. Sin esto el bot no se
    // entera y le vuelve a ofrecer cupos a alguien que ya está agendado.
    const citaVigente = session.leadData.appointment_time || existingLead?.appointment_time || null;
    const bloqueCitaVigente = citaVigente
      ? `
⚠️ ESTE CLIENTE YA TIENE VISITA AGENDADA: ${citaVigente}
- NO le ofrezcas cupos ni le preguntes por fechas: ya tiene hora tomada.
- Si escribe para confirmar o consultar, recuérdale amablemente su día y hora.
- Si quiere CAMBIAR la hora, no se la cambies tú: dile que nuestra ejecutiva lo
  reagenda y usa la frase exacta de la regla de SOLICITUD HUMANA.
- Si escribe por un tema distinto, atiéndelo con normalidad sin volver a agendar.
`
      : '';

    // Cliente al que le escribimos NOSOTROS por su mantención anual. Ya es cliente de
    // Furtz, ya tenemos su dirección y su historial: lo único que falta es la fecha.
    // Sin este modo el bot le hacía el cuestionario completo de cliente nuevo —empresa
    // o particular, estado del equipo, dirección— a alguien que solo quería renovar.
    const modoRenovacion = !!existingLead?.campaign_sent_at && !citaVigente;

    // Encuesta y recordatorio hablan con alguien que YA es cliente: ahí el enlace va una sola
    // vez, en la despedida, en vez de repetirse en cada mensaje como en el flujo de venta.
    const enlaceSoloAlCierre = surveyMode || modoRenovacion;

    const bloqueRenovacion = modoRenovacion
      ? `
🔁 MODO RENOVACIÓN ANUAL — ACTIVO PARA ESTE CLIENTE. LEE ESTO ANTES QUE NADA.

Este cliente YA ES CLIENTE de Furtz. Nosotros le escribimos ofreciéndole su mantención
preventiva anual. Ya tenemos todos sus datos.

TU ÚNICO OBJETIVO ES DEJAR LA VISITA AGENDADA. Nada más.

PROHIBIDO EN ESTE MODO — no preguntes NINGUNA de estas cosas:
   ❌ Si es empresa o particular
   ❌ La dirección (ya la tenemos registrada más arriba)
   ❌ La antigüedad del equipo o cuándo fue su última mantención
   ❌ En qué condiciones está el equipo o si tiene fallas
   ❌ Qué servicio busca (ya sabemos que es mantención)
   ❌ Teléfono, cantidad de equipos o forma de pago

CÓMO ACTUAR:
- Si responde que SÍ, que le interesa, que quiere agendar o algo equivalente:
  ofrécele DE INMEDIATO las primeras fechas libres de la agenda, en un solo mensaje,
  como lista corta y clara. Nada de preguntas previas.
- Si dice que prefiere más adelante (en una o dos semanas, fin de mes, otro mes):
  pregúntale qué fecha le acomoda y ofrécele los cupos libres cercanos a esa fecha.
- Cuando elija un cupo, confírmaselo con día y hora y despídete cordialmente. Listo.
- Si menciona por su cuenta una falla del equipo, agradécele el dato y sigue agendando:
  no abras un cuestionario por eso.
- Si dice que NO le interesa, agradécele con amabilidad y despídete. No insistas.
- Si dice que YA le hicieron la mantención hace poco: agradécele, pregúntale en qué mes se
  la hicieron para dejarlo registrado, y ofrécele avisarle cuando le toque la próxima.
- Si pregunta QUÉ INCLUYE la mantención, respóndele esto antes de seguir con la fecha:
  "La mantención preventiva incluye limpieza de filtros y lavado de radiadores, revisión de
  temperaturas de trabajo, chequeo eléctrico, limpieza del drenaje, chequeo y engrase de los
  rodamientos de las turbinas si es necesario, y prueba de funcionamiento en frío o calor.
  Es lo que evita fallas y mantiene el consumo bajo."
  Nunca ignores esa pregunta: si la esquivas, el cliente se va.
- Si pregunta por el PRECIO: dile que nuestra ejecutiva se lo confirma al contactarlo, y en
  el MISMO mensaje ofrécele igual las fechas. Nunca dejes la conversación sin una fecha sobre
  la mesa.
`
      : '';

    // En modo renovación el cuestionario de mantención no aplica: el cliente ya pasó
    // por él cuando llegó la primera vez.
    const reglasMantencion = modoRenovacion
      ? `1. PARA MANTENIMIENTOS: este cliente está en MODO RENOVACIÓN ANUAL (ver arriba).
   No apliques cuestionario alguno. Solo agenda la visita.
   - SIN PRECIOS: si pregunta el valor, dile que nuestra ejecutiva se lo confirma al contactarlo.`
      : `1. PARA MANTENIMIENTOS — SON SOLO ESTAS 4 PREGUNTAS, UNA POR MENSAJE, EN ESTE ORDEN:
     * Antigüedad y última mantención EN UNA SOLA PREGUNTA. Texto sugerido: "¿Qué antigüedad tiene el equipo y cuándo fue su última mantención?"
     * En qué condiciones se encuentra: si funciona correctamente o presenta fallas (ej: ruido, no enfría, gotea).
     * Dirección completa para la visita.
     * Fecha para la cita, OFRECIENDO tú las opciones disponibles según la agenda (ver regla 4). No preguntes fecha y hora de forma abierta.
   - NO preguntes la capacidad ni los BTU del equipo. Si el cliente los menciona por su cuenta, regístralos, pero jamás los pidas.
   - NO preguntes por separado la fecha de instalación: va incluida en la primera pregunta.
   - IMPORTANTE — SIN PRECIOS: NUNCA entregues valores de mantención. Si el cliente pregunta por el precio, explícale amablemente que nuestra ejecutiva le confirmará el valor al contactarlo.`;

    // En una renovación la dirección ya está registrada: pedirla de nuevo sobra, y la
    // regla de "no propongas horarios sin dirección" bloquearía el agendamiento.
    const bloqueDireccion = modoRenovacion
      ? `2-bis. DIRECCIÓN: ya la tenemos registrada (ver arriba). NO se la preguntes.
   Si el propio cliente avisa que se cambió de domicilio, pídele la nueva y sigue agendando.`
      : `2-bis. DIRECCIÓN — DATO CRÍTICO, EL TÉCNICO NO PUEDE IR SIN ESTO:
   - Al pedir la dirección, ofrécele SIEMPRE las dos formas, con este texto:
     "¿Cuál es la dirección para la visita? Puedes escribirla, o mandarme tu ubicación
      desde el clip 📎 → Ubicación, que es más exacto para el técnico."
   - Necesitas calle, número y sector o comuna. Si te da algo incompleto (solo la calle,
     solo la comuna, o algo como "en el centro"), pídele amablemente que la complete.
   - NO avances a proponer horarios mientras no tengas una dirección utilizable o el
     cliente te haya mandado su ubicación.`;

    // En una renovación el cierre es la cita misma: no se deriva a la ejecutiva, porque
    // esa frase pausa el bot y dejaría al cliente colgado justo después de agendar.
    const bloqueCierre = modoRenovacion
      ? `3. CIERRE:
   - Apenas el cliente elija un cupo, confírmaselo con el día y la hora exactos, avísale
     que un técnico lo visitará y despídete cordialmente cerrando con la frase de la regla 2. Ahí termina: NO lo derives a
     la ejecutiva ni uses la frase de solicitud humana.`
      : `3. CIERRE Y DERIVACIÓN FINAL:
   - Al terminar de recopilar todos los datos de cualquiera de los dos flujos, agradécele al cliente y cierra con este texto EXACTO (el sistema lo detecta para alertar a la ejecutiva): "Tu solicitud quedó registrada con éxito. Enseguida le notificaré a nuestra ejecutiva Pilar para que se contacte contigo, te confirme el valor y coordine los detalles. Un momento, por favor.

Si prefieres escribirle tú directamente, acá está su WhatsApp: https://wa.me/56961897021"`;

    // El dato de empresa/particular tampoco se pide en una renovación.
    const bloqueDatoIngreso = modoRenovacion
      ? ''
      : `
DATO COMÚN DE INGRESO (OBLIGATORIO EN AMBOS FLUJOS):
Después de saber qué servicio busca, y antes de las preguntas propias de cada flujo, pregunta SOLO esto:
   a) Si es empresa o particular. Texto sugerido: "Para registrar tu solicitud, ¿el servicio es para una *empresa* o para un *particular*?"
   - Si responde "empresa", menciona que también trabajamos con facturación.
`;

    // Process normal message with Gemini
    const systemInstruction = `
Eres el asistente virtual oficial de Furtz Clima. Tu objetivo es atender amablemente a los clientes ofreciendo y guiando a través de nuestras dos opciones principales: MANTENIMIENTO PREVENTIVO o VENTA/INSTALACIÓN DE EQUIPOS NUEVOS.

DATOS QUE YA TENEMOS DE ESTE CLIENTE — NO SE LOS VUELVAS A PREGUNTAR:
${datosConocidos || 'Ninguno todavía: es un cliente nuevo.'}
${bloqueCitaVigente}${bloqueRenovacion}

SALUDO INICIAL (MUY IMPORTANTE):
- Cuando el cliente te escriba por primera vez, debes presentarte y preguntarle explícitamente qué servicio busca, ofreciéndole estas dos opciones: 1) Mantenimiento Preventivo o 2) Venta/Instalación de Aire Acondicionado.
- La opción que elija define el TIPO DE SERVICIO del registro: opción 1 = "Mantención", opción 2 = "Instalación". Si el cliente no lo deja claro, pregúntaselo antes de continuar.

${bloqueDatoIngreso}
PROHIBIDO PREGUNTAR (el sistema ya lo resuelve por otra vía):
   - NUNCA preguntes el número de teléfono de contacto: ya lo tenemos, es el mismo número desde el que te está escribiendo. Se registra solo.
   - NUNCA preguntes la cantidad de equipos.
   - NUNCA preguntes la forma de pago durante esta conversación. Eso se consulta después, cuando el trabajo ya está terminado.

REGLAS ESTRUCTURALES Y DE COMUNICACIÓN (ESTRICTAS):
1. PREGUNTAS DE A UNA: Debes hacer UNA SOLA PREGUNTA por cada mensaje. JAMÁS hagas dos o más preguntas juntas. Espera la respuesta del cliente antes de avanzar.
2. ENLACE DE AYUDA (OBLIGATORIO): ${enlaceSoloAlCierre
   ? `Este cliente YA es cliente de Furtz. NO incluyas ningún enlace ni frase de contacto en los mensajes intermedios. Solo en tu MENSAJE DE DESPEDIDA final, y una única vez, cierra con esta frase exacta: "${FRASE_CIERRE_CLIENTE}"`
   : `Al final de TODO mensaje que envíes, debes incluir SIEMPRE y de forma OBLIGATORIA esta frase exacta: "${FRASE_AYUDA_VENTA}"`}
3. SOLICITUD HUMANA: Si el cliente rechaza el proceso del bot, se frustra, o pide explícitamente hablar con un humano o asesor, debes responder EXACTA Y ÚNICAMENTE: "Comprendo. Enseguida le notificaré a nuestra ejecutiva Pilar para que se contacte contigo. Un momento, por favor." (El sistema detectará esta frase para enviar la alerta).

REGLAS DE NEGOCIO Y AGENDA:

${reglasMantencion}

2. PARA VENTAS E INSTALACIONES NUEVAS:
   - Si el cliente quiere cotizar, comprar o instalar un equipo nuevo, recopila esta información de a una sola por vez:
     * Metros cuadrados aproximados del espacio a climatizar.
     * Dirección completa donde le gustaría instalar el equipo.
     * Fecha para la visita técnica de factibilidad, OFRECIENDO tú las opciones disponibles según la agenda (ver regla 4).
   - IMPORTANTE — SIN PRECIOS: NUNCA entregues valores de equipos ni de instalación. Explica amablemente que el valor exacto se define después de la visita técnica de factibilidad, ya que depende de las condiciones del lugar.

${bloqueDireccion}
${bloqueCierre}

4. AGENDA — REGLA CRÍTICA, NO LA ROMPAS NUNCA:

   HOY ES ${hoyChile}. Toda fecha que menciones debe ser posterior a hoy.

   Furtz Clima atiende SOLO de lunes a viernes, y SOLO en dos horarios al día: 09:15 y 14:00.
   No existe ningún otro horario. No se trabaja sábado ni domingo.

   AGENDA COMPLETA DE CUPOS LIBRES (día: horas disponibles). No existe ninguno más:
${calendarContext}

   - TIENES PROHIBIDO inventar fechas u horarios. Solo puedes ofrecer cupos de la lista de arriba,
     copiando el día y la hora EXACTAMENTE como aparecen ahí.

   CÓMO OFRECER LOS CUPOS — SIEMPRE ASÍ, ES LO QUE PERMITE CERRAR RÁPIDO:
   - Ofrece 3 opciones, NUMERADAS del 1 al 3, UNA POR LÍNEA, con día, fecha y una sola hora
     cada una. Escribe siempre día, número, mes y hora completos. Ejemplo del formato:
       1) lunes 17 de agosto a las 09:15
       2) lunes 17 de agosto a las 14:00
       3) martes 18 de agosto a las 09:15
   - JAMÁS pongas dos horas en la misma opción ("09:15 o 14:00"): si el cliente responde
     "el primero" no se sabe cuál eligió y hay que preguntarle de nuevo, y ahí se pierde la venta.
   - Cierra con: "Respóndeme con el número de la opción que prefieras."
   - Si te contesta con un número o "el primero", esa es su elección: confírmala de inmediato.
     No le preguntes otra vez la hora.
   - Agrega en una línea corta que si ninguna le acomoda, tienes más días disponibles.
   - Si el cliente pide un día concreto, BUSCA ESE DÍA en la lista completa de arriba y ofrécele
     las horas libres que tenga. La lista abarca las próximas tres semanas, no solo los primeros días.
   - Solo si el día que pide NO aparece en la lista dile que no hay disponibilidad, y ofrécele el
     día libre más cercano a lo que pidió.

   CUANDO PIDE UN RANGO Y NO UN DÍA EXACTO ("la última semana del mes", "en dos semanas más",
   "a fin de mes", "la próxima semana"):
   - Cualquier día hábil de ese rango sirve. Ofrécele los cupos libres que haya dentro del rango,
     partiendo por los primeros, y déjalo elegir.
   - Si contesta que le da lo mismo, que cualquiera está bien o algo equivalente: NO le vuelvas a
     preguntar. Elige tú el primer cupo libre del rango, confírmaselo con día y hora exactos y cierra.

   SI PIDE UN HORARIO QUE NO EXISTE (por ejemplo "después de las 15:00" o "por la tarde"):
   - Solo atendemos 09:15 y 14:00. Explícaselo con amabilidad y ofrécele esos horarios dentro de
     los días que él prefiera.
   - Si insiste en un horario que no existe, deriva a la ejecutiva con la frase de SOLICITUD HUMANA:
     ella puede abrir una hora excepcional, tú no.
   - JAMÁS ofrezcas ni aceptes una hora que no esté en la lista de arriba, aunque el cliente la pida.

   - Si no logran coordinar una fecha, deriva al cliente a nuestra ejecutiva usando EXACTAMENTE
     la frase de la regla de SOLICITUD HUMANA.
${surveyMode ? `
5. MODO POST-SERVICIO (ACTIVO PARA ESTE CLIENTE):
   - El servicio de este cliente YA FUE COMPLETADO y el sistema ya le envió la pregunta por la FORMA DE PAGO. NO inicies flujos de venta ni mantención salvo que él lo pida explícitamente.
   - Haz las preguntas UNA POR MENSAJE, en este orden exacto, usando estos textos:
     1) (ya enviada por el sistema) "¿Qué forma de pago prefieres: transferencia, efectivo o débito/crédito?"
     2) Al recibir la forma de pago, confírmala y sigue: "¡Perfecto, queda anotado! 🙌\\n\\nY para terminar, del *1 al 7*, ¿qué nota le pones al trabajo realizado?"
     3) "¡Gracias por tu nota! 🙌\\n\\n¿El equipo cumplió con tus expectativas?"
     4) "¿Nos recomendarías a tus amigos o vecinos?"
     5) "Por último, ¿quieres dejarnos algún comentario o sugerencia? Puedes escribir con total libertad, lo leemos todos."
   - Al recibir el comentario final responde: "¡Muchas gracias por tu tiempo! 💙 Tu opinión nos ayuda a mejorar cada día. ¿Nos autorizas a compartir tu comentario como testimonio de clientes de Furtz Clima?"
   - Tras su respuesta, agradece y despídete cordialmente. No insistas ni repitas preguntas ya respondidas. En ESA despedida, y solo ahí, cierra con la frase indicada en la regla 2.
   - Si el cliente no quiere responder, agradécele igual y despídete sin insistir.` : ''}
`;

    // Se marca si el cliente acaba de tomar hora, para avisarle al técnico al final.
    let citaReciénAgendada = false;

    const startTime = Date.now();
    try {
      // Structure the input content
      if (image) {
        session.history.push({
          role: 'user',
          parts: [
            { text: message || "Analiza esta imagen para el diagnóstico de climatización de Furtz Clima:" },
            {
              inlineData: {
                data: image.base64Data,
                mimeType: image.mimeType
              }
            }
          ]
        });
      } else {
        session.history.push({ role: 'user', parts: [{ text: message }] });
      }

      // Las dos llamadas a Gemini van EN PARALELO: la respuesta al cliente y la
      // extracción de datos. Así capturar bien la dirección no le suma espera al cliente.
      const [response, datosExtraidos] = await Promise.all([
        this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: session.history,
          config: {
            systemInstruction: systemInstruction,
          }
        }),
        this.extraerDatosConIA(session.history)
      ]);

      let replyText = response.text || 'Disculpa, no pude procesar tu mensaje. ¿Podrías repetirlo?';
      
      // Refuerzo por si la IA olvidó el enlace. Solo aplica al flujo de venta: en la encuesta
      // y en el recordatorio, forzarlo aquí repetiría la frase en cada pregunta, que es justo
      // lo que se quiere evitar.
      if (!enlaceSoloAlCierre && !replyText.includes("56961897021") && !replyText.includes("Enseguida le notificaré")) {
        replyText += "\n\n" + FRASE_AYUDA_VENTA;
      }

      session.history.push({ role: 'model', parts: [{ text: replyText }] });

      // Save image diagnosis to notes, or standard chat text extraction
      if (image) {
        session.leadData.notes = `[Diagnóstico IA Multimodal]: ${replyText.substring(0, 180).replace(/\n/g, ' ')}...`;
      } else {
        this.extractLeadInfo(message, session.leadData, config);

        // ¿El cliente eligió uno de los cupos que le ofrecimos? Se compara contra la
        // lista real de disponibles, así nunca queda agendada una fecha que no existe.
        //
        // Si el cliente NO nombra la fecha —"cualquiera está bien", "el que sea"— es el
        // bot el que elige, y entonces la fecha solo aparece en SU respuesta. Sin este
        // segundo intento el bot decía "queda agendada para el lunes 24" y la cita no se
        // guardaba en ninguna parte: el cliente quedaba convencido de tener hora y el
        // técnico nunca se enteraba.
        // Qué cupos le ofreció el bot en su mensaje anterior, en ese mismo orden. Es lo
        // que permite entender "el primero" o "el 2" sin volver a preguntar.
        const parteAnterior = [...session.history]
          .slice(0, -1)
          .reverse()
          .find(h => h.role === 'model')?.parts?.[0];
        const ultimoMensajeDelBot =
          parteAnterior && 'text' in parteAnterior ? parteAnterior.text : '';
        const ofrecidosAntes = cuposMencionadosEnOrden(ultimoMensajeDelBot, disponibles);

        const elegido =
          detectarCupoElegido(message, disponibles) ||
          detectarCupoPorOrdinal(message, ofrecidosAntes) ||
          detectarCupoConfirmadoPorElBot(replyText, disponibles);
        if (elegido && session.leadData.appointment_iso !== elegido.id) {
          session.leadData.appointment_iso = elegido.id;
          session.leadData.appointment_time = elegido.label;
          // Queda registrado que la hora la cerró el agente, no una persona. Es lo que
          // permite después contar cuántas visitas trajo la IA por sí sola.
          session.leadData.booked_by = 'bot';
          session.leadData.booked_at = new Date().toISOString();
          session.leadData.status = 'Agendado';
          console.log(`[AGENDA] +${cleanPhone} tomó el cupo ${elegido.id} (${elegido.label}) — agendado por el bot.`);
          citaReciénAgendada = true;
        }
      }

      // La IA manda por sobre las heurísticas de palabras clave.
      const direccionAntes = session.leadData.address;
      this.aplicarDatosExtraidos(datosExtraidos, session.leadData);
      if (session.leadData.address && session.leadData.address !== direccionAntes) {
        console.log(`[EXTRACCIÓN IA] Dirección capturada para +${cleanPhone}: "${session.leadData.address}"`);
      }

      // Check for human assistance / derivation trigger
      const isHumanRequested = replyText.includes("Enseguida le notificaré a nuestra ejecutiva") || replyText.includes("Un momento, por favor.");
      if (isHumanRequested) {
        session.leadData.status = 'derivado_ventas';
        session.leadData.notes = (session.leadData.notes || '') + `\n[Ayuda Solicitada]: El cliente pidió asistencia humana directa.`;
        
        // Asynchronously notify Pilar
        notifyExecutivePilar(cleanPhone, session.leadData).catch(err => {
          console.error("Error notifying Pilar:", err);
        });
      } else if (session.leadData.service_type === 'maintenance' || session.leadData.service_type === 'installation') {
        const hasAddress = !!session.leadData.address;
        // Solo cuenta como agendado si tomó un cupo real de la agenda.
        const hasTime = !!session.leadData.appointment_iso;

        // "Agendado" manda por sobre "pendiente_revision": si el cliente ya tiene hora,
        // eso es lo que Pilar necesita ver en el panel. Sin este resguardo, completar el
        // cuestionario después de agendar borraba el estado y la ficha volvía a la cola.
        const yaAgendado = session.leadData.status === 'Agendado';

        if (session.leadData.service_type === 'maintenance') {
          // Antigüedad y última mantención ahora se preguntan juntas: basta con capturar una de las dos.
          // Ya no se exigen los BTU, porque el bot dejó de preguntarlos.
          const hasHistory = !!session.leadData.installation_age || !!session.leadData.last_maintenance_info;
          const hasStatus = session.leadData.is_working_correctly !== undefined;

          if (hasHistory && hasStatus && hasAddress && hasTime && !yaAgendado) {
            session.leadData.status = 'pendiente_revision';
          }
        } else if (session.leadData.service_type === 'installation') {
          const hasM2 = !!session.leadData.area_m2;

          if (hasM2 && hasAddress && hasTime && !yaAgendado) {
            session.leadData.status = 'pendiente_revision';
          }
        }
      }

      // Al agendar se asigna técnico ANTES de guardar, para que quede en la misma
      // escritura y el dashboard lo muestre de inmediato.
      let tecnicoParaAvisar: string | undefined;
      let avisoEsActualizacion = false;

      if (citaReciénAgendada) {
        tecnicoParaAvisar = session.leadData.technician || existingLead?.technician || TECNICO_POR_DEFECTO;
        session.leadData.technician = tecnicoParaAvisar;
      } else if (
        session.leadData.appointment_iso &&
        session.leadData.address &&
        session.leadData.address !== existingLead?.address
      ) {
        // La dirección llegó DESPUÉS de tomar el cupo. El técnico ya recibió el aviso
        // con "Dirección: no registrada" y nadie se la iba a mandar nunca: se le
        // reenvía la ficha ahora que sí está completa.
        tecnicoParaAvisar = session.leadData.technician || existingLead?.technician || TECNICO_POR_DEFECTO;
        session.leadData.technician = tecnicoParaAvisar;
        avisoEsActualizacion = true;
      }

      // Save lead updates to database on every turn to support real-time dashboard feed
      await this.saveLeadToFirestore(cleanPhone, session.leadData, session.history);

      // Recién agendada la visita, se le avisa al técnico con la dirección, el enlace al
      // mapa y el día y hora que eligió el cliente. Antes esto solo ocurría si Pilar le
      // asignaba técnico a mano, así que una cita tomada de noche no le llegaba a nadie.
      // Antes se avisaba al técnico apenas el cliente elegía hora. Ahora el único aviso es el
      // recordatorio de 1 h antes, para que no le lleguen todas las citas juntas.

      const latencyMs = Date.now() - startTime;
      const tokensUsed = response.usageMetadata?.totalTokenCount || Math.round((message.length + replyText.length) * 0.7);
      const type = image ? 'image_analysis' : 'text_message';
      const logMessage = image
        ? `Analizó imagen del cliente. Resumen: "${replyText.substring(0, 120).replace(/\n/g, ' ')}..."`
        : `Mensaje recibido: "${message.substring(0, 60)}" -> Respuesta: "${replyText.substring(0, 80).replace(/\n/g, ' ')}..."`;

      aiLogger.logEvent(cleanPhone, type, logMessage, tokensUsed, latencyMs);

      return replyText;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      aiLogger.logEvent(cleanPhone, 'error', `Error en API Gemini: ${errorMessage}`, 0, latencyMs);
      console.error('Error en Gemini API:', err);
      avisarSiEsCuotaAgotada(err).catch(e => console.error('No se pudo procesar la alerta de cuota:', e));
      return 'Lo siento, he tenido un problema de conexión. ¿Podemos intentarlo nuevamente?';
    }
  }

  /**
   * Extrae los datos del cliente usando Gemini en vez de buscar palabras sueltas.
   *
   * Antes la dirección solo se guardaba si el mensaje contenía "calle", "avenida",
   * "pasaje", "nro" o "n°". Un cliente que escribía "Antonio Duce 795, Niebla,
   * Valdivia" quedaba con dirección vacía, y el técnico recibía "No especificada".
   *
   * Devuelve solo los campos que encontró; el resto queda en null y no se toca.
   */
  private async extraerDatosConIA(history: UserSession['history']): Promise<Record<string, any>> {
    try {
      const conversacion = history
        .slice(-10)
        .map(t => {
          const texto = t.parts.map(p => ('text' in p ? p.text : '[el cliente envió una foto]')).join(' ');
          return `${t.role === 'user' ? 'Cliente' : 'Asistente'}: ${texto}`;
        })
        .join('\n');

      const prompt = `Eres un extractor de datos para una empresa de aire acondicionado en Valdivia, Chile.
Lee la conversación y devuelve SOLO un objeto JSON válido, sin explicaciones ni markdown.
Usa null en cualquier campo que el cliente no haya entregado. No inventes nada.

Campos:
- "address": la dirección de la visita tal como la dio el cliente, incluyendo número, sector y ciudad si los mencionó. Ejemplo: "Antonio Duce 795, Niebla, Valdivia". Es una dirección aunque no diga la palabra "calle".
- "client_type": "empresa" o "particular".
- "area_m2": número de metros cuadrados del espacio a climatizar.
- "installation_age": antigüedad del equipo, en texto. Ejemplo: "2 años".
- "last_maintenance_info": cuándo fue la última mantención. Ejemplo: "hace 1 año", "nunca".
- "is_working_correctly": true si dice que funciona bien, false si menciona una falla, null si no lo dijo.
- "equipment_count": cuántos equipos.
- "payment_method": forma de pago que mencionó.

Conversación:
${conversacion}`;

      const res = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json', temperature: 0 }
      });

      const crudo = (res.text || '').trim().replace(/^```json\s*|\s*```$/g, '');
      const datos = JSON.parse(crudo);
      return typeof datos === 'object' && datos !== null ? datos : {};
    } catch (err) {
      console.error('[EXTRACCIÓN IA] No se pudieron extraer los datos:', err instanceof Error ? err.message : err);
      return {};
    }
  }

  /** Copia al lead solo los campos que la IA encontró de verdad. */
  private aplicarDatosExtraidos(datos: Record<string, any>, leadData: any) {
    const texto = ['address', 'installation_age', 'last_maintenance_info', 'payment_method'];
    const numeros = ['area_m2', 'equipment_count'];

    for (const campo of texto) {
      const v = datos[campo];
      if (typeof v === 'string' && v.trim().length > 2) leadData[campo] = v.trim();
    }
    for (const campo of numeros) {
      const v = Number(datos[campo]);
      if (Number.isFinite(v) && v > 0) leadData[campo] = v;
    }
    if (datos.client_type === 'empresa' || datos.client_type === 'particular') {
      leadData.client_type = datos.client_type;
    }
    if (typeof datos.is_working_correctly === 'boolean') {
      leadData.is_working_correctly = datos.is_working_correctly;
    }
  }

  // Heurísticas simples de respaldo. La fuente principal ahora es extraerDatosConIA;
  // esto solo rellena lo que la IA no haya devuelto.
  private extractLeadInfo(text: string, leadData: any, config: any) {
    const textLower = text.toLowerCase();

    // Service type detection
    if (textLower.includes('mantenimiento') || textLower.includes('mantencion') || textLower.includes('mantención') || textLower.includes('limpieza') || textLower.includes('mantenciones')) {
      leadData.service_type = 'maintenance';
    } else if (textLower.includes('instalar') || textLower.includes('instalacion') || textLower.includes('instalación') || textLower.includes('nuevo')) {
      leadData.service_type = 'installation';
    }

    // Client type: empresa o particular
    if (!leadData.client_type) {
      if (textLower.includes('empresa') || textLower.includes('compañia') || textLower.includes('compañía') || textLower.includes('negocio') || textLower.includes('factura')) {
        leadData.client_type = 'empresa';
      } else if (textLower.includes('particular') || textLower.includes('personal') || textLower.includes('casa') || textLower.includes('hogar')) {
        leadData.client_type = 'particular';
      }
    }

    // Contact phone (9 digits, Chilean format with or without +56)
    if (!leadData.contact_phone) {
      const phoneMatch = text.replace(/[\s.-]/g, '').match(/(?:\+?56)?(9\d{8})/);
      if (phoneMatch) {
        leadData.contact_phone = phoneMatch[1];
      }
    }

    // Equipment count
    if (!leadData.equipment_count) {
      const countMatch = textLower.match(/(\d+)\s*(equipos?|unidades?|aires?|split)/);
      if (countMatch) {
        leadData.equipment_count = parseInt(countMatch[1], 10);
      } else if (/\b(un|uno|1)\s+(equipo|aire|split)/.test(textLower)) {
        leadData.equipment_count = 1;
      }
    }

    // Payment method
    if (!leadData.payment_method) {
      if (textLower.includes('transferencia')) leadData.payment_method = 'Transferencia';
      else if (textLower.includes('efectivo')) leadData.payment_method = 'Efectivo';
      else if (textLower.includes('credito') || textLower.includes('crédito')) leadData.payment_method = 'Tarjeta de crédito';
      else if (textLower.includes('debito') || textLower.includes('débito') || textLower.includes('redcompra')) leadData.payment_method = 'Tarjeta de débito';
      else if (textLower.includes('factura')) leadData.payment_method = 'Facturación empresa';
    }

    // Area detection (e.g. 20m2, 20 m2, 20 metros cuadrados)
    const areaMatch = textLower.match(/(\d+)\s*(m2|metros|mt2)/);
    if (areaMatch) {
      const area = parseInt(areaMatch[1], 10);
      leadData.area_m2 = area;
      
      // Calculate BTU
      for (const rule of config.btu_matrix) {
        if (area <= rule.max_m2) {
          leadData.calculated_btu = rule.btu;
          
          // Generate automated quote description and save to notes
          const pricing = config.pricing_matrix[rule.btu];
          if (pricing) {
            leadData.notes = `Cotización Est. ${rule.btu}: Económica ($${pricing.economicas}), Intermedia ($${pricing.intermedias}), Premium ($${pricing.premium}). Costo Instalación: Entre $${config.installation_cost.min.toLocaleString('es-CL')} y $${config.installation_cost.max.toLocaleString('es-CL')}`;
          }
          break;
        }
      }
    }

    // Capacity/BTU options extraction (a# 9k, b# 12k, c# 18k, d# 24k o más)
    if (/(?:opción\s+a\b|\ba\)|a#|\bla\s+a\b|\b9\.?000\b|\b9\s*k\b)/i.test(textLower)) {
      leadData.calculated_btu = '9.000 BTU';
    } else if (/(?:opción\s+b\b|\bb\)|b#|\bla\s+b\b|\b12\.?000\b|\b12\s*k\b)/i.test(textLower)) {
      leadData.calculated_btu = '12.000 BTU';
    } else if (/(?:opción\s+c\b|\bc\)|c#|\bla\s+c\b|\b18\.?000\b|\b18\s*k\b)/i.test(textLower)) {
      leadData.calculated_btu = '18.000 BTU';
    } else if (/(?:opción\s+d\b|\bd\)|d#|\bla\s+d\b|\b24\.?000\b|\b24\s*k\b)/i.test(textLower)) {
      leadData.calculated_btu = '24.000 BTU';
    }

    // Setting notes for maintenance if service_type is maintenance
    if (leadData.service_type === 'maintenance') {
      leadData.notes = `Servicio de Mantenimiento / Mantención Preventiva. Valor base de visita técnica: $${config.maintenance_cost.toLocaleString('es-CL')}`;
    }

    // Installation age detection (e.g. "3 años")
    const ageMatch = textLower.match(/(\d+)\s*(año|ano)/);
    if (ageMatch) {
      leadData.installation_age = `${ageMatch[1]} años`;
    } else if (textLower.includes('un año') || textLower.includes('1 año')) {
      leadData.installation_age = '1 año';
    } else if (textLower.includes('meses')) {
      const monthsMatch = textLower.match(/(\d+)\s*mes/);
      if (monthsMatch) {
        leadData.installation_age = `${monthsMatch[1]} meses`;
      }
    }

    // Last maintenance info extraction (e.g. "nunca", "hace 6 meses")
    // OJO: antes bastaba con que apareciera "ningun" en cualquier parte del mensaje, así que
    // "no tiene ninguna falla" quedaba registrado como "nunca se le hizo mantención".
    const neverMaintained =
      (/\bnunca\b/.test(textLower) && !/nunca\s+(ha\s+|se\s+ha\s+)?(fall|rot|dado\s+problema)/.test(textLower)) ||
      /(ningun|ningún)a?\s+(mantenci|mantenimiento|limpieza)/.test(textLower);

    if (neverMaintained) {
      leadData.last_maintenance_info = 'Nunca';
    } else {
      const lastMaintMatch = textLower.match(/(?:hace|ultimo|último)\s*(\d+)\s*(mes|meses|año|ano|años)/);
      if (lastMaintMatch) {
        leadData.last_maintenance_info = `Hace ${lastMaintMatch[1]} ${lastMaintMatch[2]}`;
      } else if (textLower.includes('hace un año') || textLower.includes('hace 1 año') || textLower.includes('hace un ano')) {
        leadData.last_maintenance_info = 'Hace 1 año';
      } else if (textLower.includes('hace poco') || textLower.includes('hace unos meses')) {
        leadData.last_maintenance_info = 'Hace poco';
      }
    }

    // Works correctly status extraction (e.g. functions correctly vs fault)
    // La negación se evalúa PRIMERO: antes, "no tiene ninguna falla" se registraba como
    // equipo con problemas, porque solo se buscaba la palabra suelta "falla".
    const saysNoFault =
      /\bno\s+(tiene|presenta|hay|ha\s+tenido)\s+(ninguna?\s+|ningún\s+)?(falla|problema|ruido|fuga)/.test(textLower) ||
      /\bsin\s+(fallas?|problemas?|ruidos?)\b/.test(textLower);

    if (saysNoFault || textLower.includes('funciona bien') || textLower.includes('si funciona') || textLower.includes('funciona correctamente') || textLower.includes('todo bien') || textLower.includes('sí, funciona') || textLower.includes('si, funciona') || textLower.includes('si, todo bien')) {
      leadData.is_working_correctly = true;
    } else if (textLower.includes('gotea') || textLower.includes('ruido') || textLower.includes('no enfría') || textLower.includes('no enfria') || textLower.includes('no funciona') || textLower.includes('tiene falla') || textLower.includes('falla') || textLower.includes('no prende') || textLower.includes('marca error')) {
      leadData.is_working_correctly = false;
    }

    // La cita YA NO se adivina desde el texto (antes se guardaba el mensaje entero como
    // si fuera la hora). Ahora la resuelve detectarCupoElegido contra la agenda real.

    // La dirección YA NO se adivina buscando "calle" o "avenida": esa heurística
    // botaba direcciones tan comunes como "Antonio Duce 795, Niebla, Valdivia".
    // Ahora la extrae extraerDatosConIA leyendo la conversación completa.
  }

  // Save registered lead to Firestore and local fallback JSON mock
  private async saveLeadToFirestore(phone: string, leadData: any, history?: UserSession['history']) {
    const defaultStatus = leadData.status || 'Pendiente';
    const createdAt = leadData.created_at || new Date().toISOString();
    // La conversación se guarda junto al lead: la ve Pilar en el dashboard y le sirve
    // al propio bot para recordar el hilo si el servidor se reinicia.
    const conversation = history ? serializeHistory(history) : null;
    const lastMessageAt = conversation && conversation.length > 0 ? new Date().toISOString() : null;

    // 1. Try Firestore if database connection exists
    if (db) {
      try {
        const leadRef = db.collection('leads').doc(phone);
        await leadRef.set({
          phone,
          service_type: leadData.service_type || null,
          installation_age: leadData.installation_age || null,
          address: leadData.address || null,
          appointment_time: leadData.appointment_time || null,
          appointment_iso: leadData.appointment_iso || null,
          latitude: leadData.latitude || null,
          longitude: leadData.longitude || null,
          area_m2: leadData.area_m2 || null,
          calculated_btu: leadData.calculated_btu || null,
          notes: leadData.notes || null,
          status: defaultStatus,
          last_maintenance_info: leadData.last_maintenance_info || null,
          is_working_correctly: leadData.is_working_correctly !== undefined ? leadData.is_working_correctly : null,
          installation_date: leadData.installation_date || null,
          last_maintenance_date: leadData.last_maintenance_date || null,
          // Estos campos se capturaban en memoria pero NO se guardaban: se perdían en cada mensaje.
          client_type: leadData.client_type || null,
          contact_phone: leadData.contact_phone || null,
          equipment_count: leadData.equipment_count || null,
          payment_method: leadData.payment_method || null,
          satisfaction_rating: leadData.satisfaction_rating || null,
          satisfaction_comment: leadData.satisfaction_comment || null,
          ...(leadData.technician ? { technician: leadData.technician } : {}),
          // Quién cerró la hora. Solo se escribe si existe, para no borrar lo que puso el panel.
          ...(leadData.booked_by ? { booked_by: leadData.booked_by, booked_at: leadData.booked_at || null } : {}),
          // Solo se escribe si hay historial, para no borrar el que ya estaba guardado.
          ...(conversation ? { conversation, last_message_at: lastMessageAt } : {}),
          created_at: createdAt
        }, { merge: true });
        console.log(`Lead registrado con éxito en Firestore para el teléfono: ${phone}`);
      } catch (err) {
        console.error('Error al guardar lead en Firestore:', err);
      }
    }

    // 2. Always write to local JSON mock so the local dashboard simulator updates in real-time
    try {
      const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
      let mockData: any[] = [];
      if (fs.existsSync(mockLeadsPath)) {
        mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
      }
      
      const existingIndex = mockData.findIndex((item: any) => item.phone === phone);
      const updatedLead = {
        phone,
        service_type: leadData.service_type || null,
        installation_age: leadData.installation_age || null,
        address: leadData.address || null,
        appointment_time: leadData.appointment_time || null,
        appointment_iso: leadData.appointment_iso || null,
        latitude: leadData.latitude || null,
        longitude: leadData.longitude || null,
        area_m2: leadData.area_m2 || null,
        calculated_btu: leadData.calculated_btu || null,
        notes: leadData.notes || null,
        status: defaultStatus,
        last_maintenance_info: leadData.last_maintenance_info || null,
        is_working_correctly: leadData.is_working_correctly !== undefined ? leadData.is_working_correctly : null,
        installation_date: leadData.installation_date || null,
        last_maintenance_date: leadData.last_maintenance_date || null,
        client_type: leadData.client_type || null,
        contact_phone: leadData.contact_phone || null,
        equipment_count: leadData.equipment_count || null,
        payment_method: leadData.payment_method || null,
        satisfaction_rating: leadData.satisfaction_rating || null,
        satisfaction_comment: leadData.satisfaction_comment || null,
        ...(conversation ? { conversation, last_message_at: lastMessageAt } : {}),
        created_at: createdAt
      };

      if (existingIndex > -1) {
        mockData[existingIndex] = { ...mockData[existingIndex], ...updatedLead };
      } else {
        mockData.push(updatedLead);
      }

      fs.writeFileSync(mockLeadsPath, JSON.stringify(mockData, null, 2), 'utf8');
      console.log(`Lead guardado localmente en archivo mock para el teléfono: ${phone}`);
    } catch (localErr) {
      console.error('Error al guardar datos mock locales:', localErr);
    }
  }
}

export const geminiService = new GeminiService();
