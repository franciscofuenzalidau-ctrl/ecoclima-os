# Estado del Proyecto — EcoClima OS / Furtz Clima OS
**Última actualización: 27 de julio de 2026, ~12:00 (Chile)**

## ✅ ACTUALIZACIÓN 27-07: EL BOT ESTÁ EN PRODUCCIÓN Y RESPONDIENDO POR WHATSAPP

Verificado a las 11:59 del 27-07: mensaje real por WhatsApp → webhook Cloud Run → Gemini → respuesta al cliente → lead/log en Firestore. Sistema completo operativo.

Lo que se arregló el 27-07:
1. **Causa raíz de la caída histórica del bot: créditos prepagados de Gemini agotados** (error 429 RESOURCE_EXHAUSTED). El bot llevaba semanas caído por esto sin que nadie lo notara. Se recargaron créditos en AI Studio (aistudio.google.com → Facturación). **⚠️ REVISAR SALDO CADA SEMANA** — se agota sin aviso y suspende el servicio.
2. **Webhook de Meta redirigido al servidor nuevo.** La UI de Meta no guardaba el cambio; se fijó por API con `override_callback_uri` a nivel de la cuenta de WhatsApp Business (WABA `1024142930581510`). Los mensajes ya NO van al servidor fantasma.
3. **Descubierto servidor fantasma**: despliegue viejo en `https://ecoclima-os-988941778538.us-east1.run.app` (otro proyecto de Google, región us-east1) que recibía los mensajes y fallaba. Ya no recibe tráfico. **PENDIENTE: apagarlo/eliminarlo** para no pagar de más ni confundir.
4. **El token de WhatsApp resultó ser PERMANENTE** (system user "bot", nunca expira) — el pendiente "token permanente" ya estaba resuelto sin saberlo.
5. Datos clave: Phone Number ID `1262901480233252` · WABA ID `1024142930581510` · App Meta `877662011631083` (Furtz Clima OS).
6. `.env` local actualizado con token de WhatsApp, phone ID y clave Gemini nueva (`...Oz9A`).

> Este documento registra TODO lo que se hizo el 26-07-2026 y el estado real del sistema.
> Leer esto ANTES de tocar cualquier cosa, para no duplicar trabajo ni romper lo que ya funciona.

---

## 1. Arquitectura actual EN PRODUCCIÓN (todo vivo hoy)

| Componente | Dónde | URL / ID | Estado |
|---|---|---|---|
| Backend (Express + Gemini + WhatsApp) | Cloud Run, región `southamerica-west1` | https://ecoclima-backend-437714636966.southamerica-west1.run.app | ✅ VIVO (`/health` responde OK) |
| Base de datos | Firestore **Native mode**, base `(default)`, proyecto `ecoclima-os-7ca1b` | consola → Firestore | ✅ CREADA HOY — antes NO existía |
| Dashboard React | Firebase Hosting | https://ecoclima-os-7ca1b.web.app | ✅ Publicado y conectado al backend |
| Repositorio | GitHub | `franciscofuenzalidau-ctrl/ecoclima-os` (rama `main`) | ✅ Con despliegue continuo |
| Número WhatsApp | Meta / WhatsApp Cloud API | +56 9 5848 9307 ("furtz"), estado Conectado, calidad Alta | ✅ Registrado |

**Proyecto de Google Cloud correcto: `ecoclima-os-7ca1b`** (con facturación vinculada a "Mi cuenta de facturación").
⚠️ Existe OTRO proyecto llamado `ecoclima-os` (a secas) que NO se usa — no tocar / candidato a eliminar.

## 2. Despliegue continuo (CI/CD) — YA CONFIGURADO

- Cada `git push` a `main` en GitHub dispara Cloud Build (activador `cloudrun-ecoclima-backend-...`), que compila `ecoclima-backend/Dockerfile` y redespliega Cloud Run **automáticamente**.
- Conexión GitHub ↔ Google vía **Developer Connect** (app instalada solo para el repo `ecoclima-os`).
- El build corre en `europe-west1` pero despliega a `southamerica-west1` (así lo creó la consola; es normal).
- **NO desplegar a mano**: basta commit + push.

## 3. Lo que se hizo el 26-07-2026 (cronológico)

1. **Commit y push** de 3 semanas de cambios pendientes (`gemini.ts`, `leads.ts`, `App.tsx`) → commit `16ab213`.
2. **Se descubrió que Firestore NO existía** (todos los guardados fallaban con `5 NOT_FOUND` y caían al respaldo local `data_mock/`). Se creó la base `(default)`, edición Standard, Native mode. Verificado: el bot ahora guarda leads en la nube.
3. **Se creó el servicio Cloud Run `ecoclima-backend`** desde la consola (deploy continuo desde GitHub, invocaciones no autenticadas, ingress "Todo").
4. **Primera compilación falló** (`developerconnect.gitRepositoryLinks.fetchReadToken denied`): era retraso de propagación del rol IAM que Google otorga automáticamente a `437714636966-compute@developer.gserviceaccount.com`. **Solución: solo reintentar la compilación.** No se cambió ningún permiso a mano.
5. **Variables de entorno cargadas en Cloud Run**: `GEMINI_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `GOOGLE_MAPS_API_KEY`. (Firebase NO necesita credenciales: usa las automáticas de Cloud Run.)
6. **Dockerfile actualizado a `node:20-alpine`** (commit `f40a980`) porque `@google/genai@2.7.0` exige Node ≥ 20.
7. **`ecoclima-dashboard/firebase.json`**: se agregó rewrite de `/api/**` hacia el servicio Cloud Run `ecoclima-backend` (región `southamerica-west1`). Así el dashboard publicado habla con el backend en el mismo dominio.
8. **`firebase deploy --only hosting`** ejecutado → dashboard publicado. Verificado: `https://ecoclima-os-7ca1b.web.app/api/leads` devuelve JSON real de Firestore.
9. `.gitignore` del dashboard: agregado `.firebase/` (caché local de deploy).

## 4. PENDIENTES (en orden de urgencia)

- [ ] **Webhook de Meta**: en developers.facebook.com → app → WhatsApp → Configuración → Webhook:
  - Callback URL: `https://ecoclima-backend-437714636966.southamerica-west1.run.app/webhook`
  - Verify token: el valor de `WHATSAPP_VERIFY_TOKEN` del `.env`
  - Suscribirse al campo `messages`.
  - Luego probar escribiendo al +56 9 5848 9307.
- [ ] **Token permanente de WhatsApp**: el token actual es temporal (24 h). Crear "usuario del sistema" en Meta Business + verificación del negocio. **Trámite lento — prioridad máxima** (los jueces pueden pedir demo en vivo 18 ago–15 sep).
- [ ] **Variables SMTP** (`SMTP_HOST/PORT/USER/PASS`): usadas por `leads.ts` (exportar por email) pero NO configuradas ni en `.env` ni en Cloud Run. Esa función fallará hasta configurarlas o deshabilitarla.
- [ ] **Limpiar el repo**: contiene ~40 archivos basura de la página Devpost guardada (`*.js.descarga`, `dQw4w9WgXcQ.html`, etc.). Sacarlos antes de que los jueces revisen. También falta README en inglés con instrucciones de prueba.
- [ ] **Alerta de disponibilidad** en Cloud Monitoring sobre `/health`.
- [ ] **Carpeta "Evidencia XPRIZE"**: boletas, capturas, testimonios, planilla de ingresos mensuales en USD. Alimentarla cada semana.
- [ ] **Rotar claves** (Gemini, Maps) — llevan meses sin rotar y estuvieron en este disco.

## 5. Advertencias — NO confundirse con esto

- ⚠️ **Carpeta duplicada**: en la raíz del proyecto (`energia sustentable furtz _ Publicación\ecoclima-backend`) hay una copia VIEJA y ROTA del backend (sin package.json, importa archivos inexistentes) **con el JSON de credenciales de Firebase adentro**. El código real está en `energia sustentable furtz _ Publicación de desarrollo_files\ecoclima-backend`. La copia vieja es candidata a eliminarse (con cuidado de no borrar el JSON sin respaldo si aún se usa localmente).
- ⚠️ El `.env` y el JSON de Firebase están correctamente **ignorados por git** — nunca quitar esas reglas del `.gitignore`.
- ⚠️ `data_mock/` es solo respaldo local para desarrollo; en producción todo va a Firestore. En Cloud Run el disco es efímero.
- ⚠️ El archivo `test-once.ts` usa el teléfono de prueba `56912345678`, que está marcado "derivado_ventas" en datos locales → el bot se pausa a propósito con ese número. Para probar, usar un número nuevo.
- La carpeta `ECC-main` en la raíz es un repo externo descargado (herramientas de Claude Code), no es parte del producto.

## 6. Cómo probar que todo sigue vivo (30 segundos)

```bash
curl https://ecoclima-backend-437714636966.southamerica-west1.run.app/health
curl https://ecoclima-os-7ca1b.web.app/api/leads
```
Ambos deben devolver JSON (no HTML).
