/**
 * Direccion escrita -> coordenadas, para que el cliente aparezca en el mapa y en la ruta.
 *
 * Hasta ahora las coordenadas solo existian si el cliente mandaba su ubicacion por WhatsApp.
 * Como casi nadie lo hace, ninguna ficha tenia GPS y Rutas y Logistica se veia vacia.
 *
 * Se usa Nominatim (OpenStreetMap), igual que el mapa del panel, para no depender de la clave de
 * Google Maps que ya habia dado problemas.
 *
 * DOS SALVAGUARDAS, aprendidas probando con direcciones reales:
 *
 * 1. Busqueda acotada a la zona (bounded + viewbox). Sin esto, "PEDRO 9 3345" resolvia a
 *    Concepcion, a 400 km, porque existe una calle con ese nombre alla.
 * 2. Se descarta cualquier resultado a mas de RADIO_MAXIMO_KM del centro de Valdivia.
 *
 * Si no resuelve o queda lejos NO se inventa un punto: se deja sin coordenadas. Un pin
 * equivocado manda al tecnico a otra ciudad, que es peor que no tener pin.
 */
import axios from 'axios';

const CENTRO_VALDIVIA = { lat: -39.8142, lon: -73.2459 };
const VIEWBOX = '-73.60,-39.50,-72.80,-40.15';
const RADIO_MAXIMO_KM = 40;

/** Nominatim exige maximo 1 consulta por segundo y un User-Agent que identifique la aplicacion. */
const MS_ENTRE_CONSULTAS = 1200;
let ultimaConsulta = 0;

export interface Coordenadas { latitude: number; longitude: number; }

function distanciaKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function geocodificarDireccion(direccion: string): Promise<Coordenadas | null> {
  const texto = String(direccion || '').trim();
  if (texto.length < 5) return null;

  const espera = MS_ENTRE_CONSULTAS - (Date.now() - ultimaConsulta);
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  ultimaConsulta = Date.now();

  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        format: 'json',
        limit: 1,
        countrycodes: 'cl',
        bounded: 1,
        viewbox: VIEWBOX,
        q: `${texto}, Valdivia`
      },
      headers: { 'User-Agent': 'EcoClimaOS/1.0 (panel de Furtz Clima)' },
      timeout: 12000
    });

    const r = Array.isArray(data) ? data[0] : null;
    if (!r) return null;

    const latitude = Number(r.lat);
    const longitude = Number(r.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const km = distanciaKm(CENTRO_VALDIVIA.lat, CENTRO_VALDIVIA.lon, latitude, longitude);
    if (km > RADIO_MAXIMO_KM) {
      console.warn(`[GEO] "${texto}" resolvio a ${km.toFixed(0)} km de Valdivia. Se descarta.`);
      return null;
    }

    return { latitude, longitude };
  } catch (err: any) {
    console.error(`[GEO] Error al geocodificar "${texto}": ${err.message}`);
    return null;
  }
}
