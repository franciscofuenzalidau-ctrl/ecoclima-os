/**
 * Service worker mínimo, a propósito.
 *
 * Existe solo porque el navegador lo exige para permitir "Agregar a pantalla de inicio".
 * NO guarda nada en caché: este panel muestra agenda y fichas que cambian durante el día, y
 * servir una versión vieja seria peor que no tener app. Ademas ya tuvimos problemas de caché
 * mostrando builds antiguos tras un despliegue.
 *
 * Si algun dia se quiere que funcione sin señal, hay que pensar bien qué se guarda y por
 * cuánto tiempo, y agregar una forma de forzar la actualización.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
