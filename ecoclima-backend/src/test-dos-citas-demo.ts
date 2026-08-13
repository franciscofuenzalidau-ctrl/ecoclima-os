/**
 * Crea DOS visitas de demostración en la agenda: una agendada por el bot y otra puesta
 * a mano desde el panel, para poder comparar las etiquetas en el calendario.
 *
 * Se borran con:  npx ts-node-dev --transpile-only src/test-dos-citas-demo.ts borrar
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from './services/firebase';
import { cuposLibres, leerConfigAgenda } from './services/agenda';

const DEMO_BOT = '56900000901';
const DEMO_PANEL = '56900000902';

async function borrar() {
  if (!db) return;
  await db.collection('leads').doc(DEMO_BOT).delete();
  await db.collection('leads').doc(DEMO_PANEL).delete();
  console.log('🧹 Las dos visitas de demostración fueron eliminadas.');
}

async function main() {
  if (!db) {
    console.error('Sin Firestore.');
    process.exit(1);
  }

  if (process.argv[2] === 'borrar') {
    await borrar();
    process.exit(0);
  }

  const config = await leerConfigAgenda();
  const libres = cuposLibres([], 21, new Date(), config);
  if (libres.length < 2) {
    console.error('No hay suficientes cupos libres.');
    process.exit(1);
  }

  await db.collection('leads').doc(DEMO_BOT).set({
    phone: DEMO_BOT,
    client_name: 'DEMO — agendó el bot',
    service_type: 'maintenance',
    status: 'Agendado',
    address: 'Av. Picarte 1234, depto 402, Valdivia',
    technician: 'Francisco',
    appointment_iso: libres[0].id,
    appointment_time: libres[0].label,
    booked_by: 'bot',
    booked_at: new Date().toISOString(),
    client_type: 'particular',
    equipment_count: 2,
    calculated_btu: '12.000 BTU',
    installation_age: '3 años',
    last_maintenance_info: 'Agosto de 2025',
    is_working_correctly: false,
    contact_phone: '56987654321',
    notes:
      'Servicio de Mantenimiento / Mantención Preventiva. Valor base: $59.000\n' +
      '[Campaña Preventiva]: Oferta enviada el 12-08-2026 (automática).\n' +
      'El equipo del dormitorio hace ruido al partir y gotea un poco.',
    created_at: new Date().toISOString()
  });

  await db.collection('leads').doc(DEMO_PANEL).set({
    phone: DEMO_PANEL,
    client_name: 'DEMO — lo agendó Pilar',
    service_type: 'installation',
    status: 'Agendado',
    address: 'Los Robles 890, Isla Teja, Valdivia',
    technician: 'Francisco',
    appointment_iso: libres[1].id,
    appointment_time: libres[1].label,
    booked_by: 'panel',
    booked_at: new Date().toISOString(),
    client_type: 'empresa',
    area_m2: 32,
    calculated_btu: '18.000 BTU',
    notes:
      'Cotización pedida por la oficina. Instalar en sala de reuniones del 2º piso.\n' +
      'Pilar: llamar al conserje antes de llegar, estacionamiento por calle lateral.\n' +
      'Cliente pidió boleta a nombre de la empresa.',
    created_at: new Date().toISOString()
  });

  console.log('\n✅ Dos visitas de demostración creadas:');
  console.log(`   🤖 ${libres[0].label} — la agendó el bot`);
  console.log(`   👤 ${libres[1].label} — la agendó Pilar desde el panel`);
  console.log('\n   Ábrelas en el panel → Gestión de Leads → despliega la Agenda.');
  console.log('\n   Para borrarlas:  npx ts-node-dev --transpile-only src/test-dos-citas-demo.ts borrar\n');
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
