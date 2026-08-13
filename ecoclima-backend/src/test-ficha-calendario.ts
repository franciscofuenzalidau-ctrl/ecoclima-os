/**
 * Crea una visita de prueba con la ficha completa para revisar cómo se ve el detalle
 * del calendario en el panel, y la borra cuando le des Enter.
 *
 *   npx ts-node-dev --transpile-only src/test-ficha-calendario.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from './services/firebase';
import { cuposLibres, leerConfigAgenda } from './services/agenda';

const TELEFONO = '56900000555';

async function main() {
  if (!db) {
    console.error('Sin Firestore.');
    process.exit(1);
  }

  const config = await leerConfigAgenda();
  const libres = cuposLibres([], 21, new Date(), config);
  if (libres.length === 0) {
    console.error('No hay cupos libres para la prueba.');
    process.exit(1);
  }
  const cupo = libres[0];

  await db.collection('leads').doc(TELEFONO).set({
    phone: TELEFONO,
    client_name: 'CLIENTE DE PRUEBA — BORRAR',
    service_type: 'maintenance',
    status: 'Agendado',
    address: 'Av. Picarte 1234, depto 402, Valdivia',
    technician: 'Francisco',
    appointment_iso: cupo.id,
    appointment_time: cupo.label,
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
      'Servicio de Mantenimiento / Mantención Preventiva. Valor base de visita técnica: $59.000\n' +
      '[Campaña Preventiva]: Oferta enviada el 12-08-2026 (automática).\n' +
      'El cliente indica que el equipo del dormitorio hace ruido al partir y que gotea un poco.\n' +
      'Pilar: cliente antiguo, atenderlo con prioridad. Estacionamiento en el subterráneo, ' +
      'avisar al conserje al llegar.',
    created_at: new Date().toISOString()
  });

  console.log(`\n✅ Visita de prueba creada para el cupo: ${cupo.label}`);
  console.log(`   Abre el panel → Gestión de Leads → despliega el calendario → toca ese cupo.\n`);
  console.log('   Presiona ENTER acá para borrarla...');

  await new Promise<void>(resolve => process.stdin.once('data', () => resolve()));

  await db.collection('leads').doc(TELEFONO).delete();
  console.log('🧹 Visita de prueba eliminada.');
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
