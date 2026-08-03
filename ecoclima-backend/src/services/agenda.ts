/**
 * Agenda de Furtz Clima.
 *
 * Existen exactamente DOS cupos por día, de lunes a viernes: 09:15 y 14:00.
 * Todo se calcula en hora de Chile (America/Santiago), no en la hora del servidor:
 * Cloud Run corre en UTC, así que sin esto el bot se equivocaría de día por la noche.
 *
 * Un cupo se identifica por su "slot id": `YYYY-MM-DDTHH:mm` en hora local de Chile.
 * Ese es el valor que se guarda en el campo `appointment_iso` del lead y el que usa
 * el calendario del dashboard.
 */

import fs from 'fs';
import path from 'path';
import { db } from './firebase';

export const SLOT_TIMES = ['09:15', '14:00'] as const;

const TIMEZONE = 'America/Santiago';

/**
 * Ajustes que Pilar hace a mano desde el dashboard.
 * - `extras`: cupos adicionales fuera de los dos horarios base (ej. un 16:00 puntual).
 * - `reservas`: cupos apartados con anticipación. El bot NO los ofrece.
 */
export interface AgendaConfig {
  extras: string[];
  reservas: Array<{ id: string; motivo: string }>;
}

const CONFIG_VACIA: AgendaConfig = { extras: [], reservas: [] };

const rutaConfigLocal = () =>
  path.resolve(process.cwd(), 'data_mock', 'agenda_config.json');

function normalizarConfig(raw: any): AgendaConfig {
  return {
    extras: Array.isArray(raw?.extras) ? raw.extras.filter((x: any) => typeof x === 'string') : [],
    reservas: Array.isArray(raw?.reservas)
      ? raw.reservas
          .filter((r: any) => r && typeof r.id === 'string')
          .map((r: any) => ({ id: r.id, motivo: typeof r.motivo === 'string' ? r.motivo : '' }))
      : []
  };
}

export async function leerConfigAgenda(): Promise<AgendaConfig> {
  if (db) {
    try {
      const doc = await db.collection('configuracion').doc('agenda').get();
      if (doc.exists) return normalizarConfig(doc.data());
      return CONFIG_VACIA;
    } catch (e: any) {
      console.warn('Agenda: no se pudo leer la config desde Firestore -', e.message);
    }
  }
  try {
    if (fs.existsSync(rutaConfigLocal())) {
      return normalizarConfig(JSON.parse(fs.readFileSync(rutaConfigLocal(), 'utf8')));
    }
  } catch (e) {
    console.error('Agenda: no se pudo leer la config local:', e);
  }
  return CONFIG_VACIA;
}

export async function guardarConfigAgenda(config: AgendaConfig): Promise<void> {
  const limpia = normalizarConfig(config);
  if (db) {
    try {
      await db.collection('configuracion').doc('agenda').set(limpia, { merge: false });
    } catch (e: any) {
      console.error('Agenda: no se pudo guardar la config en Firestore -', e.message);
      throw e;
    }
  }
  try {
    fs.writeFileSync(rutaConfigLocal(), JSON.stringify(limpia, null, 2), 'utf8');
  } catch (e) {
    console.error('Agenda: no se pudo guardar la config local:', e);
  }
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

export interface Slot {
  /** Identificador del cupo: `YYYY-MM-DDTHH:mm` en hora de Chile. */
  id: string;
  /** Texto para mostrarle al cliente: "lunes 4 de agosto a las 09:15". */
  label: string;
  date: string;
  time: string;
}

/** Fecha y hora actuales en Chile, como texto. */
export function ahoraEnChile(now: Date = new Date()): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

function diaDeLaSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 domingo ... 6 sábado
}

/** Es día hábil: lunes (1) a viernes (5). */
export function esDiaHabil(fecha: string): boolean {
  const dia = diaDeLaSemana(fecha);
  return dia >= 1 && dia <= 5;
}

/** "lunes 4 de agosto de 2026" */
export function etiquetaDeFecha(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return `${DIAS[diaDeLaSemana(fecha)]} ${d} de ${MESES[m - 1]} de ${y}`;
}

/** "lunes 4 de agosto a las 09:15" */
export function etiquetaDeCupo(fecha: string, hora: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return `${DIAS[diaDeLaSemana(fecha)]} ${d} de ${MESES[m - 1]} a las ${hora}`;
}

export function construirCupo(fecha: string, hora: string): Slot {
  return { id: `${fecha}T${hora}`, label: etiquetaDeCupo(fecha, hora), date: fecha, time: hora };
}

/**
 * Todos los cupos de los próximos `diasHaciaAdelante` días hábiles a partir de hoy,
 * descartando los que ya pasaron en el día de hoy.
 */
export function cuposDelPeriodo(
  diasHaciaAdelante = 21,
  now: Date = new Date(),
  config: AgendaConfig = CONFIG_VACIA
): Slot[] {
  const { date: hoy, time: horaActual } = ahoraEnChile(now);
  const limite = sumarDias(hoy, diasHaciaAdelante);
  const ids = new Set<string>();
  const cupos: Slot[] = [];

  const agregar = (fecha: string, hora: string) => {
    // Hoy no se ofrece un horario que ya pasó.
    if (fecha === hoy && hora <= horaActual) return;
    if (fecha < hoy || fecha > limite) return;
    const id = `${fecha}T${hora}`;
    if (ids.has(id)) return;
    ids.add(id);
    cupos.push(construirCupo(fecha, hora));
  };

  for (let i = 0; i <= diasHaciaAdelante; i++) {
    const fecha = sumarDias(hoy, i);
    if (!esDiaHabil(fecha)) continue;
    for (const hora of SLOT_TIMES) agregar(fecha, hora);
  }

  // Cupos extra que agregó Pilar (pueden caer en cualquier día y hora).
  for (const extra of config.extras) {
    const [fecha, hora] = extra.split('T');
    if (fecha && hora) agregar(fecha, hora);
  }

  return cupos.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Cupos que el bot puede ofrecer: los del período, menos los que ya tienen cliente
 * y menos los que Pilar reservó a mano.
 */
export function cuposLibres(
  ocupados: string[],
  diasHaciaAdelante = 21,
  now: Date = new Date(),
  config: AgendaConfig = CONFIG_VACIA
): Slot[] {
  const tomados = new Set(ocupados.filter(Boolean));
  for (const r of config.reservas) tomados.add(r.id);
  return cuposDelPeriodo(diasHaciaAdelante, now, config).filter(c => !tomados.has(c.id));
}

/**
 * Busca en un texto cuál de los cupos ofrecidos eligió el cliente.
 * Acepta que escriba la etiqueta completa, o solo el día y la hora, o solo el día
 * cuando ese día tiene un único cupo libre.
 */
export function detectarCupoElegido(texto: string, disponibles: Slot[]): Slot | null {
  if (!texto) return null;
  const t = texto.toLowerCase();

  // 1. Coincidencia por fecha y hora explícitas.
  for (const cupo of disponibles) {
    const [, mes] = [cupo.date, Number(cupo.date.slice(5, 7))];
    const dia = Number(cupo.date.slice(8, 10));
    const nombreMes = MESES[mes - 1];
    const horaCorta = cupo.time.replace(':', '');
    const mencionaDia = new RegExp(`\\b${dia}\\b`).test(t) && t.includes(nombreMes);
    const mencionaHora = t.includes(cupo.time) || t.includes(horaCorta) || t.includes(cupo.time.split(':')[0] + ':');

    if (mencionaDia && mencionaHora) return cupo;
  }

  // 2. Día de la semana + hora (ej: "el martes a las 14:00").
  for (const cupo of disponibles) {
    const nombreDia = DIAS[diaDeLaSemana(cupo.date)];
    if (t.includes(nombreDia) && (t.includes(cupo.time) || t.includes(cupo.time.split(':')[0]))) {
      return cupo;
    }
  }

  // 3. Solo el día, si ese día tiene un único cupo libre.
  for (const cupo of disponibles) {
    const nombreDia = DIAS[diaDeLaSemana(cupo.date)];
    const mismoDia = disponibles.filter(c => c.date === cupo.date);
    if (mismoDia.length === 1 && t.includes(nombreDia)) return cupo;
  }

  return null;
}
