/**
 * Muestra por pantalla el aviso que le llega al técnico, SIN mandar ningún WhatsApp.
 *
 * Borra a propósito las credenciales de WhatsApp antes de cargar el servicio, para que
 * `enviarWhatsApp` entre en modo simulación e imprima el mensaje en vez de enviarlo.
 *
 *   npx ts-node-dev --transpile-only src/test-aviso-tecnico.ts
 */
import dotenv from 'dotenv';
dotenv.config();

// Esto va ANTES de importar el servicio: sin token, no se envía nada.
delete process.env.WHATSAPP_TOKEN;
delete process.env.WHATSAPP_PHONE_NUMBER_ID;

import { avisarTecnicoDeVisita } from './services/notificaciones';

const CLIENTE_DE_EJEMPLO = {
  phone: '56981586714',
  client_name: 'RICHARD DONALD RIOS RIOS',
  service_type: 'maintenance',
  address: 'Camilo Henríquez 266, depto 402, Valdivia',
  appointment_time: 'lunes 24 de agosto a las 15:00',
  calculated_btu: '12.000 BTU',
  installation_age: '2 años',
  notes: 'Mantención preventiva anual. El equipo del dormitorio hace ruido al partir.'
};

async function main() {
  console.log('\n══════ AVISO AL AGENDAR ══════');
  await avisarTecnicoDeVisita(CLIENTE_DE_EJEMPLO, 'Francisco');

  console.log('\n══════ SIN NOMBRE NI DIRECCIÓN (caso límite) ══════');
  await avisarTecnicoDeVisita(
    { phone: '56900001111', service_type: 'installation', appointment_time: 'martes 25 a las 09:15' },
    'Francisco'
  );

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
