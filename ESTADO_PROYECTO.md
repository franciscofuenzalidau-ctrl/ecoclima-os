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

## 3-bis. Cambios al flujo del bot (30-07-2026, requerimientos de Pilar)

Todo en `src/services/gemini.ts` (systemInstruction + extractLeadInfo) y `src/routes/leads.ts`:

- **Sin precios**: el bot NO entrega valores de mantención ni instalación. Al terminar las preguntas deriva a la ejecutiva con la frase que dispara la alerta y pausa el bot.
- **Formulario de ingreso** (ambos flujos, una pregunta por mensaje): empresa o particular · teléfono de contacto · cantidad de equipos · forma de pago. Se guardan en `client_type`, `contact_phone`, `equipment_count`, `payment_method`.
- **Agendamiento**: el bot propone 2-3 fechas libres (lun-sáb 09:00-18:00) revisando la agenda; no pregunta fecha/hora abierta. Si no logran coordinar, deriva.
- **Tipo de servicio**: opción 1 del saludo = Mantención, opción 2 = Instalación.
- **Recordatorio anual**: al marcar "Instalado" se graba automáticamente `installation_date` o `last_maintenance_date` (antes era manual y la campaña no encontraba clientes). El mensaje de campaña se adapta a instalación/mantención y a la cantidad de equipos.
- **Encuesta de satisfacción**: al pasar a "Instalado" el bot envía 4 preguntas (nota 1-7, expectativas, recomendación, comentario libre) y pide autorización para usar el testimonio. Se guarda en `satisfaction_rating` y `satisfaction_comment`.
- **Precios de mantención en `config_reglas.json`**: `maintenance_cost_small` 59000 y `maintenance_cost_large` 65000 (referencia interna; el bot no los dice).
- ✅ **Plantillas de WhatsApp aprobadas por Meta (11-08-2026)**: los mensajes iniciados por la empresa requieren plantilla aprobada cuando pasaron +24 h desde el último mensaje del cliente. Las tres están aprobadas y en uso: `recordatorio_mantencion_anual` (MARKETING, 1 variable), `post_servicio_pago_encuesta` (UTILITY, sin variables) y `aviso_visita_tecnico` (UTILITY, 5 variables). El código intenta la plantilla primero y cae a texto libre si falla.

## 3-ter. Limpieza y monitoreo (31-07-2026)

- **Repo limpio**: se sacaron del control de versiones los ~50 archivos de la página Devpost guardada (quedaron en disco, solo salieron de git). El repo pasó de 96 a 47 archivos: solo `ecoclima-backend/`, `ecoclima-dashboard/`, `README.md`, `ESTADO_PROYECTO.md` y `.gitignore`.
- **README.md en inglés** creado para los jueces (arquitectura, qué decide la IA, cómo correrlo, variables de entorno, cómo probar el webhook con curl).
- **Alerta de disponibilidad creada**: uptime check "Bot EcoClima - backend health" sobre `https://ecoclima-backend-...run.app/health` cada 1 min, con política de alerta "ALERTA: Bot EcoClima caido" que notifica por email a franciscofuenzalidau@gmail.com (canal "Francisco - Email"). Si el bot se cae >1 min, llega correo.
- **Servidores fantasma identificados**: estaban en el proyecto **`massive-physics-412101` ("My First Project")**, NO en ecoclima-os-7ca1b. Eran 2 servicios Cloud Run llamados `ecoclima-os` (us-east1 y us-central1) con 2 activadores de Cloud Build escuchando el MISMO repo de GitHub — por eso se redesplegaban solos con cada push nuestro.
  - **Acción tomada**: los 2 activadores de Cloud Build quedaron **Inhabilitados** (ya no se redespliegan). Los servicios NO se borraron por decisión del usuario; siguen existiendo pero sin recibir tráfico de WhatsApp (el webhook apunta a Santiago).
  - Pendiente opcional: borrar esos 2 servicios cuando se confirme que no hacen falta.

## 4. ESTADO DE PENDIENTES

> Actualizado el 03-08-2026. Lo que aparecía aquí como pendiente ya está resuelto en su mayoría;
> esta sección estaba desactualizada respecto de las secciones 3-bis y 3-ter de arriba.

### ✅ Resueltos

- [x] **Webhook de Meta** — conectado y verificado. Callback `https://ecoclima-backend-437714636966.southamerica-west1.run.app/webhook`, suscrito al campo `messages`. Los mensajes del +56 9 5848 9307 llegan al backend de Santiago. *(27-07-2026)*
- [x] **Token de WhatsApp** — resultó ser **permanente**, no temporal: es un token de usuario del sistema ("bot") en Meta Business, no expira. El pendiente no existía. *(27-07-2026)*
- [x] **Repo limpio** — los ~50 archivos de la página Devpost guardada salieron del control de versiones. El repositorio rastrea 53 archivos: `ecoclima-backend/`, `ecoclima-dashboard/`, `Product_Evidence/`, `README.md`, `ESTADO_PROYECTO.md`, `LICENSE` y `.gitignore`. *(31-07-2026)*
- [x] **README en inglés** para los jueces — arquitectura, qué decide la IA, cómo correrlo, variables de entorno y cómo probar el webhook. *(31-07-2026)*
- [x] **Alerta de disponibilidad** — uptime check sobre `/health` cada 1 min con alerta por correo si el bot cae. *(31-07-2026)*
- [x] **Carpeta de evidencia** — `Product_Evidence/` con logs de ejecución de Gemini, métricas de la API, leads de producción y health check. *(01-08-2026)*
- [x] **Plantillas de WhatsApp aprobadas por Meta** — las 3 (`recordatorio_mantencion_anual`, `post_servicio_pago_encuesta`, `aviso_visita_tecnico`). El bot ya puede iniciar conversaciones. *(11-08-2026)*
- [x] **Agenda real con cupos** — 2 por día (09:15 y 14:00), lunes a viernes, editable desde el dashboard. El bot recibe la fecha de hoy y la agenda de 3 semanas, y solo ofrece cupos que existen. *(11-08-2026)*

### ⏳ Realmente pendientes

- [ ] **Variables SMTP** (`SMTP_HOST/PORT/USER/PASS`): usadas por `leads.ts` (exportar por email) pero NO configuradas ni en `.env` ni en Cloud Run. Esa función fallará hasta configurarlas o deshabilitarla.
- [ ] **Rotar claves** (Gemini, Maps) — llevan meses sin rotar y estuvieron en este disco.
- [ ] **Servicios fantasma**: en el proyecto `massive-physics-412101` quedan 2 servicios Cloud Run `ecoclima-os` (us-east1 y us-central1) sin tráfico y con sus activadores de Cloud Build inhabilitados. Borrarlos cuando se confirme que no hacen falta.

> Los pendientes de la **postulación** al XPRIZE (video, ingresos, autorización del dueño, testimonios)
> se llevan aparte, en `CHECKLIST_ENTREGA_XPRIZE.md`.

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
