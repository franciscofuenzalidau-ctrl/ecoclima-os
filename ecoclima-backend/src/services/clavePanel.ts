/**
 * Protección de las modificaciones del panel.
 *
 * El dashboard es público a propósito: los jueces del concurso tienen que poder verlo,
 * y el bot no necesita permisos para operar. Lo que NO puede quedar abierto es la
 * escritura: cualquiera con la URL podía mover citas, soltar reservas o borrar fichas.
 *
 * Por eso solo se exige clave en los métodos que modifican datos (POST, PUT, PATCH,
 * DELETE). Las lecturas siguen libres.
 *
 * La clave viaja en la cabecera `x-clave-panel`. Se configura en Cloud Run con la
 * variable CLAVE_PANEL; si no está definida, no se bloquea nada — así una variable mal
 * escrita nunca deja a Pilar sin poder trabajar.
 */
import { Request, Response, NextFunction } from 'express';

const METODOS_DE_ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function exigirClaveParaEscribir(req: Request, res: Response, next: NextFunction) {
  if (!METODOS_DE_ESCRITURA.has(req.method)) return next();

  const claveEsperada = process.env.CLAVE_PANEL;
  if (!claveEsperada) return next();

  const claveRecibida = req.header('x-clave-panel') || '';

  // Comparación de largo constante: evita que se pueda adivinar la clave midiendo
  // cuánto demora la respuesta.
  if (claveRecibida.length !== claveEsperada.length) {
    return res.status(401).json({ error: 'Clave del panel incorrecta o ausente.', necesitaClave: true });
  }
  let iguales = 0;
  for (let i = 0; i < claveEsperada.length; i++) {
    iguales |= claveRecibida.charCodeAt(i) ^ claveEsperada.charCodeAt(i);
  }
  if (iguales !== 0) {
    console.warn(`[SEGURIDAD] Intento de escritura con clave incorrecta: ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'Clave del panel incorrecta o ausente.', necesitaClave: true });
  }

  return next();
}

/** Para que el panel sepa si tiene que pedir la clave. */
export function claveEstaActiva(): boolean {
  return !!process.env.CLAVE_PANEL;
}
