import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import axios from 'axios';
import { db } from '../services/firebase';
import { clearSession } from '../services/gemini';
import {
  cuposDelPeriodo, construirCupo, esDiaHabil, SLOT_TIMES, ahoraEnChile,
  leerConfigAgenda, guardarConfigAgenda
} from '../services/agenda';

const router = Router();

/**
 * Envía un mensaje de WhatsApp INICIADO POR LA EMPRESA.
 *
 * Meta bloquea el texto libre si pasaron más de 24 h desde el último mensaje del
 * cliente. Por eso se intenta primero con la plantilla aprobada, que no tiene ese
 * límite, y solo si falla se cae al texto libre (útil mientras Meta revisa las
 * plantillas, o si el cliente escribió recién).
 *
 * Plantillas de la cuenta: recordatorio_mantencion_anual, post_servicio_pago_encuesta
 * y aviso_visita_tecnico.
 */
async function enviarWhatsApp(opciones: {
  to: string;
  texto: string;
  plantilla?: { nombre: string; idioma?: string; variables?: string[] };
}): Promise<{ enviado: boolean; via: 'plantilla' | 'texto' | null; motivo?: string }> {
  const whatsappToken = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!whatsappToken || !phoneId) {
    console.log(`\n[SIMULACIÓN WHATSAPP] Para +${opciones.to}:\n${opciones.texto}\n`);
    return { enviado: false, via: null, motivo: 'WhatsApp no está configurado en este entorno (modo simulación).' };
  }

  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${whatsappToken}` };
  let motivoPlantilla: string | undefined;

  if (opciones.plantilla) {
    try {
      // Meta rechaza parámetros con saltos de línea o vacíos.
      const variables = (opciones.plantilla.variables || []).map(v =>
        String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim() || 'No especificado'
      );

      await axios.post(url, {
        messaging_product: 'whatsapp',
        to: opciones.to,
        type: 'template',
        template: {
          name: opciones.plantilla.nombre,
          language: { code: opciones.plantilla.idioma || 'es' },
          ...(variables.length
            ? { components: [{ type: 'body', parameters: variables.map(text => ({ type: 'text', text })) }] }
            : {})
        }
      }, { headers });

      return { enviado: true, via: 'plantilla' };
    } catch (err: any) {
      motivoPlantilla = err.response?.data?.error?.message || err.message;
      console.warn(`[WHATSAPP] Plantilla "${opciones.plantilla.nombre}" no utilizable todavía: ${motivoPlantilla}`);
    }
  }

  try {
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to: opciones.to,
      type: 'text',
      text: { body: opciones.texto }
    }, { headers });
    return { enviado: true, via: 'texto' };
  } catch (err: any) {
    const motivoTexto = err.response?.data?.error?.message || err.message;
    return {
      enviado: false,
      via: null,
      motivo: motivoPlantilla
        ? `Plantilla: ${motivoPlantilla} — Texto libre: ${motivoTexto}`
        : motivoTexto
    };
  }
}

// Helper function to update local mock JSON file
function updateLocalMock(phone: string, updateData: any): boolean {
  try {
    const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
    if (fs.existsSync(mockLeadsPath)) {
      const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
      const existingIndex = mockData.findIndex((item: any) => item.phone === phone);
      if (existingIndex > -1) {
        mockData[existingIndex] = { ...mockData[existingIndex], ...updateData };
        fs.writeFileSync(mockLeadsPath, JSON.stringify(mockData, null, 2), 'utf8');
        console.log(`[LOCAL MOCK] Guardado exitoso del lead ${phone}:`, updateData);
        return true;
      } else {
        // If it does not exist, we can add it
        const newLead = {
          phone,
          ...updateData,
          created_at: new Date().toISOString()
        };
        mockData.push(newLead);
        fs.writeFileSync(mockLeadsPath, JSON.stringify(mockData, null, 2), 'utf8');
        console.log(`[LOCAL MOCK] Creado exitoso del lead ${phone}:`, newLead);
        return true;
      }
    }
  } catch (err) {
    console.error('Error al actualizar datos mock locales:', err);
  }
  return false;
}

// Helper to read configuration
function loadConfigRules(): any {
  const configPath = path.resolve(process.cwd(), 'data_mock', 'config_reglas.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.error('Error loading config_reglas.json:', err);
    }
  }
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

// GET /api/leads/config - Get current pricing configuration
router.get('/config', (req: Request, res: Response) => {
  try {
    const config = loadConfigRules();
    res.status(200).json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/leads/config - Update pricing configuration
router.put('/config', (req: Request, res: Response) => {
  const newConfig = req.body;
  try {
    const configPath = path.resolve(process.cwd(), 'data_mock', 'config_reglas.json');
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
    console.log('[CONFIG] Configuración de precios actualizada con éxito.');
    res.status(200).json({ success: true, message: 'Configuración actualizada con éxito.', config: newConfig });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/leads - Create a new lead/client manually
router.post('/', async (req: Request, res: Response) => {
  const { client_name, phone, service_type, installation_age, address, appointment_time, area_m2, status, technician, notes, suggest_visit, installation_date, last_maintenance_date, last_maintenance_info, is_working_correctly } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'El número de teléfono es requerido.' });
  }

  // Clean phone number: remove non-digits
  const cleanPhone = phone.replace(/\D/g, '');

  const config = loadConfigRules();

  let calculated_btu = null;
  let finalNotes = notes || '';

  if (service_type === 'installation') {
    if (area_m2) {
      const area = parseInt(area_m2, 10);
      for (const rule of config.btu_matrix) {
        if (area <= rule.max_m2) {
          calculated_btu = rule.btu;
          const pricing = config.pricing_matrix[rule.btu];
          if (pricing && !finalNotes) {
            finalNotes = `Cotización Est. ${rule.btu}: Económica ($${pricing.economicas}), Intermedia ($${pricing.intermedias}), Premium ($${pricing.premium}). Costo Instalación: Entre $${config.installation_cost.min.toLocaleString('es-CL')} y $${config.installation_cost.max.toLocaleString('es-CL')}`;
          }
          break;
        }
      }
    }
    if (suggest_visit) {
      const visitCost = config.feasibility_visit_cost || 5000;
      const visitText = ` [Visita de factibilidad técnica sugerida por un costo mínimo de $${visitCost.toLocaleString('es-CL')} CLP]`;
      if (!finalNotes.includes(visitText)) {
        finalNotes = finalNotes + (finalNotes ? '\n' : '') + visitText;
      }
    }
  } else if (service_type === 'maintenance') {
    if (!finalNotes) {
      const maintCost = config.maintenance_cost || 40000;
      finalNotes = `Servicio de Mantenimiento / Mantención Preventiva. Valor base de visita técnica: $${maintCost.toLocaleString('es-CL')}`;
    }
  }

  const newLead = {
    client_name: client_name || null,
    phone: cleanPhone,
    service_type: service_type || 'installation',
    installation_age: service_type === 'maintenance' && installation_age ? String(installation_age) : null,
    address: address || null,
    appointment_time: appointment_time || null,
    latitude: null,
    longitude: null,
    area_m2: service_type === 'installation' && area_m2 ? parseInt(area_m2, 10) : null,
    calculated_btu,
    status: status || 'Pendiente',
    technician: technician || '',
    notes: finalNotes || null,
    last_maintenance_info: last_maintenance_info || null,
    is_working_correctly: is_working_correctly !== undefined ? is_working_correctly : null,
    installation_date: installation_date || null,
    last_maintenance_date: last_maintenance_date || null,
    created_at: new Date().toISOString()
  };

  try {
    if (db) {
      await db.collection('leads').doc(cleanPhone).set(newLead);
      console.log(`[FIRESTORE] Nuevo lead creado manualmente para el teléfono: ${cleanPhone}`);
    }
    updateLocalMock(cleanPhone, newLead);
    
    // Automatically trigger notification if technician is assigned
    if (newLead.technician) {
      notifyTechnician(newLead.technician, cleanPhone, newLead).catch(err => {
        console.error('Error in notifyTechnician background promise:', err);
      });
    }

    res.status(201).json({ success: true, message: 'Cliente registrado con éxito.', lead: newLead });
  } catch (error: any) {
    console.warn(`Advertencia: Fallback a mock para crear lead debido a Firestore:`, error.message);
    updateLocalMock(cleanPhone, newLead);
    
    if (newLead.technician) {
      notifyTechnician(newLead.technician, cleanPhone, newLead).catch(err => {
        console.error('Error in notifyTechnician background promise:', err);
      });
    }

    res.status(201).json({ success: true, message: 'Cliente registrado con éxito (local mock).', lead: newLead });
  }
});

// GET /api/leads - List all leads
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!db) throw new Error('Firestore no está inicializado.');
    const snapshot = await db.collection('leads').orderBy('created_at', 'desc').get();
    const leads: any[] = [];
    snapshot.forEach(doc => {
      leads.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json(leads);
  } catch (error: any) {
    console.warn('Advertencia: Usando fallback de datos locales debido a error en Firestore:', error.message);
    
    // Fallback to data_mock/clientes_leads.json
    try {
      const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
      if (fs.existsSync(mockLeadsPath)) {
        const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
        // Map mock data to standard model
        const leads = mockData.map((item: any, index: number) => ({
          id: `mock-${index}`,
          client_name: item.client_name || null,
          phone: item.phone || `5690000000${index}`,
          service_type: item.service_type || 'installation',
          installation_age: item.installation_age !== undefined ? item.installation_age : null,
          address: item.address !== undefined ? item.address : null,
          appointment_time: item.appointment_time !== undefined ? item.appointment_time : null,
          appointment_iso: item.appointment_iso !== undefined ? item.appointment_iso : null,
          latitude: item.latitude !== undefined ? item.latitude : null,
          longitude: item.longitude !== undefined ? item.longitude : null,
          area_m2: item.area_m2 !== undefined ? item.area_m2 : null,
          calculated_btu: item.calculated_btu !== undefined ? item.calculated_btu : null,
          status: item.status || 'Pendiente',
          technician: item.technician || '',
          notes: item.notes !== undefined ? item.notes : null,
          technical_notes: item.technical_notes !== undefined ? item.technical_notes : null,
          last_maintenance_info: item.last_maintenance_info !== undefined ? item.last_maintenance_info : null,
          is_working_correctly: item.is_working_correctly !== undefined ? item.is_working_correctly : null,
          installation_date: item.installation_date !== undefined ? item.installation_date : null,
          last_maintenance_date: item.last_maintenance_date !== undefined ? item.last_maintenance_date : null,
          client_type: item.client_type !== undefined ? item.client_type : null,
          contact_phone: item.contact_phone !== undefined ? item.contact_phone : null,
          equipment_count: item.equipment_count !== undefined ? item.equipment_count : null,
          payment_method: item.payment_method !== undefined ? item.payment_method : null,
          satisfaction_rating: item.satisfaction_rating !== undefined ? item.satisfaction_rating : null,
          satisfaction_comment: item.satisfaction_comment !== undefined ? item.satisfaction_comment : null,
          conversation: Array.isArray(item.conversation) ? item.conversation : [],
          last_message_at: item.last_message_at !== undefined ? item.last_message_at : null,
          created_at: item.created_at || new Date().toISOString()
        }));
        return res.status(200).json(leads);
      }
    } catch (fallbackError) {
      console.error('Error al leer datos mock:', fallbackError);
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/leads/:phone - Update lead status or data
router.put('/:phone', async (req: Request, res: Response) => {
  const { phone } = req.params;
  const updateData = req.body;

  try {
    if (!db) throw new Error('Firestore no está inicializado.');
    const leadRef = db.collection('leads').doc(phone);
    const doc = await leadRef.get();
    if (!doc.exists) {
      // For testing, update local mock anyway
      updateLocalMock(phone, updateData);
      return res.status(404).json({ error: 'El lead especificado no existe en Firestore.' });
    }

    const previousStatus = doc.data()?.status;
    await leadRef.update(updateData);
    updateLocalMock(phone, updateData);
    if (updateData.technician) {
      notifyTechnician(updateData.technician, phone, updateData).catch(err => {
        console.error('Error in notifyTechnician background promise:', err);
      });
    }
    // Al cerrar la venta/servicio (estado Instalado): registrar fecha para el recordatorio
    // anual y enviar la encuesta de satisfacción al cliente
    if (updateData.status === 'Instalado' && previousStatus !== 'Instalado') {
      const serviceType = updateData.service_type || doc.data()?.service_type;
      const completionDate = new Date().toISOString();
      const dateField = serviceType === 'installation' ? 'installation_date' : 'last_maintenance_date';
      await leadRef.update({ [dateField]: completionDate });
      updateLocalMock(phone, { [dateField]: completionDate });

      sendSatisfactionSurvey(phone).catch(err => {
        console.error('Error enviando encuesta de satisfacción:', err);
      });
    }
    res.status(200).json({ success: true, message: 'Lead actualizado con éxito.' });
  } catch (error: any) {
    console.warn(`Advertencia: Simulando actualización de lead ${phone} debido a error en Firestore:`, error.message);

    // Fallback: update local JSON mock file
    updateLocalMock(phone, updateData);
    if (updateData.technician) {
      notifyTechnician(updateData.technician, phone, updateData).catch(err => {
        console.error('Error in notifyTechnician background promise:', err);
      });
    }
    if (updateData.status === 'Instalado') {
      sendSatisfactionSurvey(phone).catch(err => {
        console.error('Error enviando encuesta de satisfacción:', err);
      });
    }
    res.status(200).json({ success: true, message: 'Lead actualizado con éxito (local mock).' });
  }
});

/** Todos los leads, desde Firestore o del respaldo local. */
async function cargarLeads(): Promise<any[]> {
  if (db) {
    try {
      const snapshot = await db.collection('leads').get();
      const leads: any[] = [];
      snapshot.forEach(doc => leads.push({ id: doc.id, ...doc.data() }));
      return leads;
    } catch (e: any) {
      console.warn('Agenda: fallback al respaldo local -', e.message);
    }
  }
  try {
    const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
    if (fs.existsSync(mockLeadsPath)) {
      return JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
    }
  } catch (e) {
    console.error('Agenda: no se pudo leer el respaldo local:', e);
  }
  return [];
}

// GET /api/leads/agenda - Calendario para el dashboard.
// Devuelve los cupos reales (lunes a viernes, 09:15 y 14:00) con quién los tiene tomados.
router.get('/agenda', async (req: Request, res: Response) => {
  try {
    const dias = Math.min(Math.max(parseInt(String(req.query.dias || '28'), 10) || 28, 7), 120);
    const [leads, config] = await Promise.all([cargarLeads(), leerConfigAgenda()]);

    const porCupo = new Map<string, any>();
    for (const lead of leads) {
      if (lead.appointment_iso && lead.status !== 'Cancelado') {
        porCupo.set(lead.appointment_iso, lead);
      }
    }

    const reservas = new Map(config.reservas.map(r => [r.id, r.motivo]));
    const extras = new Set(config.extras);

    const cupos = cuposDelPeriodo(dias, new Date(), config).map(cupo => {
      const lead = porCupo.get(cupo.id);
      return {
        ...cupo,
        ocupado: !!lead,
        esExtra: extras.has(cupo.id),
        reservado: reservas.has(cupo.id),
        motivoReserva: reservas.get(cupo.id) || null,
        lead: lead
          ? {
              phone: lead.phone,
              client_name: lead.client_name || null,
              service_type: lead.service_type || null,
              status: lead.status || 'Pendiente',
              technician: lead.technician || '',
              address: lead.address || null
            }
          : null
      };
    });

    // Citas que quedaron fuera del período mostrado o en horarios que ya no existen.
    const idsDelPeriodo = new Set(cupos.map(c => c.id));
    const fueraDeAgenda = [...porCupo.entries()]
      .filter(([id]) => !idsDelPeriodo.has(id))
      .map(([id, lead]) => ({ id, phone: lead.phone, status: lead.status || 'Pendiente' }));

    return res.status(200).json({
      hoy: ahoraEnChile().date,
      horarios: SLOT_TIMES,
      cupos,
      fueraDeAgenda
    });
  } catch (error: any) {
    console.error('Error armando la agenda:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/leads/agenda/cupo - Pilar agrega un horario extra fuera de los dos base.
// Body: { date: "YYYY-MM-DD", time: "HH:mm" }
router.post('/agenda/cupo', async (req: Request, res: Response) => {
  const { date, time } = req.body || {};

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}$/.test(String(time))) {
    return res.status(400).json({ error: 'Fecha u hora con formato inválido.' });
  }
  if (date < ahoraEnChile().date) {
    return res.status(400).json({ error: 'No se pueden agregar horarios en el pasado.' });
  }

  const id = `${date}T${time}`;
  const config = await leerConfigAgenda();

  // Si ya es un horario base de un día hábil, no hace falta agregarlo.
  if (esDiaHabil(date) && (SLOT_TIMES as readonly string[]).includes(time)) {
    return res.status(409).json({ error: 'Ese horario ya existe en la agenda normal.' });
  }
  if (config.extras.includes(id)) {
    return res.status(409).json({ error: 'Ese horario ya estaba agregado.' });
  }

  config.extras.push(id);
  // Agregar un horario lo desbloquea si estaba reservado.
  config.reservas = config.reservas.filter(r => r.id !== id);
  await guardarConfigAgenda(config);

  console.log(`[AGENDA] Horario extra agregado: ${id}`);
  return res.status(201).json({ success: true, cupo: construirCupo(date, time) });
});

// DELETE /api/leads/agenda/cupo/:slotId - Quitar un horario extra.
router.delete('/agenda/cupo/:slotId', async (req: Request, res: Response) => {
  const slotId = req.params.slotId;
  const config = await leerConfigAgenda();

  if (!config.extras.includes(slotId)) {
    return res.status(404).json({ error: 'Ese horario extra no existe.' });
  }

  const leads = await cargarLeads();
  const ocupado = leads.find(l => l.appointment_iso === slotId && l.status !== 'Cancelado');
  if (ocupado) {
    return res.status(409).json({ error: `No se puede quitar: lo tiene +${ocupado.phone}.` });
  }

  config.extras = config.extras.filter(id => id !== slotId);
  await guardarConfigAgenda(config);
  return res.status(200).json({ success: true });
});

// POST /api/leads/agenda/reserva - Pilar aparta un cupo con anticipación.
// El bot deja de ofrecerlo. Body: { slotId, motivo }
router.post('/agenda/reserva', async (req: Request, res: Response) => {
  const { slotId, motivo } = req.body || {};

  if (typeof slotId !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slotId)) {
    return res.status(400).json({ error: 'Cupo inválido.' });
  }

  const leads = await cargarLeads();
  const ocupado = leads.find(l => l.appointment_iso === slotId && l.status !== 'Cancelado');
  if (ocupado) {
    return res.status(409).json({ error: `Ese cupo ya lo tiene el cliente +${ocupado.phone}.` });
  }

  const config = await leerConfigAgenda();
  config.reservas = config.reservas.filter(r => r.id !== slotId);
  config.reservas.push({ id: slotId, motivo: String(motivo || '').slice(0, 120) });
  await guardarConfigAgenda(config);

  console.log(`[AGENDA] Cupo reservado por Pilar: ${slotId} (${motivo || 'sin motivo'})`);
  return res.status(201).json({ success: true });
});

// DELETE /api/leads/agenda/reserva/:slotId - Soltar un cupo reservado.
router.delete('/agenda/reserva/:slotId', async (req: Request, res: Response) => {
  const config = await leerConfigAgenda();
  const antes = config.reservas.length;
  config.reservas = config.reservas.filter(r => r.id !== req.params.slotId);

  if (config.reservas.length === antes) {
    return res.status(404).json({ error: 'Ese cupo no estaba reservado.' });
  }

  await guardarConfigAgenda(config);
  return res.status(200).json({ success: true });
});

// PUT /api/leads/:phone/appointment - Mover o liberar la cita de un cliente.
// Body: { slotId: "YYYY-MM-DDTHH:mm" } para mover, o { slotId: null } para liberar.
router.put('/:phone/appointment', async (req: Request, res: Response) => {
  const cleanPhone = (req.params.phone || '').replace(/\D/g, '');
  const { slotId } = req.body || {};

  if (!cleanPhone) {
    return res.status(400).json({ error: 'Número de teléfono inválido.' });
  }

  let update: any;

  if (slotId === null || slotId === '') {
    update = { appointment_iso: null, appointment_time: null };
  } else {
    if (typeof slotId !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slotId)) {
      return res.status(400).json({ error: 'Formato de cupo inválido.' });
    }

    const [fecha, hora] = slotId.split('T');
    const config = await leerConfigAgenda();

    // El cupo tiene que existir de verdad: horario base de día hábil, o extra agregado.
    const existe = cuposDelPeriodo(120, new Date(), config).some(c => c.id === slotId);
    if (!existe) {
      const motivo = !esDiaHabil(fecha)
        ? 'Solo se atiende de lunes a viernes.'
        : !(SLOT_TIMES as readonly string[]).includes(hora)
          ? `Solo existen los horarios ${SLOT_TIMES.join(' y ')}, salvo que agregues ese horario a la agenda.`
          : 'Ese cupo ya pasó o está fuera del rango.';
      return res.status(400).json({ error: motivo });
    }

    if (config.reservas.some(r => r.id === slotId)) {
      return res.status(409).json({ error: 'Ese cupo está reservado. Suéltalo primero si quieres usarlo.' });
    }

    // No permitir dos clientes en el mismo cupo.
    const leads = await cargarLeads();
    const chocaCon = leads.find(
      l => l.appointment_iso === slotId && l.status !== 'Cancelado' && l.phone !== cleanPhone
    );
    if (chocaCon) {
      return res.status(409).json({ error: `Ese cupo ya lo tiene +${chocaCon.phone}.` });
    }

    const cupo = construirCupo(fecha, hora);
    update = { appointment_iso: cupo.id, appointment_time: cupo.label };
  }

  try {
    if (db) {
      await db.collection('leads').doc(cleanPhone).update(update);
    }
    updateLocalMock(cleanPhone, update);
    console.log(`[AGENDA] Cita de +${cleanPhone} -> ${update.appointment_iso || 'liberada'}`);
    return res.status(200).json({ success: true, ...update });
  } catch (error: any) {
    console.error('Error moviendo la cita:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/leads/:phone - Eliminar una ficha completa.
// Pensado para limpiar los chats de prueba hechos con números propios, que de otra
// forma aparecen ante los jueces como si fueran clientes reales.
router.delete('/:phone', async (req: Request, res: Response) => {
  const cleanPhone = (req.params.phone || '').replace(/\D/g, '');

  if (!cleanPhone) {
    return res.status(400).json({ error: 'Número de teléfono inválido.' });
  }

  let deletedFromDb = false;
  try {
    if (db) {
      const leadRef = db.collection('leads').doc(cleanPhone);
      const doc = await leadRef.get();
      if (doc.exists) {
        await leadRef.delete();
        deletedFromDb = true;
        console.log(`[BORRADO] Ficha ${cleanPhone} eliminada de Firestore.`);
      }
    }
  } catch (error: any) {
    console.error(`Error al eliminar la ficha ${cleanPhone} de Firestore:`, error.message);
    return res.status(500).json({ error: `No se pudo eliminar: ${error.message}` });
  }

  // Sacarla también del respaldo local
  let deletedFromMock = false;
  try {
    const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
    if (fs.existsSync(mockLeadsPath)) {
      const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
      const filtered = mockData.filter((item: any) => item.phone !== cleanPhone);
      if (filtered.length !== mockData.length) {
        fs.writeFileSync(mockLeadsPath, JSON.stringify(filtered, null, 2), 'utf8');
        deletedFromMock = true;
      }
    }
  } catch (error: any) {
    console.error('Error al eliminar la ficha del respaldo local:', error.message);
  }

  // Y que el bot olvide la conversación que tenía en memoria.
  clearSession(cleanPhone);

  if (!deletedFromDb && !deletedFromMock) {
    return res.status(404).json({ error: 'No se encontró esa ficha para eliminar.' });
  }

  return res.status(200).json({
    success: true,
    message: `Ficha de +${cleanPhone} eliminada.`,
    deletedFromDb,
    deletedFromMock
  });
});

// GET /api/leads/route-optimization - Get optimized list of visits
router.get('/route-optimization', async (req: Request, res: Response) => {
  try {
    if (!db) throw new Error('Firestore no está inicializado.');
    const snapshot = await db.collection('leads').get();
    const leads: any[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const status = data.status || 'Pendiente';
      // Route optimization only concerns active pending/evaluated visits
      if (data.latitude && data.longitude && status !== 'Instalado' && status !== 'Cancelado') {
        leads.push({ id: doc.id, ...data });
      }
    });

    if (leads.length === 0) {
      return res.status(200).json([]);
    }
    return res.status(200).json(optimizeRouteHelper(leads));
  } catch (error: any) {
    console.warn('Advertencia: Usando fallback de rutas locales debido a error en Firestore:', error.message);
    
    // Fallback optimization using mock data
    try {
      const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
      if (fs.existsSync(mockLeadsPath)) {
        const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
        const leads = mockData
          .filter((item: any) => {
            const status = item.status || 'Pendiente';
            return item.latitude && item.longitude && status !== 'Instalado' && status !== 'Cancelado';
          })
          .map((item: any, index: number) => ({
            id: `mock-${index}`,
            phone: item.phone || '56912345678',
            service_type: item.service_type || 'installation',
            address: item.address || 'Antonio Duce 795, Niebla',
            latitude: item.latitude,
            longitude: item.longitude,
            status: item.status || 'Pendiente'
          }));
        return res.status(200).json(optimizeRouteHelper(leads));
      }
    } catch (fallbackError) {
      console.error('Error al optimizar rutas en fallback:', fallbackError);
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/leads/export-email - Send CSV report to accountant
router.post('/export-email', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'El correo electrónico del contador es requerido.' });
  }

  try {
    let completedLeads: any[] = [];
    
    // 1. Fetch leads
    try {
      if (!db) throw new Error('Firestore no está inicializado.');
      const snapshot = await db.collection('leads').get();
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.status === 'Instalado') {
          completedLeads.push({ id: doc.id, ...data });
        }
      });
    } catch (dbError: any) {
      console.warn('Advertencia: Usando fallback de datos locales para envío de correo:', dbError.message);
      const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
      if (fs.existsSync(mockLeadsPath)) {
        const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
        completedLeads = mockData.filter((item: any) => item.status === 'Instalado');
      }
    }

    if (completedLeads.length === 0) {
      return res.status(400).json({ error: 'No hay servicios marcados como "Instalado" para exportar.' });
    }

    // 2. Generate CSV Content (Semicolon separator & BOM for Excel Spanish)
    const headers = ['Teléfono', 'Servicio', 'BTU / Detalle', 'Dirección', 'Fecha Cita', 'Técnico', 'Estado', 'Notas Técnicas', 'Fecha Registro'];
    const rows = completedLeads.map(lead => [
      `+${lead.phone}`,
      lead.service_type === 'installation' ? 'Instalación' : 'Mantenimiento',
      lead.service_type === 'installation' ? lead.calculated_btu || 'N/A' : `Antigüedad: ${lead.installation_age || 'N/A'}`,
      lead.address || '',
      lead.appointment_time || '',
      lead.technician || 'No asignado',
      lead.status,
      lead.technical_notes || lead.notes || 'Sin notas',
      lead.created_at ? new Date(lead.created_at).toLocaleDateString('es-CL') : new Date().toLocaleDateString('es-CL')
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    // Convert to buffer with UTF-8 BOM
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const csvBuffer = Buffer.concat([bom, Buffer.from(csvContent, 'utf8')]);

    // 3. Configure Nodemailer Transporter
    let transporter;
    let isTestAccount = false;
    let testUrl = '';

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpHost && smtpUser && smtpPass) {
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort || '587', 10),
        secure: smtpPort === '465',
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });
      console.log('Usando configuración SMTP real:', smtpHost);
    } else {
      // Ethereal Email fallback
      console.log('No se detectaron credenciales SMTP reales. Creando cuenta de prueba en Ethereal...');
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      isTestAccount = true;
    }

    const mailOptions = {
      from: smtpUser || '"Furtz Clima OS" <noreply@ecoclimafurtz.cl>',
      to: email,
      subject: `Reporte de Instalaciones Furtz Clima - ${new Date().toLocaleDateString('es-CL')}`,
      text: `Estimado(a) Contador(a),\n\nAdjunto a este correo encontrará el reporte de servicios de climatización completados ("Instalados") por la empresa FURTZ, generado de manera automática desde el panel de control operativo.\n\nFecha de emisión: ${new Date().toLocaleString('es-CL')}\nTotal de registros: ${completedLeads.length}\n\nAtentamente,\nFurtz Clima OS\nAutomatización de Procesos`,
      attachments: [
        {
          filename: `reporte_contador_furtz_${new Date().toISOString().split('T')[0]}.csv`,
          content: csvBuffer
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Mensaje enviado con éxito: %s', info.messageId);

    if (isTestAccount) {
      testUrl = nodemailer.getTestMessageUrl(info) || '';
      console.log('URL de vista previa del correo de prueba (Ethereal):', testUrl);
    }

    res.status(200).json({
      success: true,
      message: isTestAccount 
        ? 'Correo de prueba enviado con éxito a la bandeja virtual.' 
        : `Reporte enviado con éxito al correo ${email}.`,
      testUrl
    });

  } catch (error: any) {
    console.error('Error al exportar y enviar por correo:', error);
    res.status(500).json({ error: `No se pudo enviar el correo: ${error.message}` });
  }
});

// Helper route optimization logic
function optimizeRouteHelper(leads: any[]): any[] {
  const startPoint = { latitude: -39.8142, longitude: -73.2459 };
  const unvisited = [...leads];
  const optimizedRoute: any[] = [];
  let currentPoint = startPoint;

  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = Math.sqrt(
        Math.pow(unvisited[i].latitude - currentPoint.latitude, 2) +
        Math.pow(unvisited[i].longitude - currentPoint.longitude, 2)
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearestIndex = i;
      }
    }

    const nextStop = unvisited.splice(nearestIndex, 1)[0];
    optimizedRoute.push(nextStop);
    currentPoint = { latitude: nextStop.latitude, longitude: nextStop.longitude };
  }

  return optimizedRoute;
}

// Helper to notify technician of assignment
async function notifyTechnician(technicianName: string, leadPhone: string, leadDataUpdate: any) {
  try {
    // Solo técnicos con número REAL verificado. Sin números de relleno.
    const techPhones: { [key: string]: string } = {
      'francisco': '56990939188'
    };

    const cleanName = technicianName.toLowerCase().trim();
    const techPhone = techPhones[cleanName];
    if (!techPhone) {
      console.log(`[NOTIFICACIÓN TÉCNICO] No hay número registrado para el técnico: "${technicianName}"`);
      return;
    }

    // La ficha se lee de FIRESTORE. Antes se leía de data_mock/clientes_leads.json,
    // que en Cloud Run vive en un disco efímero y se borra en cada reinicio: por eso
    // al técnico le llegaba "Dirección: No especificada" aunque el dato sí existiera.
    let fullLead: any = { phone: leadPhone, ...leadDataUpdate };

    if (db) {
      try {
        const doc = await db.collection('leads').doc(leadPhone).get();
        if (doc.exists) fullLead = { ...doc.data(), ...leadDataUpdate, phone: leadPhone };
      } catch (err: any) {
        console.error('Error leyendo el lead desde Firestore para avisar al técnico:', err.message);
      }
    } else {
      try {
        const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
        if (fs.existsSync(mockLeadsPath)) {
          const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
          const found = mockData.find((item: any) => item.phone === leadPhone);
          if (found) fullLead = { ...found, ...leadDataUpdate };
        }
      } catch (err) {
        console.error('Error al leer el lead para la notificación del técnico:', err);
      }
    }

    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const enlaceMapa = fullLead.latitude && fullLead.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${fullLead.latitude},${fullLead.longitude}`
      : null;
    const sinUbicacion = !fullLead.address && !enlaceMapa;

    const messageText = `Hola ${technicianName}, se te ha asignado una nueva visita técnica en Furtz Clima OS:\n\n` +
      `📞 Cliente: +${fullLead.phone}\n` +
      `🔧 Servicio: ${fullLead.service_type === 'installation' ? 'Instalación' : 'Mantenimiento'}\n` +
      `📍 Dirección: ${fullLead.address || 'no registrada'}\n` +
      (enlaceMapa ? `🗺️ Ubicación GPS: ${enlaceMapa}\n` : '') +
      `📅 Fecha Cita: ${fullLead.appointment_time || 'Por definir'}\n` +
      `📐 Capacidad/Detalle: ${fullLead.calculated_btu || fullLead.installation_age || 'N/A'}\n` +
      `📝 Notas: ${fullLead.notes || 'Sin notas adicionales'}\n\n` +
      (sinUbicacion ? `⚠️ Esta visita NO tiene dirección registrada. Contacta al cliente antes de salir.\n\n` : '') +
      `Por favor, ingresa al Módulo de Terreno para ejecutar la lista de chequeo y certificar la calidad del servicio.`;

    const r = await enviarWhatsApp({
      to: techPhone,
      texto: messageText,
      plantilla: {
        nombre: 'aviso_visita_tecnico',
        variables: [
          technicianName,
          `+${fullLead.phone}`,
          fullLead.service_type === 'installation' ? 'Instalación' : 'Mantención',
          fullLead.address || 'Sin dirección registrada',
          fullLead.appointment_time || 'Por definir'
        ]
      }
    });

    if (r.enviado) {
      console.log(`[WHATSAPP] Aviso enviado al técnico ${technicianName} (+${techPhone}) vía ${r.via}`);
    } else {
      console.error(`[WHATSAPP] No se pudo avisar al técnico ${technicianName}: ${r.motivo}`);
    }
  } catch (error: any) {
    console.error(`Error al enviar notificación de WhatsApp al técnico:`, error.response?.data || error.message);
  }
}

// Send post-service satisfaction survey to the client via WhatsApp
async function sendSatisfactionSurvey(clientPhone: string) {
  // Primero la forma de pago (por eso el bot ya no la pregunta al inicio),
  // y después la encuesta. El bot continúa el hilo (ver MODO POST-SERVICIO en gemini.ts).
  const messageText = `¡Hola! Te saluda el asistente virtual de Furtz Clima 😊\n\n` +
    `Tu servicio ya fue completado. Para cerrar tu ficha, cuéntame:\n\n` +
    `💳 ¿Qué forma de pago prefieres: *transferencia*, *efectivo* o *débito/crédito*?\n\n` +
    `Después te hago 4 preguntas cortitas para saber cómo lo hicimos 👇`;

  const r = await enviarWhatsApp({
    to: clientPhone,
    texto: messageText,
    plantilla: { nombre: 'post_servicio_pago_encuesta' }
  });

  if (r.enviado) {
    console.log(`[WHATSAPP] Mensaje post-servicio enviado a +${clientPhone} vía ${r.via}`);
  } else {
    console.error(`[WHATSAPP] No se pudo enviar el post-servicio a +${clientPhone}: ${r.motivo}`);
  }

  return { sent: r.enviado, reason: r.motivo, via: r.via };
}

// POST /api/leads/:phone/send-survey - Disparar a mano el mensaje post-servicio
// (forma de pago + encuesta) desde el dashboard, sin tener que cambiar el estado.
router.post('/:phone/send-survey', async (req: Request, res: Response) => {
  const cleanPhone = (req.params.phone || '').replace(/\D/g, '');

  if (!cleanPhone) {
    return res.status(400).json({ error: 'Número de teléfono inválido.' });
  }

  // Dejar al cliente inscrito en el recordatorio anual de mantención. Si el servicio
  // se cerró por esta vía y no por el estado "Instalado", la fecha no estaría grabada
  // y la campaña automática nunca lo encontraría.
  let reminderRegistered = false;
  try {
    if (db) {
      const leadRef = db.collection('leads').doc(cleanPhone);
      const doc = await leadRef.get();
      const data = doc.exists ? doc.data() : null;

      if (data) {
        const dateField = data.service_type === 'installation' ? 'installation_date' : 'last_maintenance_date';
        if (!data[dateField]) {
          const completionDate = new Date().toISOString();
          await leadRef.update({ [dateField]: completionDate });
          updateLocalMock(cleanPhone, { [dateField]: completionDate });
          reminderRegistered = true;
          console.log(`[RECORDATORIO ANUAL] ${cleanPhone} inscrito con ${dateField} = ${completionDate}`);
        }
      }
    }
  } catch (err: any) {
    console.error('No se pudo registrar la fecha para el recordatorio anual:', err.message);
  }

  const result = await sendSatisfactionSurvey(cleanPhone);

  if (result.sent) {
    return res.status(200).json({
      success: true,
      message: 'Mensaje enviado al cliente por WhatsApp.',
      reminderRegistered
    });
  }

  return res.status(502).json({
    success: false,
    error: result.reason,
    hint: 'Si el cliente no te escribe hace más de 24 horas, Meta bloquea el mensaje hasta que exista una plantilla aprobada.'
  });
});

// POST /api/leads/send-preventive-offers - Trigger preventive maintenance campaign
router.post('/send-preventive-offers', async (req: Request, res: Response) => {
  try {
    let allLeads: any[] = [];
    let fetchedFromDb = false;
    
    if (db) {
      try {
        const snapshot = await db.collection('leads').get();
        snapshot.forEach(doc => {
          allLeads.push({ phone: doc.id, ...doc.data() });
        });
        fetchedFromDb = true;
      } catch (dbErr: any) {
        console.warn('Advertencia: Fallback a mock local para campaña debido a error en Firestore:', dbErr.message);
      }
    }

    if (!fetchedFromDb) {
      const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
      if (fs.existsSync(mockLeadsPath)) {
        allLeads = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
      }
    }

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const eligibleLeads = allLeads.filter(lead => {
      // 1. Check dates
      if (lead.installation_date) {
        const instDate = new Date(lead.installation_date);
        if (instDate < oneYearAgo) return true;
      }
      if (lead.last_maintenance_date) {
        const maintDate = new Date(lead.last_maintenance_date);
        if (maintDate < oneYearAgo) return true;
      }

      // 2. Check string fields as fallback
      if (lead.installation_age) {
        const age = String(lead.installation_age).toLowerCase();
        if (age.includes('1 año') || age.includes('2 año') || age.includes('3 año') || age.includes('año') || age.includes('ano') || age.includes('years') || age.includes('year')) {
          if (!age.includes('mes') || age.includes('12 mes') || age.includes('18 mes') || age.includes('24 mes')) {
            return true;
          }
        }
      }
      if (lead.last_maintenance_info) {
        const info = String(lead.last_maintenance_info).toLowerCase();
        if (info.includes('nunca') || info.includes('1 año') || info.includes('2 año') || info.includes('3 año') || info.includes('año') || info.includes('ano') || info.includes('years') || info.includes('year')) {
          return true;
        }
      }

      return false;
    });

    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    let sentCount = 0;
    const fallidos: Array<{ phone: string; motivo: string }> = [];

    for (const lead of eligibleLeads) {
      // El mensaje cambia según si el servicio original fue Instalación o Mantención
      const wasInstallation = lead.service_type === 'installation';
      const equipos = lead.equipment_count && lead.equipment_count > 1
        ? `tus ${lead.equipment_count} equipos`
        : 'tu equipo';
      const referencia = wasInstallation
        ? `se cumple un año desde que instalamos ${equipos} de aire acondicionado`
        : `se cumple un año desde la última mantención de ${equipos} de aire acondicionado`;

      const campaignMessage =
        `¡Hola! 👋 Te saluda el asistente virtual de *Furtz Clima*.\n\n` +
        `Queremos contarte que ${referencia}. 🗓️\n\n` +
        `Para mantener su rendimiento, evitar fallas y prolongar su vida útil, te recomendamos realizar la *mantención preventiva anual*.\n\n` +
        `¿Te gustaría agendar tu visita? Respóndenos *SÍ* a este mensaje y coordinamos día y hora según nuestra disponibilidad. 😊`;

      const r = await enviarWhatsApp({
        to: lead.phone,
        texto: campaignMessage,
        plantilla: { nombre: 'recordatorio_mantencion_anual', variables: [equipos] }
      });

      const enviado = r.enviado;
      const motivoFallo = r.motivo || null;

      if (enviado) {
        console.log(`[CAMPAÑA PREVENTIVA] Enviada a +${lead.phone} vía ${r.via}`);
      } else {
        console.error(`[CAMPAÑA PREVENTIVA] Falló para +${lead.phone}: ${motivoFallo}`);
      }

      // Solo se cuenta y se anota si el mensaje SALIÓ de verdad. Antes el contador
      // subía igual aunque Meta rechazara el envío, y la ficha quedaba marcada como
      // "Oferta enviada": el dashboard informaba envíos que nunca ocurrieron.
      if (!enviado) {
        fallidos.push({ phone: lead.phone, motivo: motivoFallo || 'desconocido' });
        continue;
      }

      // El mensaje de campaña se guarda EN LA CONVERSACIÓN del cliente. Sin esto, cuando
      // el cliente responde "SÍ", el bot no sabe qué le ofrecimos y lo trata como si
      // escribiera por primera vez: le vuelve a preguntar qué servicio busca.
      const conversacionPrevia = Array.isArray(lead.conversation) ? lead.conversation : [];

      const updateData = {
        notes: (lead.notes ? lead.notes + '\n' : '') + `[Campaña Preventiva]: Oferta enviada el ${new Date().toLocaleDateString('es-CL')}.`,
        last_maintenance_info: lead.last_maintenance_info || 'Hace más de 1 año',
        status: 'Pendiente',
        service_type: lead.service_type || 'maintenance',
        conversation: [...conversacionPrevia, { role: 'model', text: campaignMessage }].slice(-60),
        last_message_at: new Date().toISOString()
      };

      if (db) {
        await db.collection('leads').doc(lead.phone).update(updateData).catch(() => {});
      }
      updateLocalMock(lead.phone, updateData);

      // El bot tiene la conversación en memoria; se borra para que la vuelva a leer
      // desde la base y vea el mensaje de campaña que acabamos de enviar.
      clearSession(lead.phone);

      sentCount++;
    }

    res.status(200).json({
      success: true,
      count: sentCount,
      candidatos: eligibleLeads.length,
      fallidos: fallidos.length,
      // Meta rechaza los mensajes iniciados por la empresa pasadas 24 h desde el
      // último mensaje del cliente, salvo que se use una plantilla aprobada.
      errores: fallidos.slice(0, 5)
    });
  } catch (error: any) {
    console.error('Error al ejecutar la campaña preventiva:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
