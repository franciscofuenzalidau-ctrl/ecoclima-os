/**
 * Escenarios de VENTA de la campaña anual: las respuestas típicas de un cliente real
 * y qué hace el bot con cada una. Sirve para ver dónde se cae una mantención.
 *
 * No manda WhatsApp: crea fichas de prueba, conversa y las borra.
 *
 *   npx ts-node-dev --transpile-only src/test-conversion.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from './services/firebase';
import { geminiService, clearSession } from './services/gemini';

const MENSAJE_CAMPANA =
  '¡Hola! 👋 Te saluda el asistente virtual de *Furtz Clima*.\n\n' +
  'Queremos contarte que se cumple un año desde la última mantención de tu equipo de aire acondicionado. 🗓️\n\n' +
  'Para mantener su rendimiento, evitar fallas y prolongar su vida útil, te recomendamos realizar la *mantención preventiva anual*.\n\n' +
  '¿Te gustaría agendar tu visita? Respóndenos *SÍ* a este mensaje y coordinamos día y hora según nuestra disponibilidad. 😊';

/** Respuestas reales que puede dar un cliente chileno al recordatorio. */
const ESCENARIOS: Array<{ nombre: string; mensajes: string[] }> = [
  { nombre: 'Acepta seco', mensajes: ['Si'] },
  { nombre: 'Pregunta el precio', mensajes: ['¿Cuánto cuesta?'] },
  { nombre: 'Pregunta qué incluye', mensajes: ['Qué incluye la mantención?'] },
  { nombre: 'Dice que ya se la hizo', mensajes: ['Ya le hice mantención hace poco'] },
  { nombre: 'No le interesa', mensajes: ['No gracias'] },
  { nombre: 'Acepta y elige al tiro', mensajes: ['Si, quiero agendar', 'el primero que me diste'] }
];

const BASE = {
  client_name: 'PRUEBA — BORRAR',
  service_type: 'maintenance',
  address: 'Picarte 1234, Valdivia',
  status: 'Pendiente',
  last_maintenance_date: '2025-08-01',
  equipment_count: 1,
  campaign_sent_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  conversation: [{ role: 'model', text: MENSAJE_CAMPANA }],
  created_at: new Date().toISOString()
};

async function main() {
  if (!db) {
    console.error('Sin Firestore.');
    process.exit(1);
  }

  let i = 0;
  for (const esc of ESCENARIOS) {
    const telefono = `5690000${String(800 + i++).padStart(4, '0')}`;
    await db.collection('leads').doc(telefono).set({ ...BASE, phone: telefono });
    clearSession(telefono);

    console.log(`\n\n████ ESCENARIO: ${esc.nombre}`);
    try {
      for (const m of esc.mensajes) {
        console.log(`\n  CLIENTE ▶ ${m}`);
        const r = await geminiService.handleUserMessage(telefono, m);
        const limpio = r.split('Si no quieres mantención')[0].trim();
        console.log(`  BOT ▶ ${limpio.replace(/\n/g, '\n        ')}`);
      }
      const d = (await db.collection('leads').doc(telefono).get()).data() || {};
      console.log(`\n  ➜ RESULTADO: cita=${d.appointment_time || 'NO'} · estado=${d.status}`);
    } finally {
      await db.collection('leads').doc(telefono).delete();
      clearSession(telefono);
    }
  }

  console.log('\n\nFichas de prueba eliminadas.');
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
