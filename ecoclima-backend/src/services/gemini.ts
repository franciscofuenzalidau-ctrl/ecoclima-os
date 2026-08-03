import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { aiLogger } from './aiLogger';
import { db } from './firebase';

dotenv.config();

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
  };
}

const sessions: Map<string, UserSession> = new Map();

// Cuántos mensajes de la conversación se guardan en el lead.
const MAX_STORED_MESSAGES = 60;

// Campos del lead que hay que recuperar desde la base de datos al reiniciar el servidor.
const HYDRATED_FIELDS = [
  'service_type', 'installation_age', 'address', 'appointment_time', 'latitude', 'longitude',
  'area_m2', 'calculated_btu', 'notes', 'status', 'last_maintenance_info', 'is_working_correctly',
  'installation_date', 'last_maintenance_date', 'satisfaction_rating', 'satisfaction_comment',
  'client_type', 'contact_phone', 'equipment_count', 'payment_method'
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

async function getAllOccupiedTimes(): Promise<string[]> {
  const occupiedTimes: string[] = [];
  if (db) {
    try {
      const snapshot = await db.collection('leads').get();
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data && data.appointment_time && data.status !== 'Cancelado') {
          occupiedTimes.push(`${data.appointment_time} (Técnico: ${data.technician || 'Por definir'})`);
        }
      });
      return occupiedTimes;
    } catch (e) {
      console.error('Error fetching occupied times from Firestore:', e);
    }
  }
  try {
    const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
    if (fs.existsSync(mockLeadsPath)) {
      const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
      mockData.forEach((item: any) => {
        if (item.appointment_time && item.status !== 'Cancelado') {
          occupiedTimes.push(`${item.appointment_time} (Técnico: ${item.technician || 'Por definir'})`);
        }
      });
    }
  } catch (e) {
    console.error('Error reading occupied times from mock:', e);
  }
  return occupiedTimes;
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
    const surveyMode = !!(existingLead && existingLead.status === 'Instalado');
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
      
      const responseText = `He recibido tu ubicación GPS: ${address}. La usaré para registrar tu dirección de atención.`;
      session.history.push({ role: 'user', parts: [{ text: `[Ubicación GPS enviada: ${location.latitude}, ${location.longitude}. Dirección: ${address}]` }] });
      session.history.push({ role: 'model', parts: [{ text: responseText }] });
      
      aiLogger.logEvent(cleanPhone, 'location_received', `Recibió ubicación GPS y resolvió dirección: "${address}"`, 10, 500);
      
      // FIX: Ensure we save the location to the database before returning
      await this.saveLeadToFirestore(cleanPhone, session.leadData, session.history);
      
      // If a technician is already assigned to this client, forward the location
      if (existingLead && existingLead.technician) {
        notifyTechnicianOfLocation(cleanPhone, existingLead.technician, location.latitude, location.longitude, address).catch(err => {
          console.error("Error forwarding location to technician:", err);
        });
      }

      return responseText;
    }

    // Load config dynamically for each execution to pick up dollar adjustments
    const config = loadConfigRules();
    const salesPhone = config.sales_phone || '56990939188';

    // Load busy times for agenda context
    const occupiedTimes = await getAllOccupiedTimes();
    const calendarContext = occupiedTimes.length > 0
      ? occupiedTimes.map(t => `- ${t}`).join('\n')
      : 'No hay horarios ocupados actualmente. Toda la agenda está disponible.';

    // Process normal message with Gemini
    const systemInstruction = `
Eres el asistente virtual oficial de Furtz Clima. Tu objetivo es atender amablemente a los clientes ofreciendo y guiando a través de nuestras dos opciones principales: MANTENIMIENTO PREVENTIVO o VENTA/INSTALACIÓN DE EQUIPOS NUEVOS.

SALUDO INICIAL (MUY IMPORTANTE):
- Cuando el cliente te escriba por primera vez, debes presentarte y preguntarle explícitamente qué servicio busca, ofreciéndole estas dos opciones: 1) Mantenimiento Preventivo o 2) Venta/Instalación de Aire Acondicionado.
- La opción que elija define el TIPO DE SERVICIO del registro: opción 1 = "Mantención", opción 2 = "Instalación". Si el cliente no lo deja claro, pregúntaselo antes de continuar.

DATO COMÚN DE INGRESO (OBLIGATORIO EN AMBOS FLUJOS):
Después de saber qué servicio busca, y antes de las preguntas propias de cada flujo, pregunta SOLO esto:
   a) Si es empresa o particular. Texto sugerido: "Para registrar tu solicitud, ¿el servicio es para una *empresa* o para un *particular*?"
   - Si responde "empresa", menciona que también trabajamos con facturación.

PROHIBIDO PREGUNTAR (el sistema ya lo resuelve por otra vía):
   - NUNCA preguntes el número de teléfono de contacto: ya lo tenemos, es el mismo número desde el que te está escribiendo. Se registra solo.
   - NUNCA preguntes la cantidad de equipos.
   - NUNCA preguntes la forma de pago durante esta conversación. Eso se consulta después, cuando el trabajo ya está terminado.

REGLAS ESTRUCTURALES Y DE COMUNICACIÓN (ESTRICTAS):
1. PREGUNTAS DE A UNA: Debes hacer UNA SOLA PREGUNTA por cada mensaje. JAMÁS hagas dos o más preguntas juntas. Espera la respuesta del cliente antes de avanzar.
2. ENLACE DE AYUDA (OBLIGATORIO): Al final de TODO mensaje que envíes, debes incluir SIEMPRE y de forma OBLIGATORIA esta frase exacta: "Si no quieres mantención o venta de aire acondicionado, contáctate con nuestros ejecutivos acá: https://wa.me/56961897021"
3. SOLICITUD HUMANA: Si el cliente rechaza el proceso del bot, se frustra, o pide explícitamente hablar con un humano o asesor, debes responder EXACTA Y ÚNICAMENTE: "Comprendo. Enseguida le notificaré a nuestra ejecutiva Pilar para que se contacte contigo. Un momento, por favor." (El sistema detectará esta frase para enviar la alerta).

REGLAS DE NEGOCIO Y AGENDA:

1. PARA MANTENIMIENTOS — SON SOLO ESTAS 4 PREGUNTAS, UNA POR MENSAJE, EN ESTE ORDEN:
     * Antigüedad y última mantención EN UNA SOLA PREGUNTA. Texto sugerido: "¿Qué antigüedad tiene el equipo y cuándo fue su última mantención?"
     * En qué condiciones se encuentra: si funciona correctamente o presenta fallas (ej: ruido, no enfría, gotea).
     * Dirección completa para la visita.
     * Fecha para la cita, OFRECIENDO tú las opciones disponibles según la agenda (ver regla 4). No preguntes fecha y hora de forma abierta.
   - NO preguntes la capacidad ni los BTU del equipo. Si el cliente los menciona por su cuenta, regístralos, pero jamás los pidas.
   - NO preguntes por separado la fecha de instalación: va incluida en la primera pregunta.
   - IMPORTANTE — SIN PRECIOS: NUNCA entregues valores de mantención. Si el cliente pregunta por el precio, explícale amablemente que nuestra ejecutiva le confirmará el valor al contactarlo.

2. PARA VENTAS E INSTALACIONES NUEVAS:
   - Si el cliente quiere cotizar, comprar o instalar un equipo nuevo, recopila esta información de a una sola por vez:
     * Metros cuadrados aproximados del espacio a climatizar.
     * Dirección completa donde le gustaría instalar el equipo.
     * Fecha para la visita técnica de factibilidad, OFRECIENDO tú las opciones disponibles según la agenda (ver regla 4).
   - IMPORTANTE — SIN PRECIOS: NUNCA entregues valores de equipos ni de instalación. Explica amablemente que el valor exacto se define después de la visita técnica de factibilidad, ya que depende de las condiciones del lugar.

3. CIERRE Y DERIVACIÓN FINAL:
   - Al terminar de recopilar todos los datos de cualquiera de los dos flujos, agradécele al cliente y cierra con este texto EXACTO (el sistema lo detecta para alertar a la ejecutiva): "Tu solicitud quedó registrada con éxito. Enseguida le notificaré a nuestra ejecutiva Pilar para que se contacte contigo, te confirme el valor y coordine los detalles. Un momento, por favor.

Si prefieres escribirle tú directamente, acá está su WhatsApp: https://wa.me/56961897021"

4. AGENDA (REVÍSALA SIEMPRE ANTES DE PROPONER O ACEPTAR UNA FECHA). Horarios YA OCUPADOS (NO disponibles):
${calendarContext}
   - Para agendar: propone tú 2 o 3 alternativas concretas de día y hora (de lunes a sábado, entre 09:00 y 18:00) que NO choquen con los horarios ocupados de arriba.
   - Si el cliente propone un horario que coincide con uno ocupado, adviértele amablemente que ya está tomado y ofrécele alternativas libres.
   - Si no logran coordinar una fecha o hay cualquier problema con la agenda, deriva al cliente a nuestra ejecutiva usando EXACTAMENTE la frase de la regla de SOLICITUD HUMANA.
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
   - Tras su respuesta, agradece y despídete cordialmente. No insistas ni repitas preguntas ya respondidas.
   - Si el cliente no quiere responder, agradécele igual y despídete sin insistir.` : ''}
`;

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

      // Run chat completion with gemini-2.5-flash
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: session.history,
        config: {
          systemInstruction: systemInstruction,
        }
      });

      let replyText = response.text || 'Disculpa, no pude procesar tu mensaje. ¿Podrías repetirlo?';
      
      // Forzar siempre el link de ayuda si la IA olvidó ponerlo
      if (!replyText.includes("56961897021") && !replyText.includes("Enseguida le notificaré")) {
        replyText += "\n\nSi no quieres mantención o venta de aire acondicionado, contáctate con nuestros ejecutivos acá: https://wa.me/56961897021";
      }

      session.history.push({ role: 'model', parts: [{ text: replyText }] });

      // Save image diagnosis to notes, or standard chat text extraction
      if (image) {
        session.leadData.notes = `[Diagnóstico IA Multimodal]: ${replyText.substring(0, 180).replace(/\n/g, ' ')}...`;
      } else {
        this.extractLeadInfo(message, session.leadData, config);
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
        const hasTime = !!session.leadData.appointment_time;
        
        if (session.leadData.service_type === 'maintenance') {
          // Antigüedad y última mantención ahora se preguntan juntas: basta con capturar una de las dos.
          // Ya no se exigen los BTU, porque el bot dejó de preguntarlos.
          const hasHistory = !!session.leadData.installation_age || !!session.leadData.last_maintenance_info;
          const hasStatus = session.leadData.is_working_correctly !== undefined;

          if (hasHistory && hasStatus && hasAddress && hasTime) {
            session.leadData.status = 'pendiente_revision';
          }
        } else if (session.leadData.service_type === 'installation') {
          const hasM2 = !!session.leadData.area_m2;
          
          if (hasM2 && hasAddress && hasTime) {
            session.leadData.status = 'pendiente_revision';
          }
        }
      }

      // Save lead updates to database on every turn to support real-time dashboard feed
      await this.saveLeadToFirestore(cleanPhone, session.leadData, session.history);

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
      return 'Lo siento, he tenido un problema de conexión. ¿Podemos intentarlo nuevamente?';
    }
  }

  // Simple heuristics to parse and extract lead details from chat messages
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

    // Appointment time (e.g. "lunes a las 10 am", "mañana a las 4")
    if (textLower.includes('las') && (textLower.includes('am') || textLower.includes('pm') || textLower.includes('hora') || textLower.includes('cita'))) {
      leadData.appointment_time = text;
    }

    // Basic address detection (if it includes street words or specific formats and isn't a coordinate)
    if ((textLower.includes('calle') || textLower.includes('avenida') || textLower.includes('pasaje') || textLower.includes('nro') || textLower.includes('n°')) && !textLower.includes('ubicacion:')) {
      leadData.address = text;
    }
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
