import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import axios from 'axios';
import { db } from '../services/firebase';
import { clearSession } from '../services/gemini';
import { enviarWhatsApp, TECNICO_POR_DEFECTO } from '../services/notificaciones';
import {
  cuposDelPeriodo, construirCupo, esDiaHabil, SLOT_TIMES, ahoraEnChile,
  leerConfigAgenda, guardarConfigAgenda
} from '../services/agenda';
import { ejecutarCampanaPreventiva, ejecutarSeguimiento24h } from '../services/campanaPreventiva';

const router = Router();

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
    
    // Al técnico no se le avisa aquí: el único aviso es el recordatorio de 1 h antes.

    res.status(201).json({ success: true, message: 'Cliente registrado con éxito.', lead: newLead });
  } catch (error: any) {
    console.warn(`Advertencia: Fallback a mock para crear lead debido a Firestore:`, error.message);
    updateLocalMock(cleanPhone, newLead);
    
    // Al técnico no se le avisa aquí: el único aviso es el recordatorio de 1 h antes.

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

    // Si le cambian el técnico a una visita cuyo recordatorio YA salió, el nuevo se quedaría
    // sin enterarse: ahora el aviso al agendar no existe. Al limpiar la marca, el recordatorio
    // vuelve a dispararse en la siguiente revisión y le llega al que de verdad va a ir.
    const tecnicoPrevio = doc.data()?.technician;
    if (updateData.technician && updateData.technician !== tecnicoPrevio && doc.data()?.reminder_sent_at) {
      updateData.reminder_sent_at = null;
    }
    await leadRef.update(updateData);
    updateLocalMock(phone, updateData);
    // Al técnico no se le avisa aquí: el único aviso es el recordatorio de 1 h antes.
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
    // Al técnico no se le avisa aquí: el único aviso es el recordatorio de 1 h antes.
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

    const reservas = new Map(config.reservas.map(r => [r.id, r]));
    const extras = new Set(config.extras);

    const cupos = cuposDelPeriodo(dias, new Date(), config).map(cupo => {
      const lead = porCupo.get(cupo.id);
      const reserva = reservas.get(cupo.id);
      return {
        ...cupo,
        ocupado: !!lead,
        esExtra: extras.has(cupo.id),
        reservado: !!reserva,
        motivoReserva: reserva?.motivo || null,
        // Quién apartó el cupo y cuándo, para poder mostrarlo en el calendario.
        reservaCreadaPor: reserva?.creadoPor || null,
        reservaCreadaEl: reserva?.creadoEl || null,
        // Se envía la ficha completa del cliente: el calendario mostraba solo el nombre y
        // la dirección, así que las notas y el detalle del servicio quedaban invisibles y
        // había que ir a buscarlos a Gestión de Leads.
        lead: lead
          ? {
              phone: lead.phone,
              client_name: lead.client_name || null,
              service_type: lead.service_type || null,
              status: lead.status || 'Pendiente',
              technician: lead.technician || '',
              address: lead.address || null,
              notes: lead.notes || null,
              contact_phone: lead.contact_phone || null,
              client_type: lead.client_type || null,
              equipment_count: lead.equipment_count || null,
              calculated_btu: lead.calculated_btu || null,
              // Referencia del lugar. Va aparte de address para que la dirección quede limpia
              // y Google Maps no se confunda con textos como "al lado del almacén".
              address_reference: lead.address_reference || null,
              installation_age: lead.installation_age || null,
              last_maintenance_info: lead.last_maintenance_info || null,
              is_working_correctly: lead.is_working_correctly ?? null,
              area_m2: lead.area_m2 || null,
              latitude: lead.latitude || null,
              longitude: lead.longitude || null,
              booked_by: lead.booked_by || null,
              booked_at: lead.booked_at || null,
              reminder_sent_at: lead.reminder_sent_at || null,
              created_at: lead.created_at || null,
              // Estado de la encuesta post-servicio, para poder auditar desde el panel
              // si llegó, si Meta la rechazó y si el cliente ya respondió.
              survey_sent_at: lead.survey_sent_at || null,
              survey_error: lead.survey_error || null,
              satisfaction_rating: lead.satisfaction_rating || null,
              satisfaction_comment: lead.satisfaction_comment || null
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
  config.reservas.push({
    id: slotId,
    // 400 en vez de 120: el motivo es donde se anota lo que toca en esa visita y se
    // estaba cortando a mitad de frase.
    motivo: String(motivo || '').slice(0, 400),
    creadoPor: 'panel',
    creadoEl: new Date().toISOString()
  });
  await guardarConfigAgenda(config);

  console.log(`[AGENDA] Cupo reservado desde el panel: ${slotId} (${motivo || 'sin motivo'})`);
  return res.status(201).json({ success: true });
});

// POST /api/leads/agenda/reserva/:slotId/confirmar - Convierte una reserva en una cita
// real de cliente. Pilar aparta el cupo con una nota ("2 MT VALDILUM") y, cuando confirma
// con el cliente, lo pasa a agendado sin tener que soltar y volver a crear.
// Body: { phone, client_name?, service_type?, address?, notes? }
router.post('/agenda/reserva/:slotId/confirmar', async (req: Request, res: Response) => {
  const slotId = req.params.slotId;
  const { phone, client_name, service_type, address, notes } = req.body || {};

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slotId)) {
    return res.status(400).json({ error: 'Cupo inválido.' });
  }

  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (cleanPhone.length < 8) {
    return res.status(400).json({ error: 'Necesito el teléfono del cliente para agendarlo.' });
  }

  const config = await leerConfigAgenda();
  const reserva = config.reservas.find(r => r.id === slotId);
  if (!reserva) {
    return res.status(404).json({ error: 'Ese cupo no está reservado.' });
  }

  const leads = await cargarLeads();
  const chocaCon = leads.find(
    l => l.appointment_iso === slotId && l.status !== 'Cancelado' && l.phone !== cleanPhone
  );
  if (chocaCon) {
    return res.status(409).json({ error: `Ese cupo ya lo tiene +${chocaCon.phone}.` });
  }

  const [fecha, hora] = slotId.split('T');
  const cupo = construirCupo(fecha, hora);
  const existente = leads.find(l => l.phone === cleanPhone);

  // Lo anotado en la reserva se conserva como nota: es el detalle de lo que hay que hacer.
  const notaReserva = reserva.motivo ? `[Reserva de agenda]: ${reserva.motivo}` : '';
  const notasFinales = [existente?.notes, notaReserva, notes].filter(Boolean).join('\n');

  const datos: Record<string, any> = {
    phone: cleanPhone,
    appointment_iso: cupo.id,
    appointment_time: cupo.label,
    status: 'Agendado',
    booked_by: 'panel',
    booked_at: new Date().toISOString(),
    reminder_sent_at: null,
    service_type: service_type || existente?.service_type || 'maintenance',
    technician: existente?.technician || TECNICO_POR_DEFECTO,
    notes: notasFinales || null,
    ...(client_name ? { client_name } : {}),
    ...(address ? { address } : {}),
    ...(existente ? {} : { created_at: new Date().toISOString() })
  };

  try {
    if (db) {
      await db.collection('leads').doc(cleanPhone).set(datos, { merge: true });
    }
    updateLocalMock(cleanPhone, datos);

    // El cupo deja de estar reservado: ahora es una cita de verdad.
    config.reservas = config.reservas.filter(r => r.id !== slotId);
    await guardarConfigAgenda(config);

    // El técnico se entera por el recordatorio de 1 h antes, no al confirmarse la reserva.

    console.log(`[AGENDA] Reserva ${slotId} confirmada como cita de +${cleanPhone}.`);
    return res.status(200).json({ success: true, appointment_time: cupo.label });
  } catch (error: any) {
    console.error('Error al confirmar la reserva:', error.message);
    return res.status(500).json({ error: error.message });
  }
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
    // Al liberar el cupo se borra también la autoría: la ficha vuelve a estar sin hora.
    update = {
      appointment_iso: null,
      appointment_time: null,
      booked_by: null,
      booked_at: null,
      status: 'Pendiente',
      // Sin esta limpieza, si la cita se vuelve a agendar el técnico nunca recibiría
      // el recordatorio: el sistema creería que ya se lo mandó.
      reminder_sent_at: null
    };
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
    // Queda marcado que la hora la puso una persona desde el panel, no el agente.
    // Así se puede distinguir después cuántas visitas cerró la IA por sí sola.
    update = {
      appointment_iso: cupo.id,
      appointment_time: cupo.label,
      booked_by: 'panel',
      booked_at: new Date().toISOString(),
      status: 'Agendado',
      // La cita cambió de hora: el recordatorio del técnico se vuelve a habilitar.
      reminder_sent_at: null
    };
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
// PUT /api/leads/:phone/telefono - Corrige el número de un cliente.
// Body: { nuevoTelefono }
//
// El teléfono es el ID del documento en Firestore, así que no se puede "editar": hay que
// trasladar la ficha completa a un ID nuevo y borrar la vieja. Se hace acá y no a mano
// para que no se pierdan la conversación, la cita ni el historial en el camino.
router.put('/:phone/telefono', async (req: Request, res: Response) => {
  const actual = (req.params.phone || '').replace(/\D/g, '');
  const nuevo = String(req.body?.nuevoTelefono || '').replace(/\D/g, '');

  if (!actual || !nuevo) {
    return res.status(400).json({ error: 'Faltan el teléfono actual o el nuevo.' });
  }
  if (actual === nuevo) {
    return res.status(400).json({ error: 'El número nuevo es igual al actual.' });
  }
  // 56 + 9 dígitos para Chile; se aceptan 8 a 15 por si alguna vez hay otro país.
  if (nuevo.length < 8 || nuevo.length > 15) {
    return res.status(400).json({
      error: `"${nuevo}" no parece un número válido (tiene ${nuevo.length} dígitos). En Chile son 11: 56 + 9 dígitos.`
    });
  }

  if (!db) {
    return res.status(500).json({ error: 'Sin conexión a la base de datos.' });
  }

  try {
    const refVieja = db.collection('leads').doc(actual);
    const docViejo = await refVieja.get();
    if (!docViejo.exists) {
      return res.status(404).json({ error: 'No existe una ficha con ese número.' });
    }

    const refNueva = db.collection('leads').doc(nuevo);
    const docNuevo = await refNueva.get();
    if (docNuevo.exists) {
      return res.status(409).json({
        error: `Ya existe una ficha con el número +${nuevo}. Revísala antes de mover esta.`
      });
    }

    const datos = { ...docViejo.data(), phone: nuevo };

    // Primero se crea la nueva y solo después se borra la vieja: si algo falla en medio,
    // se queda con la ficha duplicada en vez de perderla.
    await refNueva.set(datos);
    await refVieja.delete();

    updateLocalMock(nuevo, datos);

    // El bot tenía la conversación en memoria bajo el número viejo.
    clearSession(actual);
    clearSession(nuevo);

    console.log(`[TELÉFONO] Ficha trasladada de +${actual} a +${nuevo}.`);
    return res.status(200).json({ success: true, phone: nuevo });
  } catch (error: any) {
    console.error('Error al cambiar el teléfono:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

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

  // Queda anotado en la ficha si salió o no. Antes esto solo se escribía en el registro
  // del servidor, así que desde el panel era imposible saber si a un cliente le llegó
  // la encuesta, si Meta la rechazó, o si simplemente no contestó.
  const ahoraISO = new Date().toISOString();
  const marca: Record<string, any> = r.enviado
    ? { survey_sent_at: ahoraISO, survey_via: r.via, survey_error: null }
    : { survey_attempted_at: ahoraISO, survey_error: (r.motivo || 'desconocido').slice(0, 300) };

  if (db) {
    await db.collection('leads').doc(clientPhone).update(marca).catch(() => {});
  }
  updateLocalMock(clientPhone, marca);

  if (r.enviado) {
    console.log(`[ENCUESTA] Mensaje post-servicio enviado a +${clientPhone} vía ${r.via}`);
  } else {
    console.error(`[ENCUESTA] No se pudo enviar el post-servicio a +${clientPhone}: ${r.motivo}`);
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

// POST /api/leads/send-preventive-offers - Campaña de mantención preventiva anual.
// Con { "preview": true } no envía nada: solo informa a quién le llegaría.
router.post('/send-preventive-offers', async (req: Request, res: Response) => {
  try {
    const preview = req.body?.preview === true || req.query?.preview === 'true';
    const r = await ejecutarCampanaPreventiva({ preview, origen: preview ? 'vista previa' : 'dashboard' });
    res.status(200).json({
      success: true,
      preview: r.preview,
      count: r.enviados,
      candidatos: r.candidatos,
      fallidos: r.fallidos.length,
      errores: r.fallidos.slice(0, 5),
      detalle: r.detalle
    });
  } catch (error: any) {
    console.error('Error al ejecutar la campaña preventiva:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/leads/send-followups - Segundo aviso a quienes no contestaron la oferta
// pasadas 24 h, esta vez con los horarios libres concretos.
// Con { "preview": true } no envía nada.
router.post('/send-followups', async (req: Request, res: Response) => {
  try {
    const preview = req.body?.preview === true || req.query?.preview === 'true';
    const r = await ejecutarSeguimiento24h({ preview });
    res.status(200).json({
      success: true,
      preview: r.preview,
      count: r.enviados,
      candidatos: r.candidatos,
      fallidos: r.fallidos.length,
      errores: r.fallidos.slice(0, 5),
      detalle: r.detalle
    });
  } catch (error: any) {
    console.error('Error al ejecutar el seguimiento de 24 h:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
