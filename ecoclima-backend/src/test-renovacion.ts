/**
 * Prueba del MODO RENOVACIÓN ANUAL sin mandar un solo WhatsApp.
 *
 * Crea una ficha de prueba como si ya le hubiéramos enviado la campaña anual, conversa
 * con el bot y al final la borra. Sirve para comprobar que el bot NO hace el
 * cuestionario y ofrece fechas de inmediato.
 *
 *   npx ts-node-dev --transpile-only src/test-renovacion.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from './services/firebase';
import { geminiService, clearSession } from './services/gemini';

// Número inventado: no existe en producción ni en WhatsApp.
const TELEFONO = '56900000777';

const FICHA_DE_PRUEBA = {
  phone: TELEFONO,
  client_name: 'CLIENTE DE PRUEBA — BORRAR',
  service_type: 'maintenance',
  address: 'Picarte 1234, Valdivia',
  status: 'Pendiente',
  last_maintenance_date: '2025-08-01',
  equipment_count: 1,
  campaign_sent_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  conversation: [
    {
      role: 'model',
      text:
        '¡Hola! 👋 Te saluda el asistente virtual de *Furtz Clima*.\n\n' +
        'Queremos contarte que se cumple un año desde la última mantención de tu equipo de aire acondicionado. 🗓️\n\n' +
        'Para mantener su rendimiento, evitar fallas y prolongar su vida útil, te recomendamos realizar la *mantención preventiva anual*.\n\n' +
        '¿Te gustaría agendar tu visita? Respóndenos *SÍ* a este mensaje y coordinamos día y hora según nuestra disponibilidad. 😊'
    }
  ],
  created_at: new Date().toISOString()
};

async function main() {
  if (!db) {
    console.error('Sin conexión a Firestore: no se puede correr la prueba.');
    process.exit(1);
  }

  await db.collection('leads').doc(TELEFONO).set(FICHA_DE_PRUEBA);
  clearSession(TELEFONO);
  console.log(`Ficha de prueba creada para +${TELEFONO} (con campaña enviada hace 26 h).\n`);

  // El segundo y tercer mensaje replican el caso real de Richard Ríos: pide un rango
  // ("última semana del mes") y una hora que no existe ("después de las 15:00").
  const guiones = [
    'Sí, me interesa',
    'Tengo disponibilidad horario última semana del mes después de las 15 hrs. Gracias.',
    'Ya, cualquiera de esos está bien, el que sea'
  ];

  try {
    for (const texto of guiones) {
      console.log(`\n=================== CLIENTE: "${texto}"`);
      const r = await geminiService.handleUserMessage(TELEFONO, texto);
      console.log(`------------------- BOT:\n${r}\n`);
    }
    // Lo que de verdad importa: que la cita haya quedado GUARDADA, no solo dicha.
    const doc = await db.collection('leads').doc(TELEFONO).get();
    const d = doc.data() || {};
    console.log('\n=================== ¿QUEDÓ GUARDADA LA CITA?');
    console.log(`  appointment_iso : ${d.appointment_iso || '❌ NADA'}`);
    console.log(`  appointment_time: ${d.appointment_time || '❌ NADA'}`);
    console.log(`  status          : ${d.status}`);
    console.log(`  booked_by       : ${d.booked_by || '❌ NADA'}`);
    console.log(`  technician      : ${d.technician || '❌ NADA'}`);
  } finally {
    await db.collection('leads').doc(TELEFONO).delete();
    clearSession(TELEFONO);
    console.log(`\nFicha de prueba +${TELEFONO} eliminada.`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Error en la prueba:', e);
  process.exit(1);
});
