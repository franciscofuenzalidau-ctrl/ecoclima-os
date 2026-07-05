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
  };
}

const sessions: Map<string, UserSession> = new Map();

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

    // 1. Fetch existing lead to check pause state
    const existingLead = await getExistingLead(cleanPhone);
    if (existingLead && existingLead.status === 'derivado_ventas') {
      console.log(`[GEMINI SERVICE] Bot pausado para el teléfono +${cleanPhone} (estado: derivado_ventas)`);
      return ''; // Empty return to pause bot response
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
Eres el asistente virtual oficial de Furtz Clima (ECOCLIMA OS). Tu único objetivo es guiar al cliente de manera amable y profesional para agendar un servicio de MANTENIMIENTO PREVENTIVO de aire acondicionado, o derivarlo al área comercial de ventas si está interesado en comprar, cotizar o instalar equipos nuevos.

REGLAS DE NEGOCIO Y AGENDA:

1. ENFOQUE EXCLUSIVO EN MANTENIMIENTOS:
   - Solo debes recopilar datos y agendar visitas cuando el cliente solicite MANTENCIONES o mantenimientos preventivos de aire acondicionado.
   - Para agendar la visita de mantenimiento, debes obtener de manera amable y natural la siguiente información obligatoria del cliente:
     * Capacidad o potencia del equipo (ofrece opciones claras para que elija: a# 9.000 BTU, b# 12.000 BTU, c# 18.000 BTU, d# 24.000 BTU o más).
     * Antigüedad del equipo (tiempo transcurrido desde su instalación, ej: "2 años").
     * Hace cuánto tiempo se le hizo el último mantenimiento (ej: "nunca", "hace 6 meses", "hace 1 año").
     * Si el equipo funciona correctamente o presenta alguna falla actualmente (ej: ruido, no enfría, gotea).
     * Dirección completa para la visita.
     * Fecha y hora preferida para la cita.
   - Costo del servicio: Infórmale al cliente que el valor base del servicio de mantención preventiva es de $${(config.maintenance_cost || 40000).toLocaleString('es-CL')} CLP. No propongas comisiones adicionales de visita técnica o factibilidad para mantenimientos.
   - Al terminar de recopilar todos los datos, confírmale al cliente de forma muy amable que su solicitud ha sido registrada con éxito y que queda "Pendiente de revisión" por parte del administrador, quien validará los detalles y le enviará la confirmación final por este medio a la brevedad.

2. AGENDA DE HORARIOS OCUPADOS (NO DISPONIBLES EN LA AGENDA):
${calendarContext}
   - Si el cliente te propone un día y hora que coincide con alguno de estos, adviértele amablemente que ya está ocupado y sugiérele alternativas.

3. DERIVACIÓN OBLIGATORIA DE VENTAS / NUEVAS INSTALACIONES:
   - Si el cliente menciona que quiere COMPRAR un equipo de aire acondicionado, COTIZAR un equipo nuevo, o realizar una INSTALACIÓN de equipo nuevo, debes responder EXACTA y ÚNICAMENTE con la siguiente frase, sin añadir ningún saludo, despedida ni texto adicional:
     "Perfecto. Te voy a derivar directamente con nuestro Área de Ventas para que un ejecutivo te asesore con el equipo ideal para tu espacio. Puedes contactarnos de inmediato por WhatsApp aquí: https://wa.me/${salesPhone}. ¡Un momento, por favor!"
   - Es sumamente importante que uses esta frase exacta ante cualquier consulta de ventas o instalación, ya que el sistema la detectará para pausar el bot y asignar un comercial.
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

      const replyText = response.text || 'Disculpa, no pude procesar tu mensaje. ¿Podrías repetirlo?';
      session.history.push({ role: 'model', parts: [{ text: replyText }] });

      // Save image diagnosis to notes, or standard chat text extraction
      if (image) {
        session.leadData.notes = `[Diagnóstico IA Multimodal]: ${replyText.substring(0, 180).replace(/\n/g, ' ')}...`;
      } else {
        this.extractLeadInfo(message, session.leadData, config);
      }

      // Check for sales derivation trigger
      const isSalesDerivation = replyText.includes("Área de Ventas") || replyText.includes("Te voy a derivar directamente");
      if (isSalesDerivation) {
        session.leadData.service_type = 'installation';
        session.leadData.status = 'derivado_ventas';
        session.leadData.notes = `[Derivado a Ventas]: El cliente mostró interés en cotizar/instalar equipos nuevos.`;
      } else if (session.leadData.service_type === 'maintenance') {
        const hasBtu = !!session.leadData.calculated_btu;
        const hasAge = !!session.leadData.installation_age;
        const hasLastMaint = !!session.leadData.last_maintenance_info;
        const hasStatus = session.leadData.is_working_correctly !== undefined;
        const hasAddress = !!session.leadData.address;
        const hasTime = !!session.leadData.appointment_time;
        
        if (hasBtu && hasAge && hasLastMaint && hasStatus && hasAddress && hasTime) {
          session.leadData.status = 'pendiente_revision';
        }
      }

      // Save lead updates to database on every turn to support real-time dashboard feed
      await this.saveLeadToFirestore(cleanPhone, session.leadData);

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
    if (textLower.includes('nunca') || textLower.includes('ningun') || textLower.includes('ningún')) {
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
    if (textLower.includes('funciona bien') || textLower.includes('si funciona') || textLower.includes('funciona correctamente') || textLower.includes('todo bien') || textLower.includes('sí, funciona') || textLower.includes('si, funciona') || textLower.includes('si, todo bien')) {
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
  private async saveLeadToFirestore(phone: string, leadData: any) {
    const defaultStatus = leadData.status || 'Pendiente';
    const createdAt = leadData.created_at || new Date().toISOString();

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
