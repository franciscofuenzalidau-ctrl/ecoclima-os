import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import axios from 'axios';
import { db } from '../services/firebase';

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

    await leadRef.update(updateData);
    updateLocalMock(phone, updateData);
    if (updateData.technician) {
      notifyTechnician(updateData.technician, phone, updateData).catch(err => {
        console.error('Error in notifyTechnician background promise:', err);
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
    res.status(200).json({ success: true, message: 'Lead actualizado con éxito (local mock).' });
  }
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
    const techPhones: { [key: string]: string } = {
      'francisco': '56990939188',
      'felipe': '56911112222', // demo
      'juan': '56933334444' // demo
    };

    const cleanName = technicianName.toLowerCase().trim();
    const techPhone = techPhones[cleanName];
    if (!techPhone) {
      console.log(`[NOTIFICACIÓN TÉCNICO] No se encontró número registrado para el técnico: "${technicianName}"`);
      return;
    }

    // Try to retrieve the full lead info from local mock or database to build a complete notification
    let fullLead: any = { phone: leadPhone, ...leadDataUpdate };
    
    try {
      const mockLeadsPath = path.resolve(process.cwd(), 'data_mock', 'clientes_leads.json');
      if (fs.existsSync(mockLeadsPath)) {
        const mockData = JSON.parse(fs.readFileSync(mockLeadsPath, 'utf8'));
        const found = mockData.find((item: any) => item.phone === leadPhone);
        if (found) {
          fullLead = { ...found, ...leadDataUpdate };
        }
      }
    } catch (err) {
      console.error('Error al leer el lead para la notificación del técnico:', err);
    }

    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const messageText = `Hola ${technicianName}, se te ha asignado una nueva visita técnica en Furtz Clima OS:\n\n` +
      `📞 Cliente: +${fullLead.phone}\n` +
      `🔧 Servicio: ${fullLead.service_type === 'installation' ? 'Instalación' : 'Mantenimiento'}\n` +
      `📍 Dirección: ${fullLead.address || 'No especificada'}\n` +
      `📅 Fecha Cita: ${fullLead.appointment_time || 'Por definir'}\n` +
      `📐 Capacidad/Detalle: ${fullLead.calculated_btu || fullLead.installation_age || 'N/A'}\n` +
      `📝 Notas: ${fullLead.notes || 'Sin notas adicionales'}\n\n` +
      `Por favor, ingresa al Módulo de Terreno para ejecutar la lista de chequeo y certificar la calidad del servicio.`;

    if (whatsappToken && phoneId) {
      const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to: techPhone,
          type: 'text',
          text: { body: messageText }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${whatsappToken}`
          }
        }
      );
      console.log(`[WHATSAPP REAL] Notificación enviada con éxito al técnico ${technicianName} (+${techPhone})`);
    } else {
      console.log(`\n====================================================`);
      console.log(`[SIMULACIÓN NOTIFICACIÓN TÉCNICO WHATSAPP API]`);
      console.log(`Para: ${technicianName} (+${techPhone})`);
      console.log(`Mensaje:\n${messageText}`);
      console.log(`====================================================\n`);
    }
  } catch (error: any) {
    console.error(`Error al enviar notificación de WhatsApp al técnico:`, error.response?.data || error.message);
  }
}

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

    for (const lead of eligibleLeads) {
      const campaignMessage = `¡Hola! En Furtz Clima recordamos que tu equipo de aire acondicionado fue instalado o mantenido hace más de un año. Te sugerimos realizar un Mantenimiento Preventivo para asegurar su eficiencia y durabilidad. El valor base es de $40.000 CLP. Responde a este mensaje para agendar tu visita técnica.`;

      if (whatsappToken && phoneId) {
        try {
          const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
          await axios.post(
            url,
            {
              messaging_product: 'whatsapp',
              to: lead.phone,
              type: 'text',
              text: { body: campaignMessage }
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${whatsappToken}`
              }
            }
          );
          console.log(`[CAMPAÑA PREVENTIVA REAL] Notificación enviada a +${lead.phone}`);
        } catch (err: any) {
          console.error(`Error enviando campaña a +${lead.phone} por WhatsApp Real:`, err.response?.data || err.message);
        }
      } else {
        console.log(`\n====================================================`);
        console.log(`[SIMULACIÓN CAMPAÑA PREVENTIVA WHATSAPP API]`);
        console.log(`Para: +${lead.phone}`);
        console.log(`Mensaje:\n${campaignMessage}`);
        console.log(`====================================================\n`);
      }
      
      const updateData = {
        notes: (lead.notes ? lead.notes + '\n' : '') + `[Campaña Preventiva]: Oferta enviada el ${new Date().toLocaleDateString('es-CL')}.`,
        last_maintenance_info: lead.last_maintenance_info || 'Hace más de 1 año',
        status: 'Pendiente'
      };

      if (db) {
        await db.collection('leads').doc(lead.phone).update(updateData).catch(() => {});
      }
      updateLocalMock(lead.phone, updateData);

      sentCount++;
    }

    res.status(200).json({ success: true, count: sentCount });
  } catch (error: any) {
    console.error('Error al ejecutar la campaña preventiva:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
