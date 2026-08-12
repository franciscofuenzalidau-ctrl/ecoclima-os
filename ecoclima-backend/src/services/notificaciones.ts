/**
 * Avisos de WhatsApp que INICIA la empresa.
 *
 * Meta bloquea el texto libre si pasaron más de 24 h desde el último mensaje del
 * cliente. Por eso siempre se intenta primero la plantilla aprobada, que no tiene
 * ese límite, y solo si falla se cae al texto libre.
 *
 * Plantillas aprobadas en la WABA: recordatorio_mantencion_anual,
 * post_servicio_pago_encuesta y aviso_visita_tecnico.
 */
import axios from 'axios';

/** Técnicos con número REAL verificado. Sin números de relleno. */
export const TECNICOS: Record<string, string> = {
  francisco: '56990939188'
};

/** Técnico al que se avisa cuando nadie fue asignado todavía. */
export const TECNICO_POR_DEFECTO = 'Francisco';

export function telefonoDelTecnico(nombre?: string | null): string | null {
  if (!nombre) return null;
  return TECNICOS[nombre.toLowerCase().trim()] || null;
}

export interface ResultadoEnvio {
  enviado: boolean;
  via: 'plantilla' | 'texto' | null;
  motivo?: string;
}

export async function enviarWhatsApp(opciones: {
  to: string;
  texto: string;
  plantilla?: { nombre: string; idioma?: string; variables?: string[] };
  /**
   * Invierte el orden: primero el texto libre y solo si Meta lo rechaza, la plantilla.
   * Sirve cuando el texto lleva información que la plantilla aprobada no puede
   * contener —por ejemplo los horarios disponibles— y vale la pena intentarlo por si
   * la ventana de 24 h sigue abierta.
   */
  preferirTexto?: boolean;
}): Promise<ResultadoEnvio> {
  const whatsappToken = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!whatsappToken || !phoneId) {
    console.log(`\n[SIMULACIÓN WHATSAPP] Para +${opciones.to}:\n${opciones.texto}\n`);
    return { enviado: false, via: null, motivo: 'WhatsApp no está configurado en este entorno (modo simulación).' };
  }

  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${whatsappToken}` };
  let motivoPlantilla: string | undefined;

  // Con preferirTexto se prueba primero el texto libre: solo entra si la ventana de
  // 24 h sigue abierta, y si Meta lo rechaza se sigue con la plantilla de más abajo.
  if (opciones.preferirTexto) {
    try {
      await axios.post(url, {
        messaging_product: 'whatsapp',
        to: opciones.to,
        type: 'text',
        text: { body: opciones.texto }
      }, { headers });
      return { enviado: true, via: 'texto' };
    } catch (err: any) {
      const motivo = err.response?.data?.error?.message || err.message;
      console.warn(`[WHATSAPP] Texto libre rechazado (ventana cerrada), se intenta la plantilla: ${motivo}`);
    }
  }

  if (opciones.plantilla) {
    try {
      // Meta rechaza parámetros vacíos o con saltos de línea.
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

/**
 * Avisa al técnico de una visita, con dirección y enlace a Google Maps.
 * Lo usan tanto el dashboard (al asignar técnico) como el bot (al agendar la cita).
 */
export async function avisarTecnicoDeVisita(
  lead: any,
  nombreTecnico: string = TECNICO_POR_DEFECTO,
  esActualizacion: boolean = false
): Promise<ResultadoEnvio> {
  const telefono = telefonoDelTecnico(nombreTecnico);
  if (!telefono) {
    const motivo = `No hay número registrado para el técnico "${nombreTecnico}"`;
    console.log(`[NOTIFICACIÓN TÉCNICO] ${motivo}`);
    return { enviado: false, via: null, motivo };
  }

  const servicio = lead.service_type === 'installation' ? 'Instalación' : 'Mantención';
  const direccion = lead.address || 'no registrada';
  const cita = lead.appointment_time || 'Por definir';

  const enlaceMapa = lead.latitude && lead.longitude
    ? `https://www.google.com/maps/search/?api=1&query=${lead.latitude},${lead.longitude}`
    : null;
  const sinUbicacion = !lead.address && !enlaceMapa;

  const texto =
    (esActualizacion
      ? `Hola ${nombreTecnico}, se actualizó la información de una visita que ya tenías asignada. Ahora sí está la dirección:\n\n`
      : `Hola ${nombreTecnico}, se te ha asignado una nueva visita técnica en Furtz Clima OS:\n\n`) +
    `📞 Cliente: +${lead.phone}\n` +
    `🔧 Servicio: ${servicio}\n` +
    `📍 Dirección: ${direccion}\n` +
    (enlaceMapa ? `🗺️ Ubicación GPS: ${enlaceMapa}\n` : '') +
    `📅 Fecha Cita: ${cita}\n` +
    `📐 Capacidad/Detalle: ${lead.calculated_btu || lead.installation_age || 'N/A'}\n` +
    `📝 Notas: ${lead.notes || 'Sin notas adicionales'}\n\n` +
    (sinUbicacion ? `⚠️ Esta visita NO tiene dirección registrada. Contacta al cliente antes de salir.\n\n` : '') +
    `Por favor, ingresa al Módulo de Terreno para ejecutar la lista de chequeo y certificar la calidad del servicio.`;

  const r = await enviarWhatsApp({
    to: telefono,
    texto,
    plantilla: {
      nombre: 'aviso_visita_tecnico',
      variables: [nombreTecnico, `+${lead.phone}`, servicio, direccion, cita]
    }
  });

  if (r.enviado) {
    console.log(`[WHATSAPP] Visita avisada a ${nombreTecnico} (+${telefono}) vía ${r.via}`);
  } else {
    console.error(`[WHATSAPP] No se pudo avisar a ${nombreTecnico}: ${r.motivo}`);
  }

  return r;
}
