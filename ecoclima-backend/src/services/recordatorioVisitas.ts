/**
 * Recordatorio al técnico unas horas antes de cada visita.
 *
 * Es el ÚNICO aviso que recibe el técnico. Antes también se le mandaba uno al agendar, pero
 * las citas se cargan de a muchas y esos mensajes le llegaban todos juntos, días antes de las
 * visitas, así que la información se diluía. Este llega el mismo día, poco antes de salir, con
 * la ficha completa del cliente.
 *
 * Se dispara desde /health igual que la campaña: Cloud Run apaga el contenedor cuando no
 * hay tráfico, así que el uptime check es el único reloj confiable que tenemos.
 */
import { db } from './firebase';
import { enviarWhatsApp, telefonoDelTecnico, TECNICO_POR_DEFECTO } from './notificaciones';
import { ahoraEnChile } from './agenda';

/** Con cuánta anticipación se avisa. Es el ÚNICO aviso al técnico: al agendar ya no se manda
 *  nada, porque las citas se cargan de a muchas y los avisos le llegaban todos juntos. */
const HORAS_ANTES = 1;

/** Cada cuánto se revisa, para no consultar la base en cada golpe del health check. */
const MINUTOS_ENTRE_REVISIONES = 10;

let ultimaRevision = 0;
let revisando = false;

/** `YYYY-MM-DDTHH:mm` (hora de Chile) → minutos desde la medianoche de ese día. */
function minutosDelDia(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function armarRecordatorio(lead: any, nombreTecnico: string): string {
  const servicio = lead.service_type === 'installation' ? 'Instalación' : 'Mantención';
  const hora = String(lead.appointment_iso || '').split('T')[1] || '';

  const enlaceMapa = lead.latitude && lead.longitude
    ? `https://www.google.com/maps/search/?api=1&query=${lead.latitude},${lead.longitude}`
    : lead.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}`
      : null;

  const equipos = lead.equipment_count ? `${lead.equipment_count}` : null;
  const tipoCliente = lead.client_type === 'empresa' ? 'Empresa' : lead.client_type === 'particular' ? 'Particular' : null;

  const lineas = [
    `Hola ${nombreTecnico}, recordatorio de tu próxima visita:`,
    ``,
    `⏰ *Hoy a las ${hora}* — ${servicio}`,
    ``,
    `👤 Cliente: ${lead.client_name || 'Sin nombre registrado'}`,
    `📞 Teléfono: +${lead.phone}`,
    lead.contact_phone && lead.contact_phone !== lead.phone ? `📱 Otro contacto: +${lead.contact_phone}` : null,
    tipoCliente ? `🏷️ Tipo: ${tipoCliente}` : null,
    ``,
    `📍 Dirección: ${lead.address || '⚠️ NO REGISTRADA — llama al cliente antes de salir'}`,
    enlaceMapa ? `🗺️ Cómo llegar: ${enlaceMapa}` : null,
    lead.address_reference ? `🧭 Referencia: ${lead.address_reference}` : null,
    ``,
    equipos ? `❄️ Equipos: ${equipos}` : null,
    lead.calculated_btu ? `📐 Capacidad: ${lead.calculated_btu}` : null,
    lead.installation_age ? `📆 Antigüedad: ${lead.installation_age}` : null,
    lead.last_maintenance_info ? `🔧 Última mantención: ${lead.last_maintenance_info}` : null,
    lead.is_working_correctly === false ? `⚠️ El cliente reporta FALLA en el equipo` : null,
    ``,
    lead.notes ? `📝 Notas:\n${String(lead.notes).slice(0, 600)}` : null,
    ``,
    `Al terminar, marca el servicio en el panel para que se le envíe la encuesta al cliente.`
  ];

  return lineas.filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Busca las visitas de hoy que empiezan dentro de las próximas HORAS_ANTES y todavía no
 * tienen recordatorio enviado, y se las manda al técnico asignado.
 */
export async function tal_vez_avisar_visitas_proximas(): Promise<void> {
  if (!db) return;
  if (revisando) return;

  const ahora = Date.now();
  if (ahora - ultimaRevision < MINUTOS_ENTRE_REVISIONES * 60 * 1000) return;

  try {
    revisando = true;
    ultimaRevision = ahora;

    const { date: hoy, time: horaActual } = ahoraEnChile();
    const ahoraMin = minutosDelDia(horaActual);
    const hastaMin = ahoraMin + HORAS_ANTES * 60;

    // Solo las citas de HOY: la consulta por prefijo evita traerse la agenda entera.
    const snapshot = await db.collection('leads')
      .where('appointment_iso', '>=', `${hoy}T00:00`)
      .where('appointment_iso', '<=', `${hoy}T23:59`)
      .get();

    for (const doc of snapshot.docs) {
      const lead = { phone: doc.id, ...doc.data() } as any;

      if (lead.status === 'Cancelado') continue;
      if (lead.reminder_sent_at) continue;

      const hora = String(lead.appointment_iso || '').split('T')[1];
      if (!hora) continue;

      const citaMin = minutosDelDia(hora);
      // Ni las que ya pasaron ni las que están demasiado lejos todavía.
      if (citaMin < ahoraMin || citaMin > hastaMin) continue;

      const nombreTecnico = lead.technician || TECNICO_POR_DEFECTO;
      const telefono = telefonoDelTecnico(nombreTecnico);
      if (!telefono) {
        console.error(`[RECORDATORIO] Sin número para el técnico "${nombreTecnico}" (cliente +${lead.phone}).`);
        continue;
      }

      const texto = armarRecordatorio(lead, nombreTecnico);
      const servicio = lead.service_type === 'installation' ? 'Instalación' : 'Mantención';

      const r = await enviarWhatsApp({
        to: telefono,
        texto,
        plantilla: {
          nombre: 'aviso_visita_tecnico',
          // La plantilla no exige que el técnico le haya escrito al bot en las últimas 24 h;
          // el texto libre sí, y como el técnico nunca le escribe, siempre lo rechazaba y el
          // aviso se perdía en silencio (se marcaba enviado igual, porque Meta acepta el
          // texto libre con 200 y recién falla después, sin avisar). Va la plantilla primero.
          variables: [
            nombreTecnico,
            lead.client_name ? `${lead.client_name} (+${lead.phone})` : `+${lead.phone}`,
            servicio,
            lead.address_reference ? `${lead.address || 'No registrada'} — Ref: ${lead.address_reference}` : (lead.address || 'No registrada'),
            lead.appointment_time || hora
          ]
        }
      });

      if (r.enviado) {
        console.log(`[RECORDATORIO] Visita de las ${hora} avisada a ${nombreTecnico} vía ${r.via} (cliente +${lead.phone}).`);
        await doc.ref.update({ reminder_sent_at: new Date().toISOString() }).catch(() => {});
      } else {
        console.error(`[RECORDATORIO] No se pudo avisar a ${nombreTecnico}: ${r.motivo}`);
      }
    }
  } catch (err: any) {
    console.error('[RECORDATORIO] Error al revisar visitas próximas:', err.message);
  } finally {
    revisando = false;
  }
}
