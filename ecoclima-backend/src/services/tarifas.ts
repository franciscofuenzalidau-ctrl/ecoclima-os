/**
 * Cuánto vale un servicio terminado, y cómo se convierte a la cifra que muestra Finanzas.
 *
 * Antes los ingresos se escribían a mano en el panel. Ahora, cuando el técnico cierra un
 * servicio, indica cuántas unidades atendió (y si el equipo es chico o grande en las
 * mantenciones) y el monto sale de estas reglas, que viven en data_mock/config_reglas.json.
 *
 * Los precios del negocio están en pesos chilenos y CON IVA incluido, que es como se le cotiza
 * al cliente. Finanzas trabaja en dólares y neto de IVA, porque el IVA no es ingreso: se cobra
 * y se le entrega al SII.
 */
import fs from 'fs';
import path from 'path';

export type TamanoEquipo = 'chico' | 'grande';

export interface DatosServicio {
  service_type?: string | null;
  service_units?: number | null;
  equipment_size?: TamanoEquipo | null;
}

function leerConfig(): any {
  try {
    const p = path.resolve(process.cwd(), 'data_mock', 'config_reglas.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error('[TARIFAS] No se pudo leer config_reglas.json:', err);
  }
  return {};
}

/** Porcentaje de IVA y tipo de cambio, configurables sin tocar código. */
export function parametrosFinancieros(): { iva: number; clpPorUsd: number } {
  const c = leerConfig();
  return {
    iva: Number(c.iva_porcentaje ?? 19),
    clpPorUsd: Number(c.clp_por_usd ?? 930)
  };
}

/**
 * Precio de una instalación. Los precios reales son un rango (la mano de obra va de 100.000 a
 * 150.000 según acceso, altura y cableado), así que se usa el promedio como referencia. Quien
 * cierra el servicio puede corregir el monto si el trabajo se cobró distinto.
 */
export function precioInstalacion(): number {
  const c = leerConfig();
  const min = Number(c.installation_cost?.min ?? 100000);
  const max = Number(c.installation_cost?.max ?? 150000);
  return Math.round((min + max) / 2);
}

/** Precio de una mantención, según el tamaño del equipo. */
export function precioMantencion(tamano: TamanoEquipo): number {
  const c = leerConfig();
  return tamano === 'grande'
    ? Number(c.maintenance_cost_large ?? 65000)
    : Number(c.maintenance_cost_small ?? c.maintenance_cost ?? 59000);
}

/**
 * Monto BRUTO en pesos (con IVA) de un servicio terminado.
 * Devuelve null cuando faltan datos para calcularlo, en vez de inventar un número.
 */
export function calcularMontoBrutoCLP(datos: DatosServicio): number | null {
  const unidades = Number(datos.service_units);
  if (!Number.isFinite(unidades) || unidades <= 0) return null;

  if (datos.service_type === 'installation') {
    return unidades * precioInstalacion();
  }
  const tamano: TamanoEquipo = datos.equipment_size === 'grande' ? 'grande' : 'chico';
  return unidades * precioMantencion(tamano);
}

/** Del bruto en pesos al ingreso que corresponde declarar: neto de IVA y en dólares. */
export function brutoCLPaNetoUSD(brutoCLP: number): number {
  const { iva, clpPorUsd } = parametrosFinancieros();
  const netoCLP = brutoCLP / (1 + iva / 100);
  return Math.round((netoCLP / clpPorUsd) * 100) / 100;
}

/** Etiqueta "Agosto 2026" a partir de una fecha ISO, que es como Finanzas agrupa los meses. */
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function etiquetaDeMes(iso: string): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
