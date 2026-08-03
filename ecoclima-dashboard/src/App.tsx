import { useState, useEffect } from 'react';
import { 
  Users, 
  Wrench, 
  Calendar, 
  Navigation, 
  AlertCircle, 
  RefreshCw,
  Search,
  Phone,
  Sparkles,
  MapPin,
  Mail,
  X,
  Send,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Zap,
  Lock,
  Info,
  Thermometer,
  TrendingUp,
  DollarSign,
  Plus,
  Settings,
  Save,
  MessageSquare,
  Star,
  Trash2
} from 'lucide-react';

interface Lead {
  id: string;
  client_name?: string;
  phone: string;
  service_type: 'installation' | 'maintenance' | null;
  installation_age?: string;
  address?: string;
  appointment_time?: string;
  latitude?: number;
  longitude?: number;
  area_m2?: number;
  calculated_btu?: string;
  created_at: string;
  status?: 'Pendiente' | 'Evaluado' | 'Instalado' | 'Cancelado' | 'pendiente_revision' | 'derivado_ventas';
  technician?: string;
  technical_notes?: string;
  notes?: string;
  client_type?: 'empresa' | 'particular' | null;
  contact_phone?: string;
  equipment_count?: number;
  payment_method?: string;
  satisfaction_rating?: number;
  satisfaction_comment?: string;
  conversation?: Array<{ role: 'user' | 'model'; text: string }>;
  last_message_at?: string;
}

// Teléfonos de técnicos con número REAL verificado. No agregar números de relleno:
// si el técnico no está aquí, simplemente no se muestra el botón de WhatsApp.
const TECHNICIAN_PHONES: Record<string, string> = {
  francisco: '56990939188'
};

// --- Agenda -----------------------------------------------------------------
// Solo existen dos cupos por día, de lunes a viernes. El backend es la autoridad:
// aquí nunca se inventan fechas, se dibuja lo que devuelve /api/leads/agenda.

interface AgendaSlot {
  id: string;          // "YYYY-MM-DDTHH:mm" en hora de Chile
  label: string;       // "lunes 4 de agosto a las 09:15"
  date: string;
  time: string;
  ocupado: boolean;
  esExtra: boolean;        // horario agregado a mano por Pilar
  reservado: boolean;      // apartado por Pilar, el bot no lo ofrece
  motivoReserva: string | null;
  lead: {
    phone: string;
    client_name?: string | null;
    service_type: 'installation' | 'maintenance' | null;
    status: string;
    technician: string;
    address?: string | null;
  } | null;
}

interface AgendaResponse {
  hoy: string;
  horarios: string[];
  cupos: AgendaSlot[];
  fueraDeAgenda: Array<{ id: string; phone: string; status: string }>;
}

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Encabezado de una columna del calendario: "Lun 4 ago". */
const tituloDeDia = (fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS_CORTOS[dow]} ${d} ${MESES_CORTOS[m - 1]}`;
};

const getBackendUrl = () => {
  const host = window.location.hostname;
  const port = window.location.port;
  
  if (port === '5173') {
    return `http://${host}:3000`;
  }
  
  const protocol = window.location.protocol;
  const portStr = port ? `:${port}` : '';
  return `${protocol}//${host}${portStr}`;
};

const BACKEND_URL = getBackendUrl();
const API_BASE = `${BACKEND_URL}/api/leads`;

const translations: Record<'es' | 'en', Record<string, string>> = {
  es: {
    // Sidebar
    nav_dashboard: "Dashboard Principal",
    nav_routes: "Rutas y Logística",
    nav_leads: "Gestión de Leads",
    nav_terrain: "Módulo de Terreno",
    nav_ai_control: "Centro de Control de IA",
    nav_finances: "Finanzas y Auditoría",
    project_progress: "PROYECTO GENERAL",
    project_status: "Estado",
    project_advance: "Avance",
    subtitle: "URGENCIA DE INSTALACIÓN",
    
    // Header Buttons
    btn_guide: "Guía de Uso",
    btn_export_csv: "Exportar CSV",
    btn_send_accountant: "Enviar a Contador",
    btn_sync: "Sincronizar Datos",
    
    // Warning banner
    warn_critical: "Atención: Asignaciones Pendientes Críticas",
    warn_pending_leads: "Hay {count} visitas registradas en estado de urgencia/pendiente que aún no tienen asignado un técnico en terreno. Asigna técnicos en el módulo de Gestión de Leads para iniciar sus rutas y el protocolo técnico.",
    
    // Slide Titles
    title_dashboard: "Dashboard Principal",
    title_routes: "Rutas y Logística",
    title_leads: "Gestión de Leads",
    title_terrain: "Módulo de Terreno",
    title_ai_control: "Centro de Control de IA",
    title_finances: "Finanzas y Auditoría XPRIZE",
    
    // Slide Subtitles
    subtitle_dashboard: "Métricas generales y control de avance de la operación",
    subtitle_routes: "Planificación de Ruta Técnica",
    desc_routes: "Secuencia geográfica inteligente de visitas optimizadas por vecindad",
    subtitle_leads: "Control Operativo de Clientes",
    desc_leads: "Gestión directa de visitas técnicas, asignación y estado de servicios",
    subtitle_terrain: "Módulo Técnico Móvil",
    desc_terrain: "Lista de chequeo de calidad y registro de parámetros de instalación",
    subtitle_ai_control: "Centro de Control de IA",
    desc_ai_control: "Registro de ejecución de agentes en producción y telemetría de la API de Gemini",
    subtitle_finances: "Finanzas y Auditoría XPRIZE",
    desc_finances: "Control de ingresos, costos de operación y gastos de adquisición de clientes",

    // KPI Cards & Dials (Slide 0)
    kpi_total_leads: "LEADS TOTALES",
    kpi_total_leads_desc: "Registrados en sistema",
    kpi_installations: "INSTALACIONES",
    kpi_installations_desc: "Dimensionamientos activos",
    kpi_maintenance: "MANTENIMIENTOS",
    kpi_maintenance_desc: "Visitas de mantenimiento",
    kpi_completed: "SERVICIOS COMPLETADOS",
    kpi_completed_desc: "Instalaciones finalizadas",
    kpi_satisfaction: "Satisfacción Cliente",
    kpi_satisfaction_desc: "Visitas evaluadas con máxima puntuación",
    kpi_assignment: "Asignación Técnica",
    kpi_assignment_desc: "Disponibilidad de instaladores en ruta",
    kpi_efficiency: "Eficiencia de BTU",
    kpi_efficiency_desc: "Precisión de dimensionamiento sugerido",
    kpi_progress_title: "Avance de Servicios Realizados",
    kpi_progress_desc: "Métricas en Vivo (Leads)",
    lbl_completed_services: "Servicios Completados (Instalado)",
    lbl_installed: "INSTALADO",
    lbl_active_planning: "Planificación Activa (Pendientes / Evaluados)",
    lbl_planned: "PLANIFICADO",
    desc_installation_phase: "Fase de instalación incluye dimensionamiento y montaje de equipos Split Muro y Ductos de Ventilación.",
    desc_certification_phase: "Fase de certificación añade pruebas de vacío, presurización de nitrógeno y protocolos de calidad Minsal.",
    kpi_traffic_light: "Semáforo de Estado Operativo",
    kpi_lead_capture: "Captura de Leads",
    kpi_lead_capture_desc: "Prospectos registrados y direcciones georreferenciadas.",
    kpi_route_assign: "Ruta y Asignación",
    kpi_route_assign_desc: "Visitas agendadas y técnicos asignados en ruta.",
    kpi_quality_protocol: "Protocolos de Calidad",
    kpi_quality_protocol_desc: "Pruebas de vacío, drenaje y aprobación final.",
    status_verified: "VERIFICADO",
    status_in_progress: "EN PROCESO",
    status_completed: "COMPLETADO",
    status_active: "ACTIVO",
    status_blocked: "BLOQUEADO",

    // Slide 1 (Routes)
    slide_2_badge: "DIAPOSITIVA 2: LOGÍSTICA DE ATENCIÓN",
    lbl_ordered_route_points: "Puntos de Ruta Ordenados",
    lbl_no_geolocations: "Sin geolocalizaciones registradas.",
    lbl_dynamic_map: "Mapa Dinámico de Clientes",
    lbl_install_action: "Instalar",
    lbl_maintenance_action: "Mantención",

    // Slide 2 (Leads Management)
    slide_3_badge: "DIAPOSITIVA 3: OPERACIONES",
    ph_search_client: "Buscar cliente...",
    opt_all_statuses: "Todos los estados",
    lbl_loading_data: "Cargando datos...",
    lbl_no_clients_found: "No se encontraron clientes registrados.",
    th_client: "Cliente",
    th_service: "Servicio",
    th_detail: "Detalle",
    th_address: "Dirección / Cita",
    th_assignment: "Asignación",
    th_status: "Estado",
    lbl_installation: "Instalación",
    lbl_maintenance: "Mantenimiento",
    lbl_age: "Antigüedad:",
    tip_view_maps: "Ver en Google Maps",
    lbl_no_address: "Sin dirección",
    lbl_to_define: "Por definir",
    lbl_gemini_ai: "IA Gemini:",
    ph_technician: "Técnico",
    tip_send_whatsapp: "Enviar WhatsApp al Técnico",

    // Slide 3 (Terrain Module)
    slide_4_badge: "DIAPOSITIVA 4: PROTOCOLO TÉCNICO DE TERRENO",
    lbl_field_technician: "Técnico en Terreno",
    opt_select_technician: "Seleccionar Técnico...",
    lbl_assigned_visits: "Visitas Asignadas",
    lbl_select_technician_prompt: "Por favor, selecciona un técnico.",
    lbl_no_visits_assigned: "No hay visitas activas asignadas a {tech}.",
    lbl_no_client_selected: "Ningún Cliente Seleccionado",
    desc_no_client_selected: "Selecciona una visita técnica en el panel izquierdo para iniciar el protocolo.",
    lbl_visit_completed_success: "¡Visita Completada con Éxito!",
    desc_visit_completed_success: "Los parámetros de instalación y notas técnicas han sido guardados. El cliente ahora está en estado \"Instalado\" y listo para facturación.",
    btn_accept: "Aceptar",
    lbl_quality_protocol_title: "Protocolo Técnico de Calidad",
    lbl_client: "Cliente:",
    lbl_new_installation: "Instalación Nueva",
    lbl_ai_diagnostic_notes: "Diagnóstico y Notas de IA (Gemini):",
    lbl_terrain_notes_title: "Notas de Instalación en Terreno:",
    lbl_verification_parameters: "Parámetros de Verificación",
    chk_vacuum: "Vacío de cañerías (≥30 min)",
    chk_pressure: "Presión de refrigerante estable",
    chk_level: "Equipos interior/exterior nivelados",
    chk_isolation: "Aislación térmica y encintado ok",
    chk_drain: "Prueba de drenaje de condensado exitosa",
    lbl_terrain_notes_label: "Notas Técnicas / Números de Serie",
    ph_terrain_notes: "Ej: Instalado equipo Clark de 12.000 BTU. Nro Serie Unidad Exterior: CL-7728394-B. Todo funcionando ok.",
    lbl_saving_protocol: "Guardando protocolo técnico...",
    lbl_save_protocol_btn: "Registrar y Finalizar Visita",

    // Slide 4 (AI Control Center)
    slide_4_ai_badge: "XPRIZE: AI-NATIVE OPERATIONS",
    kpi_ai_calls: "Llamadas totales (Gemini)",
    kpi_ai_calls_desc: "Ejecutadas en producción",
    kpi_ai_latency: "Latencia Promedio",
    kpi_ai_latency_desc: "Tiempo de respuesta API",
    kpi_ai_tokens: "Tokens Consumidos",
    kpi_ai_tokens_desc: "Prompt + Output tokens",
    kpi_ai_success: "Tasa de Éxito API",
    kpi_ai_success_desc: "Peticiones exitosas sin error",
    lbl_agent_logs: "Registro de Ejecución del Agente (Agent Logs)",
    btn_clear_console: "Limpiar Consola",
    tbl_ai_timestamp: "Marca de Tiempo",
    tbl_ai_phone: "Teléfono",
    tbl_ai_type: "Tipo",
    tbl_ai_message: "Mensaje / Detalle de IA",
    lbl_no_ai_logs: "Sin logs de ejecución registrados en esta sesión. Interactúa con el chat de simulación para generar logs.",
    ai_status_title: "Estado del Sistema de IA",
    ai_playbook_status: "Estado del Playbook:",
    ai_playbook_active: "Activo 24/7",
    ai_version: "Versión de Gemini:",
    ai_channel: "Canal de Chat:",
    lbl_xprize_evidence_title: "Evidencia XPRIZE:",
    ai_explanation: "Este panel demuestra que el agente está interceptando continuamente las peticiones de WhatsApp y decidiendo de forma autónoma cuándo extraer parámetros geográficos (geocodificación) o ejecutar el diagnóstico visual multimodal de placas técnicas.",
    btn_sync_ai: "Sincronizar Métrica de IA",

    // Slide 5 (Finances & Audit)
    slide_5_badge: "XPRIZE: BUSINESS VIABILITY",
    kpi_total_revenue: "Ingresos Totales (USD)",
    lbl_may_aug_2026: "Mayo - Agosto 2026",
    kpi_total_costs: "Costos Totales (Excl. Mkt)",
    kpi_total_costs_desc: "Costos técnicos declarados",
    kpi_mkt_spend: "Inversión en Marketing (USD)",
    kpi_mkt_spend_desc: "Costo de adquisición de clientes",
    kpi_net_margin: "Margen Neto (%)",
    kpi_net_margin_desc: "Rentabilidad acumulada",
    btn_save_changes: "Guardar Cambios",
    btn_export_xprize: "Exportar Reporte XPRIZE (CSV)",
    tbl_monthly_statement: "Estado de Ingresos y Costos Mensuales",
    tbl_col_month: "Mes",
    tbl_col_client_rev: "Ingresos Clientes",
    tbl_col_related_rev: "Ingresos R. P.",
    tbl_col_op_costs: "Costo Operación",
    tbl_col_mkt_spend: "Gasto Marketing",
    tbl_col_explanation: "Explicación de Costos",
    ph_month_desc: "Breve descripción del mes",
    chart_comparison: "Comparación: Ingreso vs Costo Total",
    lbl_ing: "ING",
    lbl_cos: "COS",
    lbl_dynamic_financial_note: "Datos actualizados de forma dinámica a partir de la persistencia de Furtz Clima.",

    // Email Modal Dialog
    lbl_send_report_accountant: "Enviar Reporte al Contador",
    desc_send_report_accountant: "Exporta y envía el CSV de clientes instalados",
    lbl_accountant_email: "Correo del Contador",
    ph_accountant_email: "ejemplo@contador.cl",
    lbl_note: "Nota",
    desc_accountant_email_note: "Se enviará un correo con un archivo adjunto conteniendo únicamente a los clientes en estado \"Instalado\". Si usas una cuenta SMTP simulada, recibirás un enlace de bandeja virtual para visualizar el correo.",
    lbl_sending_report: "Enviando reporte...",
    btn_confirm_send: "Confirmar y Enviar",
    lbl_report_sent: "¡Reporte Enviado!",
    lbl_send_error: "Error de Envío",
    lbl_open_virtual_inbox: "Abrir Bandeja de Entrada Virtual",
    btn_close_window: "Cerrar Ventana",
    btn_try_again: "Volver a intentar",

    // Status Select Options
    status_pending: "Pendiente",
    status_evaluated: "Evaluado",
    status_installed: "Instalado",
    status_cancelled: "Cancelado",
    status_pendiente_revision: "Pendiente de Revisión",
    status_derivado_ventas: "Derivado a Ventas",

    // Manual Client Registration
    btn_add_client: "Registrar Cliente",
    title_add_client: "Registrar Nuevo Cliente",
    lbl_client_name: "Nombre del Cliente",
    lbl_phone: "Número de Teléfono",
    lbl_service_type: "Tipo de Servicio",
    lbl_address: "Dirección Completa",
    lbl_appointment: "Fecha y Hora de Cita",
    lbl_area: "Superficie de Instalación (m²)",
    lbl_age_input: "Antigüedad del Equipo Actual",
    lbl_installation_date: "Fecha de Instalación",
    lbl_last_maintenance_date: "Último Mantenimiento",
    btn_send_preventive_campaign: "Campaña Preventiva",
    btn_campaign_sending: "Enviando Campaña...",
    success_campaign_sent: "Campaña preventiva enviada con éxito a {count} clientes.",
    error_campaign: "Error al enviar campaña.",
    lbl_notes: "Notas / Observaciones Especiales",
    lbl_suggest_visit: "Sugerir Visita de Factibilidad Técnica",
    lbl_busy_warning: "Advertencia de Agenda: Hay {count} visitas ya programadas para este día ({date}).",
    lbl_no_busy: "Fecha disponible. No hay visitas programadas aún.",
    lbl_busy_list: "Horarios programados para este día:",
    btn_cancel: "Cancelar",
    btn_register: "Registrar",
    lbl_registering: "Registrando...",
    status_registered_success: "¡Cliente registrado con éxito!",
    title_pricing_config: "Configuración de Tarifas y Equipos",
    desc_pricing_config: "Modifica los precios base de mantenciones, visitas de factibilidad técnica y rangos de precio por BTU de equipos.",
    lbl_maintenance_cost: "Costo Base Mantención (CLP)",
    lbl_feasibility_cost: "Costo Visita Factibilidad (CLP)",
    lbl_installation_cost_min: "Instalación Básica Mínima (CLP)",
    lbl_installation_cost_max: "Instalación Básica Máxima (CLP)",
    btn_save_config: "Guardar Tarifas",
    lbl_pricing_matrix: "Matriz de Precios de Equipos (Rangos en CLP)",
    lbl_economical: "Económicas",
    lbl_intermediate: "Intermedias",
    lbl_premium: "Premium"
  },
  en: {
    // Sidebar
    nav_dashboard: "Main Dashboard",
    nav_routes: "Routes & Logistics",
    nav_leads: "Leads Management",
    nav_terrain: "Terrain Module",
    nav_ai_control: "AI Control Center",
    nav_finances: "Finances & Audit",
    project_progress: "OVERALL PROJECT",
    project_status: "Status",
    project_advance: "Progress",
    subtitle: "INSTALLATION URGENCY",

    // Header Buttons
    btn_guide: "User Guide",
    btn_export_csv: "Export CSV",
    btn_send_accountant: "Send to Accountant",
    btn_sync: "Sync Data",

    // Warning banner
    warn_critical: "Attention: Critical Pending Assignments",
    warn_pending_leads: "There are {count} registered visits in urgent/pending state that do not have a field technician assigned. Assign technicians in the Leads Management module to start their routes and the technical protocol.",

    // Slide Titles
    title_dashboard: "Main Dashboard",
    title_routes: "Routes & Logistics",
    title_leads: "Leads Management",
    title_terrain: "Terrain Module",
    title_ai_control: "AI Control Center",
    title_finances: "XPRIZE Finances & Audit",

    // Slide Subtitles
    subtitle_dashboard: "General metrics and operation progress control",
    subtitle_routes: "Technical Route Planning",
    desc_routes: "Smart geographic sequence of visits optimized by neighborhood proximity",
    subtitle_leads: "Client Operations Control",
    desc_leads: "Direct management of technical visits, assignments, and service statuses",
    subtitle_terrain: "Field Technical Module",
    desc_terrain: "Quality checklist and field technical parameters registration",
    subtitle_ai_control: "AI Control Center",
    desc_ai_control: "Real-time agent execution logs and Gemini API telemetry",
    subtitle_finances: "XPRIZE Finances & Audit",
    desc_finances: "Track revenues, operating costs, and customer acquisition costs",

    // KPI Cards & Dials (Slide 0)
    kpi_total_leads: "TOTAL LEADS",
    kpi_total_leads_desc: "Registered in system",
    kpi_installations: "INSTALLATIONS",
    kpi_installations_desc: "Active sizing evaluations",
    kpi_maintenance: "MAINTENANCES",
    kpi_maintenance_desc: "Maintenance visits",
    kpi_completed: "COMPLETED SERVICES",
    kpi_completed_desc: "Finished installations",
    kpi_satisfaction: "Customer Satisfaction",
    kpi_satisfaction_desc: "Visits rated with maximum score",
    kpi_assignment: "Technical Assignment",
    kpi_assignment_desc: "Availability of technicians in routes",
    kpi_efficiency: "BTU Efficiency",
    kpi_efficiency_desc: "Sizing recommendation accuracy",
    kpi_progress_title: "Completed Services Progress",
    kpi_progress_desc: "Live metrics (Leads)",
    lbl_completed_services: "Completed Services (Installed)",
    lbl_installed: "INSTALLED",
    lbl_active_planning: "Active Planning (Pending / Evaluated)",
    lbl_planned: "PLANNED",
    desc_installation_phase: "Installation phase includes sizing and assembly of Split Wall units and Ventilation Ducts.",
    desc_certification_phase: "Certification phase adds vacuum tests, nitrogen pressurization, and Minsal quality protocols.",
    kpi_traffic_light: "Operational Status Traffic Light",
    kpi_lead_capture: "Leads Capture",
    kpi_lead_capture_desc: "Prospects registered and geocoded addresses.",
    kpi_route_assign: "Route & Assignment",
    kpi_route_assign_desc: "Scheduled visits and assigned technicians.",
    kpi_quality_protocol: "Quality Protocols",
    kpi_quality_protocol_desc: "Vacuum tests, drainage, and final approval.",
    status_verified: "VERIFIED",
    status_in_progress: "IN PROGRESS",
    status_completed: "COMPLETED",
    status_active: "ACTIVE",
    status_blocked: "BLOCKED",

    // Slide 1 (Routes)
    slide_2_badge: "SLIDE 2: ATTENTION LOGISTICS",
    lbl_ordered_route_points: "Ordered Route Points",
    lbl_no_geolocations: "No geolocations registered.",
    lbl_dynamic_map: "Dynamic Customer Map",
    lbl_install_action: "Install",
    lbl_maintenance_action: "Maintenance",

    // Slide 2 (Leads Management)
    slide_3_badge: "SLIDE 3: OPERATIONS",
    ph_search_client: "Search client...",
    opt_all_statuses: "All statuses",
    lbl_loading_data: "Loading data...",
    lbl_no_clients_found: "No registered clients found.",
    th_client: "Client",
    th_service: "Service",
    th_detail: "Detail",
    th_address: "Address / Appointment",
    th_assignment: "Assignment",
    th_status: "Status",
    lbl_installation: "Installation",
    lbl_maintenance: "Maintenance",
    lbl_age: "Age:",
    tip_view_maps: "View on Google Maps",
    lbl_no_address: "No address",
    lbl_to_define: "To define",
    lbl_gemini_ai: "Gemini AI:",
    ph_technician: "Technician",
    tip_send_whatsapp: "Send WhatsApp to Technician",

    // Slide 3 (Terrain Module)
    slide_4_badge: "SLIDE 4: FIELD TECHNICAL PROTOCOL",
    lbl_field_technician: "Field Technician",
    opt_select_technician: "Select Technician...",
    lbl_assigned_visits: "Assigned Visits",
    lbl_select_technician_prompt: "Please, select a technician.",
    lbl_no_visits_assigned: "No active visits assigned to {tech}.",
    lbl_no_client_selected: "No Client Selected",
    desc_no_client_selected: "Select a technical visit from the left panel to start the protocol.",
    lbl_visit_completed_success: "Visit Completed Successfully!",
    desc_visit_completed_success: "Installation parameters and technical notes have been saved. The client is now set to \"Installed\" and is ready for billing.",
    btn_accept: "Accept",
    lbl_quality_protocol_title: "Quality Technical Protocol",
    lbl_client: "Client:",
    lbl_new_installation: "New Installation",
    lbl_ai_diagnostic_notes: "AI Diagnostics & Notes (Gemini):",
    lbl_terrain_notes_title: "Field Installation Notes:",
    lbl_verification_parameters: "Verification Parameters",
    chk_vacuum: "Pipes vacuum test (≥30 min)",
    chk_pressure: "Stable refrigerant pressure",
    chk_level: "Leveled indoor/outdoor units",
    chk_isolation: "Thermal insulation and wrapping ok",
    chk_drain: "Successful condensate drain test",
    lbl_terrain_notes_label: "Technical Notes / Serial Numbers",
    ph_terrain_notes: "E.g., Installed 12,000 BTU Clark unit. Outdoor unit Serial No: CL-7728394-B. Everything working ok.",
    lbl_saving_protocol: "Saving technical protocol...",
    lbl_save_protocol_btn: "Register and Complete Visit",

    // Slide 4 (AI Control Center)
    slide_4_ai_badge: "XPRIZE: AI-NATIVE OPERATIONS",
    kpi_ai_calls: "Total Calls (Gemini)",
    kpi_ai_calls_desc: "Executed in production",
    kpi_ai_latency: "Average Latency",
    kpi_ai_latency_desc: "API response time",
    kpi_ai_tokens: "Tokens Consumed",
    kpi_ai_tokens_desc: "Prompt + Output tokens",
    kpi_ai_success: "API Success Rate",
    kpi_ai_success_desc: "Successful requests without error",
    lbl_agent_logs: "Agent Execution Log (Agent Logs)",
    btn_clear_console: "Clear Console",
    tbl_ai_timestamp: "Timestamp",
    tbl_ai_phone: "Phone",
    tbl_ai_type: "Type",
    tbl_ai_message: "AI Message / Details",
    lbl_no_ai_logs: "No execution logs recorded in this session. Interact with the chat simulator to generate logs.",
    ai_status_title: "AI System Status",
    ai_playbook_status: "Playbook Status:",
    ai_playbook_active: "Active 24/7",
    ai_version: "Gemini Version:",
    ai_channel: "Chat Channel:",
    lbl_xprize_evidence_title: "XPRIZE Evidence:",
    ai_explanation: "This panel demonstrates that the agent is continuously intercepting WhatsApp messages and autonomously deciding when to extract geographical coordinates (geocoding) or run multimodal vision diagnostics on technical stickers.",
    btn_sync_ai: "Sync AI Metrics",

    // Slide 5 (Finances & Audit)
    slide_5_badge: "XPRIZE: BUSINESS VIABILITY",
    kpi_total_revenue: "Total Revenue (USD)",
    lbl_may_aug_2026: "May - August 2026",
    kpi_total_costs: "Total Costs (Excl. Mkt)",
    kpi_total_costs_desc: "Declared technical costs",
    kpi_mkt_spend: "Marketing Investment (USD)",
    kpi_mkt_spend_desc: "Customer acquisition cost",
    kpi_net_margin: "Net Margin (%)",
    kpi_net_margin_desc: "Accumulated profitability",
    btn_save_changes: "Save Changes",
    btn_export_xprize: "Export XPRIZE Report (CSV)",
    tbl_monthly_statement: "Monthly Revenue and Costs Statement",
    tbl_col_month: "Month",
    tbl_col_client_rev: "Customer Revenue",
    tbl_col_related_rev: "Related Party Rev.",
    tbl_col_op_costs: "Operating Cost",
    tbl_col_mkt_spend: "Marketing Spend",
    tbl_col_explanation: "Cost Explanation",
    ph_month_desc: "Brief description of the month",
    chart_comparison: "Comparison: Revenue vs Total Cost",
    lbl_ing: "REV",
    lbl_cos: "COS",
    lbl_dynamic_financial_note: "Data updated dynamically based on Furtz Clima persistence.",

    // Email Modal Dialog
    lbl_send_report_accountant: "Send Report to Accountant",
    desc_send_report_accountant: "Export and send the CSV of installed clients",
    lbl_accountant_email: "Accountant Email",
    ph_accountant_email: "example@accountant.com",
    lbl_note: "Note",
    desc_accountant_email_note: "An email will be sent with an attachment containing only clients in \"Installed\" state. If using a simulated SMTP account, you will receive a virtual inbox link to view the email.",
    lbl_sending_report: "Sending report...",
    btn_confirm_send: "Confirm and Send",
    lbl_report_sent: "Report Sent!",
    lbl_send_error: "Send Error",
    lbl_open_virtual_inbox: "Open Virtual Inbox",
    btn_close_window: "Close Window",
    btn_try_again: "Try Again",

    // Status Select Options
    status_pending: "Pending",
    status_evaluated: "Evaluated",
    status_installed: "Installed",
    status_cancelled: "Cancelled",
    status_pendiente_revision: "Pending Review",
    status_derivado_ventas: "Referred to Sales",

    // Manual Client Registration
    btn_add_client: "Add Client",
    title_add_client: "Register New Client",
    lbl_phone: "Phone Number",
    lbl_service_type: "Service Type",
    lbl_address: "Full Address",
    lbl_appointment: "Appointment Date & Time",
    lbl_area: "Installation Area (m²)",
    lbl_age_input: "Current Equipment Age",
    lbl_installation_date: "Installation Date",
    lbl_last_maintenance_date: "Last Maintenance Date",
    btn_send_preventive_campaign: "Preventive Campaign",
    btn_campaign_sending: "Sending Campaign...",
    success_campaign_sent: "Preventive campaign sent successfully to {count} clients.",
    error_campaign: "Error sending campaign.",
    lbl_notes: "Notes / Special Observations",
    lbl_suggest_visit: "Suggest Technical Feasibility Visit",
    lbl_busy_warning: "Schedule Warning: There are {count} visits already scheduled for this day ({date}).",
    lbl_no_busy: "Date available. No scheduled visits yet.",
    lbl_busy_list: "Scheduled times for this day:",
    btn_cancel: "Cancel",
    btn_register: "Register",
    lbl_registering: "Registering...",
    status_registered_success: "Client registered successfully!",
    title_pricing_config: "Tariff & Equipment Settings",
    desc_pricing_config: "Modify base prices for maintenance, technical feasibility visits, and price ranges by equipment BTU size.",
    lbl_maintenance_cost: "Base Maintenance Cost (CLP)",
    lbl_feasibility_cost: "Feasibility Visit Cost (CLP)",
    lbl_installation_cost_min: "Min Basic Installation Cost (CLP)",
    lbl_installation_cost_max: "Max Basic Installation Cost (CLP)",
    btn_save_config: "Save Tariffs",
    lbl_pricing_matrix: "Equipment Pricing Matrix (Ranges in CLP)",
    lbl_economical: "Economical",
    lbl_intermediate: "Intermediate",
    lbl_premium: "Premium"
  }
};

export default function App() {
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const t = (key: string, fallback: string) => translations[language][key] || fallback;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [optimizedRoute, setOptimizedRoute] = useState<Lead[]>([]);
  const [currentSlide, setCurrentSlide] = useState<number>(0);

  // AI Control Center States
  const [aiLogs, setAiLogs] = useState<any[]>([]);
  const [aiMetrics, setAiMetrics] = useState<{
    totalCalls: number;
    totalTokens: number;
    avgLatencyMs: number;
    successRate: number;
    errorsCount: number;
  }>({
    totalCalls: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
    successRate: 100,
    errorsCount: 0
  });

  // Financial metrics states
  interface FinancialItem {
    month: string;
    client_revenue: number;
    related_revenue: number;
    operating_costs: number;
    marketing_spend: number;
    cost_description?: string;
  }
  const [financials, setFinancials] = useState<FinancialItem[]>([]);

  // Configuración de Tarifas
  interface PricingConfig {
    btu_matrix: Array<{ max_m2: number; btu: string }>;
    brands: { primary: string; alternatives: string[] };
    installation_cost: { min: number; max: number };
    maintenance_cost: number;
    feasibility_visit_cost: number;
    pricing_matrix: {
      [btu: string]: {
        economicas: string;
        intermedias: string;
        premium: string;
      };
    };
  }
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null);

  // Furtz Clima statistics and calculations
  const totalLeads = leads.length;
  const installationCount = leads.filter(l => l.service_type === 'installation').length;
  const maintenanceCount = leads.filter(l => l.service_type === 'maintenance').length;
  const pendingVisits = leads.filter(l => l.status === 'Pendiente').length;
  const installedCount = leads.filter(l => l.status === 'Instalado').length;
  const evaluatedCount = leads.filter(l => l.status === 'Evaluado').length;
  const unassignedPendingCount = leads.filter(l => l.status === 'Pendiente' && !l.technician).length;

  // Dynamic project general progress
  const overallProgress = totalLeads > 0 ? Math.round((installedCount / totalLeads) * 100) : 0;

  // Email modal states
  const [showEmailModal, setShowEmailModal] = useState<boolean>(false);
  const [accountantEmail, setAccountantEmail] = useState<string>('contador@furtz.cl');
  const [sendingEmail, setSendingEmail] = useState<boolean>(false);
  const [emailStatus, setEmailStatus] = useState<{ type: 'success' | 'error' | null; message: string; testUrl?: string }>({ type: null, message: '' });

  // Add Client modal states
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
  // Conversación que se está mirando en el modal de chat, y teléfono al que se le está enviando la encuesta.
  const [chatLead, setChatLead] = useState<Lead | null>(null);
  const [sendingSurveyTo, setSendingSurveyTo] = useState<string | null>(null);
  const [deletingPhone, setDeletingPhone] = useState<string | null>(null);
  // Agenda: cupos reales (lun-vie, 09:15 y 14:00) y la cita que Pilar está moviendo.
  const [agenda, setAgenda] = useState<AgendaResponse | null>(null);
  const [semana, setSemana] = useState<number>(0);
  const [moviendo, setMoviendo] = useState<AgendaSlot | null>(null);
  const [guardandoCita, setGuardandoCita] = useState<boolean>(false);
  const [agendaAbierta, setAgendaAbierta] = useState<boolean>(true);
  const [showAddClientModal, setShowAddClientModal] = useState<boolean>(false);
  const [newClientName, setNewClientName] = useState<string>('');
  const [newClientPhone, setNewClientPhone] = useState<string>('');
  const [newClientServiceType, setNewClientServiceType] = useState<'installation' | 'maintenance'>('installation');
  const [newClientAddress, setNewClientAddress] = useState<string>('');
  const [newClientAppointmentTime, setNewClientAppointmentTime] = useState<string>('');
  const [newClientAreaM2, setNewClientAreaM2] = useState<string>('');
  const [newClientAge, setNewClientAge] = useState<string>('');
  const [newClientStatus, setNewClientStatus] = useState<string>('Pendiente');
  const [newClientTechnician, setNewClientTechnician] = useState<string>('');
  const [newClientNotes, setNewClientNotes] = useState<string>('');
  const [newClientSuggestVisit, setNewClientSuggestVisit] = useState<boolean>(true);
  const [creatingClient, setCreatingClient] = useState<boolean>(false);
  const [newClientInstallationDate, setNewClientInstallationDate] = useState<string>('');
  const [newClientLastMaintenanceDate, setNewClientLastMaintenanceDate] = useState<string>('');
  const [sendingCampaign, setSendingCampaign] = useState<boolean>(false);

  // Helper to get appointments for a selected day (format: YYYY-MM-DD)
  const getAppointmentsForDate = (dateTimeStr: string) => {
    if (!dateTimeStr) return [];
    const targetDate = dateTimeStr.split('T')[0]; // Get YYYY-MM-DD
    return leads.filter(lead => {
      if (!lead.appointment_time) return false;
      return lead.appointment_time.includes(targetDate);
    });
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientPhone) return;

    setCreatingClient(true);
    try {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_name: newClientName,
          phone: newClientPhone,
          service_type: newClientServiceType,
          installation_age: newClientServiceType === 'maintenance' ? newClientAge : null,
          address: newClientAddress,
          appointment_time: newClientAppointmentTime,
          area_m2: newClientServiceType === 'installation' ? newClientAreaM2 : null,
          status: newClientStatus,
          technician: newClientTechnician,
          notes: newClientNotes,
          suggest_visit: newClientSuggestVisit,
          installation_date: newClientInstallationDate || null,
          last_maintenance_date: newClientLastMaintenanceDate || null
        })
      });

      if (res.ok) {
        // Refresh leads list & routes
        await fetchLeads();
        await fetchRouteOptimization();
        // Reset states
        setNewClientName('');
        setNewClientPhone('');
        setNewClientAddress('');
        setNewClientAppointmentTime('');
        setNewClientAreaM2('');
        setNewClientAge('');
        setNewClientStatus('Pendiente');
        setNewClientTechnician('');
        setNewClientNotes('');
        setNewClientSuggestVisit(true);
        setNewClientInstallationDate('');
        setNewClientLastMaintenanceDate('');
        setShowAddClientModal(false);
      } else {
        const err = await res.json();
        alert('Error al registrar cliente: ' + (err.error || 'Intente nuevamente'));
      }
    } catch (err) {
      console.error('Error al registrar cliente:', err);
      alert('Error de conexión al registrar cliente.');
    } finally {
      setCreatingClient(false);
    }
  };

  const sendPreventiveCampaign = async () => {
    setSendingCampaign(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/leads/send-preventive-offers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (res.ok) {
        alert(t('success_campaign_sent', 'Campaña preventiva enviada con éxito a {count} clientes.').replace('{count}', String(data.count || 0)));
        await fetchLeads(); // Refresh leads
      } else {
        alert(t('error_campaign', 'Error al enviar campaña:') + ' ' + (data.error || 'Intente nuevamente'));
      }
    } catch (err) {
      console.error('Error al enviar campaña preventiva:', err);
      alert(t('error_campaign', 'Error al enviar campaña.'));
    } finally {
      setSendingCampaign(false);
    }
  };

  const sendEmailToAccountant = async () => {
    setSendingEmail(true);
    setEmailStatus({ type: null, message: '' });
    try {
      const res = await fetch(`${BACKEND_URL}/api/leads/export-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: accountantEmail })
      });
      const data = await res.json();
      if (res.ok) {
        setEmailStatus({ 
          type: 'success', 
          message: data.message || 'Reporte enviado con éxito.',
          testUrl: data.testUrl
        });
      } else {
        setEmailStatus({ 
          type: 'error', 
          message: data.error || 'Ocurrió un error al enviar el reporte.'
        });
      }
    } catch (error) {
      console.error('Error sending email:', error);
      setEmailStatus({ 
        type: 'error', 
        message: 'No se pudo conectar con el servidor backend.'
      });
    } finally {
      setSendingEmail(false);
    }
  };

  // Technician Slide state
  const [activeTech, setActiveTech] = useState<string>('');
  const [selectedLeadForTech, setSelectedLeadForTech] = useState<Lead | null>(null);
  const [checklist, setChecklist] = useState({
    vacuum: false,
    pressure: false,
    level: false,
    isolation: false,
    drain: false
  });
  const [techNotes, setTechNotes] = useState<string>('');
  const [savingProtocol, setSavingProtocol] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const techLeads = leads.filter(l => 
    l.technician && 
    l.technician.toLowerCase() === activeTech.toLowerCase() && 
    l.status !== 'Instalado' && 
    l.status !== 'Cancelado'
  );

  const saveTechnicalProtocol = async () => {
    if (!selectedLeadForTech) return;
    setSavingProtocol(true);
    try {
      const checklistSummary = `[Protocolo Ok: ${Object.entries(checklist)
        .filter(([_, v]) => v)
        .map(([k, _]) => k === 'vacuum' ? 'Vacío' : k === 'pressure' ? 'Presión' : k === 'level' ? 'Nivel' : k === 'isolation' ? 'Aislación' : 'Drenaje')
        .join(', ')}]`;
      
      const combinedNotes = `${techNotes} ${checklistSummary}`.trim();

      const res = await fetch(`${API_BASE}/${selectedLeadForTech.phone}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          status: 'Instalado',
          technical_notes: combinedNotes 
        })
      });

      if (res.ok) {
        setSaveSuccess(true);
        fetchLeads();
        fetchRouteOptimization();
      } else {
        alert('Ocurrió un error al guardar el protocolo técnico.');
      }
    } catch (error) {
      console.error('Error saving technical protocol:', error);
      alert('Error de conexión con el servidor.');
    } finally {
      setSavingProtocol(false);
    }
  };

  // Fetch leads
  const fetchLeads = async () => {
    try {
      setRefreshing(true);
      const res = await fetch(API_BASE);
      const data = await res.json();
      if (Array.isArray(data)) {
        const normalized = data.map(item => ({
          ...item,
          status: item.status || 'Pendiente'
        }));
        setLeads(normalized);
      }
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Fetch optimized route
  const fetchRouteOptimization = async () => {
    try {
      const res = await fetch(`${API_BASE}/route-optimization`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setOptimizedRoute(data);
      }
    } catch (error) {
      console.error('Error fetching route optimization:', error);
    }
  };

  const fetchAICenterData = async () => {
    try {
      const logsRes = await fetch(`${BACKEND_URL}/api/ai-control/logs`);
      const metricsRes = await fetch(`${BACKEND_URL}/api/ai-control/metrics`);
      if (logsRes.ok && metricsRes.ok) {
        const logsData = await logsRes.json();
        const metricsData = await metricsRes.json();
        setAiLogs(logsData);
        setAiMetrics(metricsData);
      }
    } catch (error) {
      console.error('Error fetching AI Control Center data:', error);
    }
  };

  const resetAIMetrics = async () => {
    if (!confirm('¿Estás seguro de que deseas reiniciar los contadores y limpiar los logs de la IA?')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai-control/reset`, { method: 'POST' });
      if (res.ok) {
        fetchAICenterData();
      }
    } catch (error) {
      console.error('Error resetting AI metrics:', error);
    }
  };

  const fetchFinancials = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/finances`);
      if (res.ok) {
        const data = await res.json();
        setFinancials(data);
      }
    } catch (error) {
      console.error('Error fetching financials:', error);
    }
  };

  const handleFinancialFieldChange = (index: number, field: keyof FinancialItem, value: string) => {
    setFinancials(prev => {
      const copy = [...prev];
      if (field === 'cost_description') {
        copy[index] = { ...copy[index], [field]: value };
      } else {
        copy[index] = { ...copy[index], [field]: Number(value) || 0 };
      }
      return copy;
    });
  };

  const saveFinancials = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/finances`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(financials)
      });
      if (res.ok) {
        alert('Métricas financieras actualizadas con éxito.');
        fetchFinancials();
      } else {
        alert('Error al guardar métricas financieras.');
      }
    } catch (error) {
      console.error('Error saving financials:', error);
      alert('Error de red al guardar métricas financieras.');
    }
  };

  const exportXPRIZEFinancials = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/finances/export-audit`, {
        method: 'POST'
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'xprize_financial_audit_report.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        alert('Error al generar el reporte de auditoría.');
      }
    } catch (error) {
      console.error('Error exporting financial report:', error);
      alert('Error de conexión al exportar el reporte.');
    }
  };

  const fetchPricingConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      if (res.ok) {
        const data = await res.json();
        setPricingConfig(data);
      }
    } catch (error) {
      console.error('Error fetching pricing config:', error);
    }
  };

  const savePricingConfig = async () => {
    if (!pricingConfig) return;
    try {
      const res = await fetch(`${API_BASE}/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(pricingConfig)
      });
      if (res.ok) {
        alert('Configuración de tarifas y equipos actualizada con éxito.');
        fetchPricingConfig();
      } else {
        alert('Error al guardar la configuración de tarifas y equipos.');
      }
    } catch (error) {
      console.error('Error saving pricing config:', error);
      alert('Error de red al guardar la configuración.');
    }
  };

  const handleConfigValueChange = (key: keyof PricingConfig, val: any) => {
    setPricingConfig(prev => {
      if (!prev) return null;
      return {
        ...prev,
        [key]: val
      };
    });
  };

  const handleConfigNestedValueChange = (parentKey: 'installation_cost', key: 'min' | 'max', val: number) => {
    setPricingConfig(prev => {
      if (!prev) return null;
      return {
        ...prev,
        [parentKey]: {
          ...prev[parentKey],
          [key]: val
        }
      };
    });
  };

  const handleMatrixValueChange = (btu: string, tier: 'economicas' | 'intermedias' | 'premium', val: string) => {
    setPricingConfig(prev => {
      if (!prev) return null;
      return {
        ...prev,
        pricing_matrix: {
          ...prev.pricing_matrix,
          [btu]: {
            ...prev.pricing_matrix[btu],
            [tier]: val
          }
        }
      };
    });
  };

  useEffect(() => {
    fetchLeads();
    fetchRouteOptimization();
    fetchAICenterData();
    fetchFinancials();
    fetchPricingConfig();
    fetchAgenda();

    // Poll AI metrics every 3 seconds for a real-time console experience
    const interval = setInterval(() => {
      fetchAICenterData();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleStatusChange = async (phone: string, newStatus: string) => {
    // "Enviar encuesta" no es un estado, es una acción dentro del mismo desplegable:
    // manda el mensaje por el bot y deja al cliente inscrito en el recordatorio anual.
    if (newStatus === '__send_survey') {
      await handleSendSurvey(phone);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/${phone}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setLeads(prev => prev.map(lead => lead.phone === phone ? { ...lead, status: newStatus as any } : lead));
        fetchRouteOptimization();
      }
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleTechnicianChange = async (phone: string, technician: string) => {
    try {
      const res = await fetch(`${API_BASE}/${phone}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ technician })
      });
      if (res.ok) {
        setLeads(prev => prev.map(lead => lead.phone === phone ? { ...lead, technician } : lead));
      }
    } catch (error) {
      console.error('Error updating technician:', error);
    }
  };

  // Envía a mano el mensaje post-servicio (forma de pago + encuesta) a través del bot.
  const handleSendSurvey = async (phone: string) => {
    setSendingSurveyTo(phone);
    try {
      const res = await fetch(`${API_BASE}/${phone}/send-survey`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(
          'Encuesta enviada al cliente por WhatsApp.' +
          (data.reminderRegistered
            ? '\n\nAdemás quedó inscrito para el recordatorio automático de mantención dentro de 1 año.'
            : '\n\nEl cliente ya estaba inscrito en el recordatorio anual de mantención.')
        );
        fetchLeads();
      } else {
        alert(
          `No se pudo enviar.\n\n${data.error || 'Error desconocido'}\n\n${data.hint || ''}`
        );
      }
    } catch (error) {
      console.error('Error enviando la encuesta:', error);
      alert('No se pudo contactar al servidor para enviar el mensaje.');
    } finally {
      setSendingSurveyTo(null);
    }
  };

  const fetchAgenda = async () => {
    try {
      const res = await fetch(`${API_BASE}/agenda?dias=42`);
      if (res.ok) setAgenda(await res.json());
    } catch (error) {
      console.error('Error cargando la agenda:', error);
    }
  };

  // Reserva un cupo para que el bot deje de ofrecerlo, o lo suelta.
  const reservarCupo = async (cupo: AgendaSlot) => {
    const motivo = window.prompt(
      `Reservar ${cupo.label}\n\nEl bot dejará de ofrecer este cupo.\n\n¿Para qué lo apartas? (opcional)`,
      ''
    );
    if (motivo === null) return;

    setGuardandoCita(true);
    try {
      const res = await fetch(`${API_BASE}/agenda/reserva`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: cupo.id, motivo })
      });
      if (res.ok) await fetchAgenda();
      else alert((await res.json().catch(() => ({}))).error || 'No se pudo reservar.');
    } finally {
      setGuardandoCita(false);
    }
  };

  const soltarReserva = async (cupo: AgendaSlot) => {
    setGuardandoCita(true);
    try {
      const res = await fetch(`${API_BASE}/agenda/reserva/${cupo.id}`, { method: 'DELETE' });
      if (res.ok) await fetchAgenda();
      else alert((await res.json().catch(() => ({}))).error || 'No se pudo soltar la reserva.');
    } finally {
      setGuardandoCita(false);
    }
  };

  // Agrega un horario extra a un día, fuera de los dos base.
  const agregarHorario = async (fecha: string) => {
    const hora = window.prompt(
      `Agregar un horario extra al ${tituloDeDia(fecha)}\n\nEscríbelo en formato 24 horas, por ejemplo 16:30`,
      '16:00'
    );
    if (!hora) return;
    if (!/^\d{1,2}:\d{2}$/.test(hora.trim())) {
      alert('El formato debe ser HH:mm, por ejemplo 16:30');
      return;
    }
    const normalizada = hora.trim().padStart(5, '0');

    setGuardandoCita(true);
    try {
      const res = await fetch(`${API_BASE}/agenda/cupo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: fecha, time: normalizada })
      });
      if (res.ok) await fetchAgenda();
      else alert((await res.json().catch(() => ({}))).error || 'No se pudo agregar el horario.');
    } finally {
      setGuardandoCita(false);
    }
  };

  const quitarHorario = async (cupo: AgendaSlot) => {
    if (!window.confirm(`¿Quitar el horario extra de ${cupo.label}?`)) return;
    setGuardandoCita(true);
    try {
      const res = await fetch(`${API_BASE}/agenda/cupo/${cupo.id}`, { method: 'DELETE' });
      if (res.ok) await fetchAgenda();
      else alert((await res.json().catch(() => ({}))).error || 'No se pudo quitar el horario.');
    } finally {
      setGuardandoCita(false);
    }
  };

  // Mueve la cita de un cliente a otro cupo, o la libera pasando destino = null.
  const moverCita = async (phone: string, destino: string | null) => {
    setGuardandoCita(true);
    try {
      const res = await fetch(`${API_BASE}/${phone}/appointment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: destino })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMoviendo(null);
        await Promise.all([fetchAgenda(), fetchLeads()]);
      } else {
        alert(data.error || 'No se pudo mover la cita.');
      }
    } catch (error) {
      console.error('Error moviendo la cita:', error);
      alert('No se pudo contactar al servidor.');
    } finally {
      setGuardandoCita(false);
    }
  };

  // Elimina una ficha completa. Pensado para limpiar los chats de prueba hechos con
  // números propios. Pide confirmación porque no hay vuelta atrás.
  const handleDeleteLead = async (lead: Lead) => {
    const mensajes = lead.conversation?.length || 0;
    const confirmado = window.confirm(
      `¿Eliminar definitivamente la ficha de +${lead.phone}?\n\n` +
      `Se borra el cliente, su estado, sus notas` +
      (mensajes > 0 ? ` y los ${mensajes} mensajes de su conversación` : '') +
      `.\n\nEsto NO se puede deshacer.`
    );
    if (!confirmado) return;

    setDeletingPhone(lead.phone);
    try {
      const res = await fetch(`${API_BASE}/${lead.phone}`, { method: 'DELETE' });
      if (res.ok) {
        setLeads(prev => prev.filter(l => l.phone !== lead.phone));
        if (chatLead?.phone === lead.phone) setChatLead(null);
        fetchRouteOptimization();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`No se pudo eliminar.\n\n${data.error || 'Error desconocido'}`);
      }
    } catch (error) {
      console.error('Error eliminando la ficha:', error);
      alert('No se pudo contactar al servidor para eliminar la ficha.');
    } finally {
      setDeletingPhone(null);
    }
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch =
      lead.phone.includes(searchQuery) || 
      (lead.address && lead.address.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (lead.technician && lead.technician.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'todos' || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const exportToCSV = () => {
    // Filter completed/installed leads
    const completedLeads = leads.filter(l => l.status === 'Instalado');
    
    if (completedLeads.length === 0) {
      alert('No hay servicios marcados como "Instalado" para exportar.');
      return;
    }

    const headers = ['Teléfono', 'Servicio', 'BTU / Detalle', 'Dirección', 'Fecha Cita', 'Técnico', 'Estado', 'Notas Técnicas', 'Fecha Registro'];
    const rows = completedLeads.map(lead => [
      `+${lead.phone}`,
      lead.service_type === 'installation' ? 'Instalación' : 'Mantenimiento',
      lead.service_type === 'installation' ? lead.calculated_btu : `Antigüedad: ${lead.installation_age || 'N/A'}`,
      lead.address || '',
      lead.appointment_time || '',
      lead.technician || 'No asignado',
      lead.status,
      lead.technical_notes || lead.notes || 'Sin notas',
      new Date(lead.created_at).toLocaleDateString()
    ]);

    // UTF-8 CSV with Semicolon separator for native Spanish Excel support
    const csvContent = [
      headers.join(';'),
      ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_contador_furtz_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateGoogleMapsRouteUrl = () => {
    if (optimizedRoute.length === 0) {
      alert(language === 'es' ? 'No hay rutas asignadas para navegar.' : 'No routes assigned to navigate.');
      return;
    }
    
    const validPoints = optimizedRoute.filter(stop => stop.latitude && stop.longitude);
    
    if (validPoints.length === 0) {
      alert(language === 'es' ? 'Ningún cliente en la ruta tiene geolocalización válida.' : 'No clients in the route have valid geolocation.');
      return;
    }

    if (validPoints.length === 1) {
      const dest = validPoints[0];
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}&travelmode=driving`, '_blank');
      return;
    }

    const origin = validPoints[0];
    const destination = validPoints[validPoints.length - 1];
    
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;
    
    if (validPoints.length > 2) {
      const waypoints = validPoints.slice(1, validPoints.length - 1)
        .map(pt => `${pt.latitude},${pt.longitude}`)
        .join('|');
      url += `&waypoints=${waypoints}`;
    }
    
    window.open(url, '_blank');
  };

  return (
    <div className="h-screen w-screen flex flex-row overflow-hidden bg-[#060b13] text-slate-100 font-sans relative">
      
      {/* Background ambient glowing blobs to fill empty spaces */}
      <div className="absolute top-[-100px] left-[-100px] w-[600px] h-[600px] rounded-full bg-cyan-500/5 blur-[160px] pointer-events-none -z-10 animate-pulse-subtle"></div>
      <div className="absolute bottom-[-100px] right-[-100px] w-[700px] h-[700px] rounded-full bg-purple-500/5 blur-[200px] pointer-events-none -z-10"></div>
      
      {/* Left Navigation Sidebar */}
      <aside className="w-64 h-full bg-[#060a13] border-r border-[#162035] flex flex-col justify-between p-4 shrink-0 z-10">
        <div className="flex flex-col gap-6">
          {/* Logo / Branding */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-pink-500/25">
              <Thermometer className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-wider font-outfit text-white">
                FURTZ CLIMA
              </h1>
              <p className="text-[9px] text-[#ec4899] uppercase tracking-widest font-extrabold">{t('subtitle', 'URGENCIA DE INSTALACIÓN')}</p>
            </div>
          </div>
          
          {/* Navigation Menu */}
          <nav className="flex flex-col gap-2">
            <button
              onClick={() => setCurrentSlide(0)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 border-2 ${
                currentSlide === 0 
                  ? 'border-white text-white bg-slate-900/30' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Sparkles className={`h-4.5 w-4.5 ${currentSlide === 0 ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>{t('nav_dashboard', 'Dashboard Principal')}</span>
            </button>

            <button
              onClick={() => setCurrentSlide(1)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 border-2 ${
                currentSlide === 1 
                  ? 'border-white text-white bg-slate-900/30' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Navigation className={`h-4.5 w-4.5 ${currentSlide === 1 ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>{t('nav_routes', 'Rutas y Logística')}</span>
            </button>

            <button
              onClick={() => setCurrentSlide(2)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 border-2 ${
                currentSlide === 2 
                  ? 'border-white text-white bg-slate-900/30' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Users className={`h-4.5 w-4.5 ${currentSlide === 2 ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>{t('nav_leads', 'Gestión de Leads')}</span>
            </button>

            <button
              onClick={() => setCurrentSlide(3)}
              className={`flex items-center justify-between w-full px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 border-2 ${
                currentSlide === 3 
                  ? 'border-white text-white bg-slate-900/30' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <Wrench className={`h-4.5 w-4.5 ${currentSlide === 3 ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{t('nav_terrain', 'Módulo de Terreno')}</span>
              </div>
              {techLeads.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/30 text-amber-200 border border-amber-500/40 font-extrabold animate-pulse">
                  {techLeads.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setCurrentSlide(4)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 border-2 ${
                currentSlide === 4 
                  ? 'border-white text-white bg-slate-900/30' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Zap className={`h-4.5 w-4.5 ${currentSlide === 4 ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>{t('nav_ai_control', 'Centro de Control de IA')}</span>
            </button>

            <button
              onClick={() => setCurrentSlide(5)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 border-2 ${
                currentSlide === 5 
                  ? 'border-white text-white bg-slate-900/30' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <TrendingUp className={`h-4.5 w-4.5 ${currentSlide === 5 ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>{t('nav_finances', 'Finanzas y Auditoría')}</span>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer Progress */}
        <div className="flex flex-col gap-2 p-2 border-t border-[#162035] pt-4">
          <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('project_progress', 'PROYECTO GENERAL')}</div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-semibold">{t('project_status', 'Estado')}</span>
            <span className="text-[#10b981] font-extrabold">{overallProgress}% {t('project_advance', 'Avance')}</span>
          </div>
          <div className="w-full bg-[#162035] rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-[#10b981] h-1.5 rounded-full transition-all duration-500" 
              style={{ width: `${overallProgress}%` }}
            ></div>
          </div>
        </div>
      </aside>

      {/* Right Content Panel */}
      <div className="flex-1 h-full flex flex-col overflow-hidden">
        
        {/* Top Header Bar */}
        <header className="flex justify-between items-center border-b border-[#162035] bg-[#0c1220]/40 px-6 py-4 backdrop-blur-md shrink-0">
          <h2 className="text-xl font-extrabold tracking-tight text-white font-outfit">
            {currentSlide === 0 && t('title_dashboard', 'Dashboard Principal')}
            {currentSlide === 1 && t('title_routes', 'Rutas y Logística')}
            {currentSlide === 2 && t('title_leads', 'Gestión de Leads')}
            {currentSlide === 3 && t('title_terrain', 'Módulo de Terreno')}
            {currentSlide === 4 && t('title_ai_control', 'Centro de Control de IA')}
            {currentSlide === 5 && t('title_finances', 'Finanzas y Auditoría')}
          </h2>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowGuideModal(true)}
              className="flex items-center gap-2 bg-slate-900/80 border border-blue-500/40 hover:bg-blue-500/20 hover:border-blue-400 transition px-3.5 py-1.5 rounded-xl text-xs font-bold text-blue-300 active:scale-95 glow-blue"
              title={language === 'es' ? "Guía rápida del sistema" : "System Quick Guide"}
            >
              <Info className="h-4 w-4" />
              {t('btn_guide', 'Guía de Uso')}
            </button>
            <button 
              onClick={() => setLanguage(prev => prev === 'es' ? 'en' : 'es')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-cyan-500/40 hover:bg-cyan-500/20 hover:border-cyan-300 transition text-cyan-300 text-xs font-bold active:scale-95 glow-cyan"
              title={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
            >
              <span>🌐</span>
              <span>{language === 'es' ? 'EN' : 'ES'}</span>
            </button>
            <button 
              onClick={exportToCSV}
              className="flex items-center gap-2 bg-slate-900/80 border border-cyan-500/40 hover:bg-cyan-500/20 hover:border-cyan-400 transition px-3.5 py-1.5 rounded-xl text-xs font-bold text-cyan-300 active:scale-95 glow-cyan"
              title={language === 'es' ? "Descargar archivo CSV directamente" : "Download CSV file directly"}
            >
              {t('btn_export_csv', 'Exportar CSV')}
            </button>
            <button 
              onClick={() => {
                setShowEmailModal(true);
                setEmailStatus({ type: null, message: '' });
              }}
              className="flex items-center gap-2 btn-premium-emerald transition px-4 py-1.5 rounded-xl text-xs font-bold text-white active:scale-95 shadow-lg"
            >
              <Mail className="h-4 w-4" />
              {t('btn_send_accountant', 'Enviar a Contador')}
            </button>
            <button 
              onClick={fetchLeads} 
              disabled={refreshing}
              className="flex items-center justify-center h-8 w-8 rounded-xl bg-white/5 border border-purple-500/40 hover:bg-purple-500/20 transition text-purple-300 active:scale-95"
              title={t('btn_sync', 'Sincronizar Datos')}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {/* Scrollable Slide Content Area */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          
          {/* Warning Banner at top (displayed if there are unassigned pending leads) */}
          {unassignedPendingCount > 0 && (currentSlide === 0 || currentSlide === 2) && (
            <div className="border border-amber-500/30 bg-amber-950/20 rounded-xl p-4 flex gap-4 items-start shadow-[0_0_15px_rgba(245,158,11,0.05)] text-left shrink-0">
              <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-bold text-amber-500 flex items-center gap-1.5 animate-pulse">
                  {t('warn_critical', 'Atención: Asignaciones Pendientes Críticas')}
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed font-medium">
                  {t('warn_pending_leads', `Hay {count} visitas registradas en estado de urgencia/pendiente que aún no tienen asignado un técnico en terreno. Asigna técnicos en el módulo de Gestión de Leads para iniciar sus rutas y el protocolo técnico.`).replace('{count}', String(unassignedPendingCount))}
                </p>
              </div>
            </div>
          )}

          {/* Slide 0: Dashboard Principal */}
          {currentSlide === 0 && (
            <div className="flex flex-col gap-6 animate-fade-in w-full text-left">
              
              {/* Top Row: 4 KPI Cards with Top Color Borders */}
              <div className="kpi-grid">
                <div className="glass-panel p-4 card-top-blue flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(59,130,246,0.08)]">
                  <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_total_leads', 'LEADS TOTALES')}</div>
                  <div className="text-2xl font-extrabold text-white">{totalLeads}</div>
                  <div className="text-[10px] text-blue-300 font-medium">{t('kpi_total_leads_desc', 'Registrados en sistema')}</div>
                </div>

                <div className="glass-panel p-4 card-top-cyan flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(6,182,212,0.08)]">
                  <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_installations', 'INSTALACIONES')}</div>
                  <div className="text-2xl font-extrabold text-white">{installationCount}</div>
                  <div className="text-[10px] text-cyan-300 font-medium">{t('kpi_installations_desc', 'Dimensionamientos activos')}</div>
                </div>

                <div className="glass-panel p-4 card-top-amber flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(245,158,11,0.08)]">
                  <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_maintenance', 'MANTENIMIENTOS')}</div>
                  <div className="text-2xl font-extrabold text-white">{maintenanceCount}</div>
                  <div className="text-[10px] text-amber-300 font-medium">{t('kpi_maintenance_desc', 'Visitas de mantenimiento')}</div>
                </div>

                <div className="glass-panel p-4 card-top-emerald flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(16,185,129,0.08)]">
                  <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_completed', 'SERVICIOS COMPLETADOS')}</div>
                  <div className="text-2xl font-extrabold text-white">{installedCount}</div>
                  <div className="text-[10px] text-emerald-300 font-medium">{t('kpi_completed_desc', 'Instalaciones finalizadas')}</div>
                </div>
              </div>

              {/* Middle Row: Percentages / KPI Dials */}
              <div className="dials-grid">
                <div className="glass-panel p-6 flex flex-col items-center justify-center text-center gap-4 border border-cyan-500/20 relative overflow-hidden glow-cyan">
                  <div className="absolute top-0 right-0 h-24 w-24 bg-cyan-500/10 rounded-full filter blur-xl"></div>
                  <div className="relative h-28 w-28 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="56" cy="56" r="48" stroke="rgba(255,255,255,0.1)" strokeWidth="8" fill="transparent" />
                      <circle cx="56" cy="56" r="48" stroke="url(#cyanGradient)" strokeWidth="8" fill="transparent" 
                        strokeDasharray="301.59" strokeDashoffset={301.59 - (301.59 * 0.98)} />
                    </svg>
                    <span className="absolute text-2xl font-extrabold text-cyan-300 font-outfit">98%</span>
                  </div>
                  <div>
                    <h3 className="text-white font-bold font-outfit text-base">{t('kpi_satisfaction', 'Satisfacción Cliente')}</h3>
                    <p className="text-xs text-cyan-100 font-medium mt-1">{t('kpi_satisfaction_desc', 'Visitas evaluadas con máxima puntuación')}</p>
                  </div>
                </div>

                <div className="glass-panel p-6 flex flex-col items-center justify-center text-center gap-4 border border-purple-500/20 relative overflow-hidden glow-purple">
                  <div className="absolute top-0 right-0 h-24 w-24 bg-purple-500/10 rounded-full filter blur-xl"></div>
                  <div className="relative h-28 w-28 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="56" cy="56" r="48" stroke="rgba(255,255,255,0.1)" strokeWidth="8" fill="transparent" />
                      <circle cx="56" cy="56" r="48" stroke="url(#purpleGradient)" strokeWidth="8" fill="transparent" 
                        strokeDasharray="301.59" strokeDashoffset={301.59 - (301.59 * 0.85)} />
                    </svg>
                    <span className="absolute text-2xl font-extrabold text-purple-300 font-outfit">85%</span>
                  </div>
                  <div>
                    <h3 className="text-white font-bold font-outfit text-base">{t('kpi_assignment', 'Asignación Técnica')}</h3>
                    <p className="text-xs text-purple-100 font-medium mt-1">{t('kpi_assignment_desc', 'Disponibilidad de instaladores en ruta')}</p>
                  </div>
                </div>

                <div className="glass-panel p-6 flex flex-col items-center justify-center text-center gap-4 border border-emerald-500/20 relative overflow-hidden glow-emerald">
                  <div className="absolute top-0 right-0 h-24 w-24 bg-emerald-500/10 rounded-full filter blur-xl"></div>
                  <div className="relative h-28 w-28 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="56" cy="56" r="48" stroke="rgba(255,255,255,0.1)" strokeWidth="8" fill="transparent" />
                      <circle cx="56" cy="56" r="48" stroke="url(#emeraldGradient)" strokeWidth="8" fill="transparent" 
                        strokeDasharray="301.59" strokeDashoffset={301.59 - (301.59 * 0.92)} />
                    </svg>
                    <span className="absolute text-2xl font-extrabold text-emerald-300 font-outfit">92%</span>
                  </div>
                  <div>
                    <h3 className="text-white font-bold font-outfit text-base">{t('kpi_efficiency', 'Eficiencia de BTU')}</h3>
                    <p className="text-xs text-emerald-100 font-medium mt-1">{t('kpi_efficiency_desc', 'Precisión de dimensionamiento sugerido')}</p>
                  </div>
                </div>
              </div>

              {/* Lower Section: 2-Column Split */}
              <div className="layout-grid items-stretch">
                
                {/* Left Side: Avance de Fases Operativas */}
                <div className="glass-panel p-6 col-span-7 flex flex-col gap-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-base font-extrabold text-white font-outfit">{t('kpi_progress_title', 'Avance de Servicios Realizados')}</h3>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{t('kpi_progress_desc', 'Métricas en Vivo (Leads)')}</span>
                  </div>

                  <div className="flex flex-col gap-5">
                    {/* Fase 1: Instalaciones Completadas */}
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-white">{t('lbl_completed_services', 'Servicios Completados (Instalado)')}</span>
                        <span className="text-[#10b981] font-bold">{installedCount} Leads</span>
                      </div>
                      <div className="progress-bar-container">
                        <div 
                          className="progress-bar-fill-installed"
                          style={{ width: `${overallProgress}%` }}
                        ></div>
                        <span className="progress-bar-text">{t('lbl_installed', 'INSTALADO')} - {overallProgress}%</span>
                      </div>
                    </div>

                    {/* Fase 2: Servicios Pendientes y Evaluados */}
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-white">{t('lbl_active_planning', 'Planificación Activa (Pendientes / Evaluados)')}</span>
                        <span className="text-blue-300 font-bold">{pendingVisits + evaluatedCount} Leads</span>
                      </div>
                      <div className="progress-bar-container">
                        <div 
                          className="progress-bar-fill-planned" 
                          style={{ width: `${100 - overallProgress}%` }}
                        ></div>
                        <span className="progress-bar-text">
                          {t('lbl_planned', 'PLANIFICADO')} - {100 - overallProgress}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Informational phase details */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[#162035] pt-4 text-[11px] leading-relaxed text-slate-400">
                    <div className="flex gap-2.5">
                      <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
                      <p>{t('desc_installation_phase', 'Fase de instalación incluye dimensionamiento y montaje de equipos Split Muro y Ductos de Ventilación.')}</p>
                    </div>
                    <div className="flex gap-2.5">
                      <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
                      <p>{t('desc_certification_phase', 'Fase de certificación añade pruebas de vacío, presurización de nitrógeno y protocolos de calidad Minsal.')}</p>
                    </div>
                  </div>
                </div>

                {/* Right Side: Semáforo de Estado Operativo */}
                <div className="glass-panel p-6 col-span-5 flex flex-col gap-5">
                  <h3 className="text-base font-extrabold text-white font-outfit">{t('kpi_traffic_light', 'Semáforo de Estado Operativo')}</h3>
                  
                  <div className="timeline-container">
                    {/* Vertical line indicator */}
                    <div className="timeline-line"></div>

                    {/* Step 1 */}
                    <div className="timeline-step">
                      <div className="timeline-icon-verified">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div className="flex-1 flex flex-col gap-0.5">
                        <h4 className="text-xs font-extrabold text-white">{t('kpi_lead_capture', 'Captura de Leads')}</h4>
                        <p className="text-[11px] text-slate-400">{t('kpi_lead_capture_desc', 'Prospectos registrados y direcciones georreferenciadas.')}</p>
                        <span className="text-[9px] text-emerald-400 font-bold tracking-wider mt-0.5">{t('status_verified', 'VERIFICADO')}</span>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="timeline-step">
                      <div className={unassignedPendingCount > 0 ? 'timeline-icon-in-progress' : 'timeline-icon-verified'}>
                        {unassignedPendingCount > 0 ? <Zap className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 flex flex-col gap-0.5">
                        <h4 className="text-xs font-extrabold text-white">{t('kpi_route_assign', 'Ruta y Asignación')}</h4>
                        <p className="text-[11px] text-slate-400">{t('kpi_route_assign_desc', 'Visitas agendadas y técnicos asignados en ruta.')}</p>
                        <span className={`text-[9px] font-bold tracking-wider mt-0.5 ${
                          unassignedPendingCount > 0 ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                          {unassignedPendingCount > 0 ? t('status_in_progress', 'EN PROCESO') : t('status_completed', 'COMPLETADO')}
                        </span>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="timeline-step">
                      <div className={installedCount > 0 ? 'timeline-icon-verified' : 'timeline-icon-blocked'}>
                        {installedCount > 0 ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 flex flex-col gap-0.5">
                        <h4 className={`text-xs font-extrabold ${installedCount > 0 ? 'text-white' : 'text-slate-500'}`}>{t('kpi_quality_protocol', 'Protocolos de Calidad')}</h4>
                        <p className="text-[11px] text-slate-500">{t('kpi_quality_protocol_desc', 'Pruebas de vacío, drenaje y aprobación final.')}</p>
                        <span className={`text-[9px] font-bold tracking-wider mt-0.5 ${installedCount > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {installedCount > 0 ? t('status_active', 'ACTIVO') : t('status_blocked', 'BLOQUEADO')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

            </div>
          )}

        {/* Slide 2: Optimización de Rutas (Mapa y Logística) */}
        {currentSlide === 1 && (
          <div className="flex flex-col gap-6 animate-fade-in w-full">
            <div className="text-center md:text-left mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {t('slide_2_badge', 'DIAPOSITIVA 2: LOGÍSTICA DE ATENCIÓN')}
              </span>
              <h2 className="text-4xl font-extrabold tracking-tight text-white font-outfit mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-300">
                {t('title_routes', 'Planificación de Ruta Técnica')}
              </h2>
              <p className="text-slate-200 text-sm mt-1 font-medium">{t('desc_routes', 'Secuencia geográfica inteligente de visitas optimizadas por vecindad')}</p>
            </div>

            <div className="layout-grid-2 items-stretch">
              <div className="glass-panel p-6 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <Navigation className="h-5 w-5 text-cyan-400" />
                    {t('lbl_ordered_route_points', 'Puntos de Ruta Ordenados')}
                  </h3>
                  <button 
                    onClick={generateGoogleMapsRouteUrl}
                    disabled={optimizedRoute.length === 0}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-[0_0_15px_rgba(16,185,129,0.3)] active:scale-95"
                  >
                    <MapPin className="h-4 w-4" />
                    {language === 'es' ? 'Abrir Ruta en Maps' : 'Open Route in Maps'}
                  </button>
                </div>
                
                {optimizedRoute.length === 0 ? (
                  <div className="text-slate-400 text-center py-12 text-sm">{t('lbl_no_geolocations', 'Sin geolocalizaciones registradas.')}</div>
                ) : (
                  <div className="routes-list-container">
                    {/* Visual dashed connector line between stops */}
                    <div className="routes-connector-line"></div>
                    {optimizedRoute.map((stop, index) => {
                      const status = stop.status || 'Pendiente';
                      const borderClass = 
                        status === 'Instalado' ? 'border-status-instalado' :
                        status === 'Evaluado' ? 'border-status-evaluado' :
                        status === 'Cancelado' ? 'border-status-cancelado' :
                        status === 'pendiente_revision' ? 'border-status-pendiente_revision' :
                        status === 'derivado_ventas' ? 'border-status-derivado_ventas' :
                        'border-status-pendiente';
                      const shadowClass = 
                        status === 'Instalado' ? 'hover:shadow-[0_0_12px_rgba(16,185,129,0.15)]' :
                        status === 'Evaluado' ? 'hover:shadow-[0_0_12px_rgba(59,130,246,0.15)]' :
                        status === 'Cancelado' ? 'hover:shadow-[0_0_12px_rgba(239,68,68,0.15)]' :
                        status === 'pendiente_revision' ? 'hover:shadow-[0_0_12px_rgba(245,158,11,0.15)]' :
                        status === 'derivado_ventas' ? 'hover:shadow-[0_0_12px_rgba(99,102,241,0.15)]' :
                        'hover:shadow-[0_0_12px_rgba(245,158,11,0.15)]';
                      return (
                        <div key={stop.id} className={`route-stop-card ${borderClass} ${shadowClass}`}>
                          <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-cyan-400 to-purple-500 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-md">
                            {index + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-extrabold text-white flex items-center gap-1.5">
                              <Phone className="h-3 w-3 text-cyan-400" />
                              +{stop.phone}
                            </div>
                            <div className="text-[11px] text-slate-200 font-medium truncate" title={stop.address}>{stop.address}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/10 border border-white/20 text-white">
                              {stop.service_type === 'installation' ? t('lbl_install_action', 'Instalar') : t('lbl_maintenance_action', 'Mantención')}
                            </span>
                            <span className={`text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded border ${
                              status === 'Instalado' ? 'bg-emerald-500/25 text-emerald-200 border-emerald-500/35' :
                              status === 'Evaluado' ? 'bg-blue-500/25 text-blue-200 border-blue-500/35' :
                              status === 'Cancelado' ? 'bg-red-500/25 text-red-200 border-red-500/35' :
                              status === 'pendiente_revision' ? 'bg-amber-500/25 text-amber-200 border-amber-500/35' :
                              status === 'derivado_ventas' ? 'bg-indigo-500/25 text-indigo-200 border-indigo-500/35' :
                              'bg-amber-500/25 text-amber-200 border-amber-500/35'
                            }`}>
                              {t('status_' + (status === 'Pendiente' ? 'pending' : status === 'Evaluado' ? 'evaluated' : status === 'Instalado' ? 'installed' : status === 'pendiente_revision' ? 'pendiente_revision' : status === 'derivado_ventas' ? 'derivado_ventas' : 'cancelled'), status)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Map panel */}
              <div className="glass-panel p-4 border border-white/10 flex flex-col gap-3 min-h-[300px] glow-purple">
                <h3 className="text-white font-semibold flex items-center gap-2 px-2">
                  <MapPin className="h-5 w-5 text-purple-400" />
                  {t('lbl_dynamic_map', 'Mapa Dinámico de Clientes')}
                </h3>
                <div className="flex-1 rounded-xl overflow-hidden border border-white/10 relative">
                  <iframe
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    allowFullScreen
                    src={`https://www.google.com/maps/embed/v1/search?key=${import.meta.env.VITE_GOOGLE_MAPS_KEY || ''}&q=Niebla,Valdivia,Chile`}
                  ></iframe>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Slide 3: Gestión de Leads y Clientes */}
        {currentSlide === 2 && (
          <div className="flex flex-col gap-6 animate-fade-in w-full">
            <div className="text-center md:text-left mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {t('slide_3_badge', 'DIAPOSITIVA 3: OPERACIONES')}
              </span>
              <h2 className="text-4xl font-extrabold tracking-tight text-white font-outfit mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-300">
                {t('title_leads', 'Control Operativo de Clientes')}
              </h2>
              <p className="text-slate-200 text-sm mt-1 font-medium">{t('desc_leads', 'Gestión directa de visitas técnicas, asignación y estado de servicios')}</p>
            </div>

            {/* ------------------------- Agenda semanal ------------------------- */}
            <div className="glass-panel p-6 flex flex-col gap-4">
              <div className="agenda-toolbar">
                <button onClick={() => setAgendaAbierta(a => !a)} className="agenda-toggle">
                  <span className={`agenda-flecha ${agendaAbierta ? 'abierta' : ''}`}>▶</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Calendar className="h-5 w-5" style={{ color: '#22d3ee' }} />
                      {t('title_agenda', 'Agenda')}
                      {agenda && (
                        <span className="agenda-chip">
                          {agenda.cupos.filter(c => c.ocupado).length} {t('lbl_booked', 'con cita')}
                        </span>
                      )}
                    </h3>
                    <p className="modal-sub">
                      {t('desc_agenda', 'Lunes a viernes · 09:15 y 14:00 · el bot solo ofrece los cupos libres')}
                    </p>
                  </div>
                </button>

                <div style={{ display: agendaAbierta ? 'flex' : 'none', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setSemana(s => Math.max(0, s - 1))}
                    disabled={semana === 0}
                    className="agenda-btn"
                    style={{ width: 'auto', padding: '6px 12px', fontSize: 11 }}
                  >
                    ← {t('lbl_prev_week', 'Anterior')}
                  </button>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, minWidth: 84, textAlign: 'center' }}>
                    {semana === 0 ? t('lbl_this_week', 'Esta semana') : `+${semana} ${t('lbl_weeks', 'sem')}`}
                  </span>
                  <button
                    onClick={() => setSemana(s => Math.min(5, s + 1))}
                    disabled={semana >= 5}
                    className="agenda-btn"
                    style={{ width: 'auto', padding: '6px 12px', fontSize: 11 }}
                  >
                    {t('lbl_next_week', 'Siguiente')} →
                  </button>
                </div>
              </div>

              {moviendo && agendaAbierta && (
                <div className="agenda-aviso agenda-toolbar" style={{ color: '#fde68a' }}>
                  <span style={{ fontWeight: 600 }}>
                    {t('lbl_moving', 'Moviendo la cita de')} +{moviendo.lead?.phone} — {t('lbl_pick_slot', 'elige el cupo libre de destino')}
                  </span>
                  <button onClick={() => setMoviendo(null)} className="agenda-btn" style={{ width: 'auto', padding: '4px 10px' }}>
                    {t('lbl_cancel', 'Cancelar')}
                  </button>
                </div>
              )}

              {!agendaAbierta ? null : !agenda ? (
                <div className="text-center text-slate-400 text-sm py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  {t('lbl_loading_agenda', 'Cargando la agenda...')}
                </div>
              ) : (
                (() => {
                  const fechas = [...new Set(agenda.cupos.map(c => c.date))];
                  const semanaActual = fechas.slice(semana * 5, semana * 5 + 5);

                  if (semanaActual.length === 0) {
                    return (
                      <div className="text-center text-slate-400 text-sm py-8 italic">
                        {t('lbl_no_slots', 'No hay más cupos en este rango.')}
                      </div>
                    );
                  }

                  return (
                    <div className="agenda-scroll">
                      <div className="agenda-grid">
                        {semanaActual.map(fecha => (
                          <div key={fecha} className="agenda-col">
                            <div className={`agenda-dia ${fecha === agenda.hoy ? 'hoy' : ''}`}>
                              {tituloDeDia(fecha)}
                              {fecha === agenda.hoy && <small>{t('lbl_today', 'HOY')}</small>}
                            </div>

                            {agenda.cupos.filter(c => c.date === fecha).map(cupo => (
                              cupo.ocupado && cupo.lead ? (
                                <div key={cupo.id} className="agenda-cupo ocupado">
                                  <div className="agenda-hora">{cupo.time}</div>
                                  <div className="agenda-dato" title={`+${cupo.lead.phone}`}>+{cupo.lead.phone}</div>
                                  <div className="agenda-nota">
                                    {cupo.lead.service_type === 'installation' ? 'Instalación' : 'Mantención'}
                                    {cupo.lead.technician ? ` · ${cupo.lead.technician}` : ''}
                                  </div>
                                  <div className="agenda-acciones">
                                    <button
                                      onClick={() => setMoviendo(cupo)}
                                      disabled={guardandoCita}
                                      className="agenda-btn"
                                    >
                                      {t('lbl_move', 'Mover')}
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (window.confirm(`¿Liberar el cupo de +${cupo.lead!.phone} (${cupo.label})?\n\nEl cliente queda sin cita agendada.`)) {
                                          moverCita(cupo.lead!.phone, null);
                                        }
                                      }}
                                      disabled={guardandoCita}
                                      className="agenda-btn peligro"
                                    >
                                      {t('lbl_free', 'Liberar')}
                                    </button>
                                  </div>
                                </div>
                              ) : cupo.reservado ? (
                                <div key={cupo.id} className="agenda-cupo reservado">
                                  <div className="agenda-hora">
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <Lock className="h-3 w-3" /> {cupo.time}
                                    </span>
                                  </div>
                                  <div className="agenda-nota" title={cupo.motivoReserva || ''}>
                                    {cupo.motivoReserva || t('lbl_reserved', 'Reservado')}
                                  </div>
                                  <button
                                    onClick={() => soltarReserva(cupo)}
                                    disabled={guardandoCita}
                                    className="agenda-btn"
                                  >
                                    {t('lbl_release', 'Soltar')}
                                  </button>
                                </div>
                              ) : (
                                <div
                                  key={cupo.id}
                                  className={`agenda-cupo ${moviendo ? 'destino' : cupo.esExtra ? 'extra' : 'libre'}`}
                                >
                                  <div className="agenda-hora">
                                    <span>{cupo.time}{cupo.esExtra && ' +'}</span>
                                    {cupo.esExtra && !moviendo && (
                                      <button
                                        onClick={() => quitarHorario(cupo)}
                                        disabled={guardandoCita}
                                        className="agenda-quitar"
                                        title={t('tip_remove_slot', 'Quitar este horario extra')}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>

                                  {moviendo ? (
                                    <button
                                      onClick={() => moverCita(moviendo.lead!.phone, cupo.id)}
                                      disabled={guardandoCita}
                                      className="agenda-btn destino"
                                    >
                                      {t('lbl_put_here', 'Poner aquí')}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => reservarCupo(cupo)}
                                      disabled={guardandoCita}
                                      className="agenda-btn suave"
                                    >
                                      {t('lbl_reserve', 'Reservar')}
                                    </button>
                                  )}
                                </div>
                              )
                            ))}

                            <button
                              onClick={() => agregarHorario(fecha)}
                              disabled={guardandoCita}
                              className="agenda-btn agregar"
                              title={t('tip_add_slot', 'Agregar un horario extra a este día')}
                            >
                              + {t('lbl_add_slot', 'horario')}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              )}

              {agendaAbierta && agenda && agenda.fueraDeAgenda.length > 0 && (
                <div className="text-[11px] text-amber-300/90 bg-amber-500/8 border border-amber-500/20 rounded-lg p-2.5">
                  ⚠️ {agenda.fueraDeAgenda.length} {t('warn_out_of_range', 'cita(s) fuera del rango mostrado')}:{' '}
                  {agenda.fueraDeAgenda.map(c => `+${c.phone} (${c.id.replace('T', ' ')})`).join(' · ')}
                </div>
              )}
            </div>

            <div className="glass-panel p-6 flex flex-col gap-6">
              <div className="search-filter-container">
                {/* Search & Filter */}
                <div className="flex flex-wrap items-center gap-3 w-full justify-between">
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder={t('ph_search_client', 'Buscar cliente...')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-2 w-full bg-white/5 border border-white/10 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-cyan-400/50"
                    />
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-cyan-400/50"
                    >
                      <option value="todos">{t('opt_all_statuses', 'Todos los estados')}</option>
                      <option value="Pendiente">{t('status_pending', 'Pendiente')}</option>
                      <option value="Evaluado">{t('status_evaluated', 'Evaluado')}</option>
                      <option value="Instalado">{t('status_installed', 'Instalado')}</option>
                      <option value="Cancelado">{t('status_cancelled', 'Cancelado')}</option>
                      <option value="pendiente_revision">{t('status_pendiente_revision', 'Pendiente de Revisión')}</option>
                      <option value="derivado_ventas">{t('status_derivado_ventas', 'Derivado a Ventas')}</option>
                    </select>

                    <button
                      onClick={sendPreventiveCampaign}
                      disabled={sendingCampaign}
                      className="btn-premium-purple px-4 py-2 rounded-lg text-sm font-bold text-white flex items-center gap-2 cursor-pointer transition active:scale-95 shrink-0"
                    >
                      {sendingCampaign ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('btn_campaign_sending', 'Enviando...')}
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          {t('btn_send_preventive_campaign', 'Campaña Preventiva')}
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setShowAddClientModal(true)}
                      className="btn-premium-cyan px-4 py-2 rounded-lg text-sm font-bold text-white flex items-center gap-2 cursor-pointer transition active:scale-95 shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                      {t('btn_add_client', 'Registrar Cliente')}
                    </button>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="text-center py-12 text-slate-400">{t('lbl_loading_data', 'Cargando datos...')}</div>
              ) : filteredLeads.length === 0 ? (
                <div className="text-center py-12 text-slate-400">{t('lbl_no_clients_found', 'No se encontraron clientes registrados.')}</div>
              ) : (
                <div className="leads-table-container">
                  <table className="leads-table">
                    <thead>
                      <tr className="border-b border-white/20 text-cyan-300 text-xs font-bold uppercase tracking-wider bg-slate-950/60 shadow-[0_2px_5px_rgba(0,0,0,0.3)]">
                        <th className="p-3 pl-4 rounded-l-lg">{t('th_client', 'Cliente')}</th>
                        <th className="p-3">{t('th_service', 'Servicio')}</th>
                        <th className="p-3">{t('th_detail', 'Detalle')}</th>
                        <th className="p-3">{t('th_address', 'Dirección / Cita')}</th>
                        <th className="p-3">{t('th_assignment', 'Asignación')}</th>
                        <th className="p-3 text-right pr-4 rounded-r-lg">{t('th_status', 'Estado')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map((lead) => (
                        <tr key={lead.id} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-all">
                          <td className="py-4 pl-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-6 rounded-full shrink-0 ${
                                lead.status === 'Instalado' ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 
                                lead.status === 'Evaluado' ? 'bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.8)]' : 
                                lead.status === 'Cancelado' ? 'bg-red-400 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 
                                lead.status === 'pendiente_revision' ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]' :
                                lead.status === 'derivado_ventas' ? 'bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.8)]' :
                                'bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.8)]'
                              }`}></div>
                              <span className="text-white font-bold text-sm">{lead.client_name ? `${lead.client_name} (+${lead.phone})` : `+${lead.phone}`}</span>
                            </div>
                          </td>
                          <td className="py-4 px-2">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              lead.service_type === 'installation' 
                                ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40' 
                                : 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40'
                            }`}>
                              {lead.service_type === 'installation' ? t('lbl_installation', 'Instalación') : t('lbl_maintenance', 'Mantenimiento')}
                            </span>
                          </td>
                          <td className="py-4 px-2 text-slate-100 text-sm font-semibold">
                            {lead.service_type === 'installation' ? (
                              <div>
                                <span className="font-bold text-cyan-200">{lead.calculated_btu}</span>
                                <span className="text-xs text-slate-300 ml-1">({lead.area_m2} m²)</span>
                              </div>
                            ) : (
                              <div className="text-xs text-slate-200">{t('lbl_age', 'Antigüedad:')} {lead.installation_age || 'N/A'}</div>
                            )}
                          </td>
                          <td className="py-4 px-2 max-w-[200px]">
                            {lead.address ? (
                              <a 
                                href={lead.latitude && lead.longitude 
                                  ? `https://www.google.com/maps/search/?api=1&query=${lead.latitude},${lead.longitude}`
                                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-cyan-300 hover:text-cyan-100 text-sm font-bold truncate block hover:underline"
                                title={t('tip_view_maps', 'Ver en Google Maps')}
                              >
                                {lead.address}
                              </a>
                            ) : (
                              <div className="text-slate-400 text-sm italic">{t('lbl_no_address', 'Sin dirección')}</div>
                            )}
                            <div className="text-xs text-slate-200 flex items-center gap-1.5 mt-1 font-medium">
                              <Calendar className="h-3.5 w-3.5 text-cyan-400/90" />
                              {lead.appointment_time || t('lbl_to_define', 'Por definir')}
                            </div>
                            {lead.notes && (
                              <div className="mt-2 text-[11px] text-slate-300 bg-[#0c1322] border border-cyan-500/15 rounded-lg p-2 max-w-[220px] leading-relaxed font-medium">
                                <div className="flex items-center gap-1 text-[10px] font-bold text-cyan-400 mb-0.5">
                                  <Sparkles className="h-3 w-3 shrink-0 animate-pulse" />
                                  <span>{t('lbl_gemini_ai', 'IA Gemini:')}</span>
                                </div>
                                <div className="line-clamp-4 overflow-hidden text-ellipsis whitespace-pre-line text-[10px]" title={lead.notes}>
                                  {lead.notes}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="py-4 px-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder={t('ph_technician', 'Técnico')}
                                value={lead.technician || ''}
                                onChange={(e) => handleTechnicianChange(lead.phone, e.target.value)}
                                className="tech-input-field"
                              />
                              {lead.technician && TECHNICIAN_PHONES[lead.technician.toLowerCase().trim()] && (
                                <a
                                  href={`https://wa.me/${
                                    TECHNICIAN_PHONES[lead.technician.toLowerCase().trim()]
                                  }?text=${encodeURIComponent(
                                    `Hola ${lead.technician}, se te ha asignado una nueva visita técnica en Furtz Clima OS:\n\n` +
                                    `📞 Cliente: +${lead.phone}\n` +
                                    `🔧 Servicio: ${lead.service_type === 'installation' ? 'Instalación' : 'Mantenimiento'}\n` +
                                    `📍 Dirección: ${lead.address || 'No especificada'}\n` +
                                    `📅 Fecha Cita: ${lead.appointment_time || 'Por definir'}\n` +
                                    `📐 Capacidad/Detalle: ${lead.calculated_btu || 'N/A'}\n` +
                                    `📝 Notas: ${lead.notes || 'Sin notas'}\n\n` +
                                    `Por favor ingresa al panel móvil de Furtz Clima OS para completar el protocolo.`
                                  )}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-center h-8 w-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition active:scale-95 shrink-0"
                                  title={t('tip_send_whatsapp', 'Enviar WhatsApp al Técnico')}
                                >
                                  <Phone className="h-4 w-4" />
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="py-4 pr-4 text-right">
                            <div className="fila-acciones">
                              <select
                                value={lead.status || 'Pendiente'}
                                onChange={(e) => handleStatusChange(lead.phone, e.target.value)}
                                className={`status-dropdown status-select-${(lead.status || 'Pendiente').toLowerCase()}`}
                              >
                                <option value="Pendiente">{t('status_pending', 'Pendiente')}</option>
                                <option value="Evaluado">{t('status_evaluated', 'Evaluado')}</option>
                                <option value="Instalado">{t('status_installed', 'Instalado')}</option>
                                <option value="Cancelado">{t('status_cancelled', 'Cancelado')}</option>
                                <option value="pendiente_revision">{t('status_pendiente_revision', 'Pendiente de Revisión')}</option>
                                <option value="derivado_ventas">{t('status_derivado_ventas', 'Derivado a Ventas')}</option>
                                <option disabled>──────────</option>
                                <option value="__send_survey">⭐ {t('opt_send_survey', 'Enviar encuesta de satisfacción')}</option>
                              </select>

                              <div className="fila-iconos">
                                <button
                                  onClick={() => setChatLead(lead)}
                                  className="icono-btn chat"
                                  title={t('tip_view_chat', 'Ver la conversación con el cliente')}
                                >
                                  <MessageSquare className="h-4 w-4" />
                                  {lead.conversation && lead.conversation.length > 0 && (
                                    <span className="icono-badge">{lead.conversation.length}</span>
                                  )}
                                </button>

                                <button
                                  onClick={() => handleSendSurvey(lead.phone)}
                                  disabled={sendingSurveyTo === lead.phone}
                                  className={`icono-btn encuesta ${lead.satisfaction_rating ? 'lista' : ''}`}
                                  title={t('tip_send_survey', 'Enviar al cliente la forma de pago y la encuesta')}
                                >
                                  {sendingSurveyTo === lead.phone
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Star className="h-4 w-4" />}
                                </button>

                                <button
                                  onClick={() => handleDeleteLead(lead)}
                                  disabled={deletingPhone === lead.phone}
                                  className="icono-btn borrar"
                                  title={t('tip_delete_lead', 'Eliminar esta ficha (chats de prueba)')}
                                >
                                  {deletingPhone === lead.phone
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Trash2 className="h-4 w-4" />}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Slide 4: Protocolo Técnico de Terreno */}
        {currentSlide === 3 && (
          <div className="flex flex-col gap-6 animate-fade-in w-full text-slate-100">
            <div className="text-center md:text-left mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {t('slide_4_badge', 'DIAPOSITIVA 4: PROTOCOLO TÉCNICO DE TERRENO')}
              </span>
              <h2 className="text-4xl font-extrabold tracking-tight text-white font-outfit mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-300">
                {t('title_terrain', 'Módulo Técnico Móvil')}
              </h2>
              <p className="text-slate-200 text-sm mt-1 font-medium">{t('desc_terrain', 'Lista de chequeo de calidad y registro de parámetros de instalación')}</p>
            </div>

            <div className="layout-grid-3 items-start">
              
              {/* Technician Selector & Pending List */}
              <div className="glass-panel p-5 border border-white/10 col-span-1-of-3 flex flex-col gap-4 glow-cyan">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">{t('lbl_field_technician', 'Técnico en Terreno')}</label>
                  <select
                    value={activeTech}
                    onChange={(e) => {
                      setActiveTech(e.target.value);
                      setSelectedLeadForTech(null);
                    }}
                    className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="">{t('opt_select_technician', 'Seleccionar Técnico...')}</option>
                    {Array.from(new Set(leads.map(l => l.technician).filter(Boolean))).map(tech => (
                      <option key={tech} value={tech}>{tech}</option>
                    ))}
                    <option value="Felipe">Felipe (Demo)</option>
                    <option value="Juan">Juan (Demo)</option>
                    <option value="Francisco">Francisco (Demo)</option>
                  </select>
                </div>

                <hr className="border-white/10" />

                <div>
                  <h4 className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">{t('lbl_assigned_visits', 'Visitas Asignadas')}</h4>
                  {!activeTech ? (
                    <div className="text-slate-500 text-xs text-center py-6">{t('lbl_select_technician_prompt', 'Por favor, selecciona un técnico.')}</div>
                  ) : techLeads.length === 0 ? (
                    <div className="text-slate-500 text-xs text-center py-6">{t('lbl_no_visits_assigned', 'No hay visitas activas asignadas a {tech}.').replace('{tech}', activeTech)}</div>
                  ) : (
                    <div className="flex flex-col gap-2.5 max-h-[250px] overflow-y-auto pr-1">
                      {techLeads.map(lead => {
                        const borderClass = 
                          lead.status === 'Evaluado' ? 'border-status-evaluado' :
                          lead.status === 'Cancelado' ? 'border-status-cancelado' :
                          'border-status-pendiente';
                        return (
                          <button
                            key={lead.id}
                            onClick={() => {
                              setSelectedLeadForTech(lead);
                              setChecklist({
                                vacuum: false,
                                pressure: false,
                                level: false,
                                isolation: false,
                                drain: false
                              });
                              setTechNotes('');
                              setSaveSuccess(false);
                            }}
                            className={`flex flex-col gap-1.5 p-3 rounded-xl border text-left transition w-full ${
                              selectedLeadForTech?.id === lead.id
                                ? 'bg-cyan-950/40 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.25)]'
                                : `${borderClass} bg-slate-950/80 border-white/10 hover:border-white/20`
                            }`}
                          >
                            <div className="flex justify-between items-center w-full">
                              <span className="text-xs font-extrabold text-white">{lead.client_name || `+${lead.phone}`}</span>
                              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-slate-100 shadow-sm">
                                {lead.service_type === 'installation' ? t('lbl_install_action', 'Instalar') : t('lbl_maintenance_action', 'Mantención')}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-200 font-medium truncate w-full">{lead.address || t('lbl_no_address', 'Sin dirección')}</div>
                            <div className="text-[9px] text-cyan-200 font-semibold flex items-center gap-1">
                              <Calendar className="h-2.5 w-2.5 text-cyan-400" /> {lead.appointment_time || t('lbl_to_define', 'Por definir')}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Checklist & Protocol Panel */}
              <div className="glass-panel p-6 border border-white/10 col-span-2-of-3 flex flex-col gap-4 min-h-[350px] relative glow-purple">
                {!selectedLeadForTech ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-slate-400 gap-3">
                    <div className="h-12 w-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-500">
                      <Wrench className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">{t('lbl_no_client_selected', 'Ningún Cliente Seleccionado')}</h4>
                      <p className="text-xs max-w-[280px] mt-1">{t('desc_no_client_selected', 'Selecciona una visita técnica en el panel izquierdo para iniciar el protocolo.')}</p>
                    </div>
                  </div>
                ) : saveSuccess ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-12 gap-4">
                    <div className="h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 animate-bounce">
                      <CheckCircle2 className="h-8 w-8" />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-white">{t('lbl_visit_completed_success', '¡Visita Completada con Éxito!')}</h4>
                      <p className="text-xs text-slate-400 mt-1 max-w-[320px]">
                        {t('desc_visit_completed_success', 'Los parámetros de instalación y notas técnicas han sido guardados. El cliente ahora está en estado "Instalado" y listo para facturación.')}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedLeadForTech(null);
                        setSaveSuccess(false);
                      }}
                      className="mt-2 text-xs font-semibold text-slate-400 hover:text-white transition"
                    >
                      {t('btn_accept', 'Aceptar')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-lg font-bold text-white font-outfit">{t('lbl_quality_protocol_title', 'Protocolo Técnico de Calidad')}</h3>
                        <p className="text-xs text-slate-400">{t('lbl_client', 'Cliente:')} +{selectedLeadForTech.phone} | {selectedLeadForTech.service_type === 'installation' ? t('lbl_new_installation', 'Instalación Nueva') : t('lbl_maintenance', 'Mantenimiento')}</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        {selectedLeadForTech.calculated_btu || t('lbl_maintenance', 'Mantenimiento')}
                      </span>
                    </div>

                    <hr className="border-white/10" />

                    {selectedLeadForTech.notes && (
                      <div className="bg-[#0c1322] border border-cyan-500/15 rounded-xl p-3 text-xs text-slate-300 text-left animate-fade-in">
                        <div className="flex items-center gap-1.5 font-bold mb-1 text-cyan-400">
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>{t('lbl_ai_diagnostic_notes', 'Diagnóstico y Notas de IA (Gemini):')}</span>
                        </div>
                        <p className="whitespace-pre-line leading-relaxed font-medium text-[11px]">
                          {selectedLeadForTech.notes}
                        </p>
                      </div>
                    )}

                    {selectedLeadForTech.technical_notes && (
                      <div className="bg-[#0c1322] border border-purple-500/15 rounded-xl p-3 text-xs text-slate-300 text-left animate-fade-in">
                        <div className="flex items-center gap-1.5 font-bold mb-1 text-purple-400">
                          <Wrench className="h-3.5 w-3.5" />
                          <span>{t('lbl_terrain_notes_title', 'Notas de Instalación en Terreno:')}</span>
                        </div>
                        <p className="whitespace-pre-line leading-relaxed font-medium text-[11px]">
                          {selectedLeadForTech.technical_notes}
                        </p>
                      </div>
                    )}

                    {/* Checklist Questions */}
                    <div className="flex flex-col gap-3">
                      <h4 className="text-xs text-purple-300 font-semibold uppercase tracking-wider">{t('lbl_verification_parameters', 'Parámetros de Verificación')}</h4>
                      
                      <div className="checkbox-grid">
                        <label className="checklist-item">
                          <input
                            type="checkbox"
                            checked={checklist.vacuum}
                            onChange={(e) => setChecklist(prev => ({ ...prev, vacuum: e.target.checked }))}
                            className="rounded border-cyan-500/40 text-cyan-500 focus:ring-0 focus:ring-offset-0 bg-slate-900/50 h-4 w-4 checked:bg-cyan-500 checked:border-cyan-400 cursor-pointer"
                          />
                          <span>{t('chk_vacuum', 'Vacío de cañerías (≥30 min)')}</span>
                        </label>

                        <label className="checklist-item">
                          <input
                            type="checkbox"
                            checked={checklist.pressure}
                            onChange={(e) => setChecklist(prev => ({ ...prev, pressure: e.target.checked }))}
                            className="rounded border-cyan-500/40 text-cyan-500 focus:ring-0 focus:ring-offset-0 bg-slate-900/50 h-4 w-4 checked:bg-cyan-500 checked:border-cyan-400 cursor-pointer"
                          />
                          <span>{t('chk_pressure', 'Presión de refrigerante estable')}</span>
                        </label>

                        <label className="checklist-item">
                          <input
                            type="checkbox"
                            checked={checklist.level}
                            onChange={(e) => setChecklist(prev => ({ ...prev, level: e.target.checked }))}
                            className="rounded border-cyan-500/40 text-cyan-500 focus:ring-0 focus:ring-offset-0 bg-slate-900/50 h-4 w-4 checked:bg-cyan-500 checked:border-cyan-400 cursor-pointer"
                          />
                          <span>{t('chk_level', 'Equipos interior/exterior nivelados')}</span>
                        </label>

                        <label className="checklist-item">
                          <input
                            type="checkbox"
                            checked={checklist.isolation}
                            onChange={(e) => setChecklist(prev => ({ ...prev, isolation: e.target.checked }))}
                            className="rounded border-cyan-500/40 text-cyan-500 focus:ring-0 focus:ring-offset-0 bg-slate-900/50 h-4 w-4 checked:bg-cyan-500 checked:border-cyan-400 cursor-pointer"
                          />
                          <span>{t('chk_isolation', 'Aislación térmica y encintado ok')}</span>
                        </label>

                        <label className="checklist-item checkbox-span-full">
                          <input
                            type="checkbox"
                            checked={checklist.drain}
                            onChange={(e) => setChecklist(prev => ({ ...prev, drain: e.target.checked }))}
                            className="rounded border-cyan-500/40 text-cyan-500 focus:ring-0 focus:ring-offset-0 bg-slate-900/50 h-4 w-4 checked:bg-cyan-500 checked:border-cyan-400 cursor-pointer"
                          />
                          <span>{t('chk_drain', 'Prueba de drenaje de condensado exitosa')}</span>
                        </label>
                      </div>
                    </div>

                    {/* Technical Notes / Serial numbers */}
                    <div className="flex flex-col gap-1.5 mt-2">
                      <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_terrain_notes_label', 'Notas Técnicas / Números de Serie')}</label>
                      <textarea
                        value={techNotes}
                        onChange={(e) => setTechNotes(e.target.value)}
                        placeholder={t('ph_terrain_notes', 'Ej: Instalado equipo Clark de 12.000 BTU. Nro Serie Unidad Exterior: CL-7728394-B. Todo funcionando ok.')}
                        rows={3}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/15 focus:shadow-[0_0_12px_rgba(168,85,247,0.15)]"
                      />
                    </div>

                    {/* Submit Visita Button */}
                    <button
                      onClick={saveTechnicalProtocol}
                      disabled={savingProtocol}
                      className="flex items-center justify-center gap-2 mt-2 btn-premium-cyan py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 active:scale-95 shadow-lg"
                    >
                      {savingProtocol ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('lbl_saving_protocol', 'Guardando protocolo técnico...')}
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          {t('lbl_save_protocol_btn', 'Registrar y Finalizar Visita')}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* Slide 5: Centro de Control de IA */}
        {currentSlide === 4 && (
          <div className="flex flex-col gap-6 animate-fade-in w-full text-slate-100 text-left">
            <div className="text-center md:text-left mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                {t('slide_4_ai_badge', 'XPRIZE: AI-NATIVE OPERATIONS')}
              </span>
              <h2 className="text-4xl font-extrabold tracking-tight text-white font-outfit mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-300">
                {t('title_ai_control', 'Centro de Control de IA')}
              </h2>
              <p className="text-slate-200 text-sm mt-1 font-medium">{t('desc_ai_control', 'Registro de ejecución de agentes en producción y telemetría de la API de Gemini')}</p>
            </div>

            {/* AI metrics cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="glass-panel p-4 card-top-blue flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(59,130,246,0.08)]">
                <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_ai_calls', 'Llamadas totales (Gemini)')}</div>
                <div className="text-2xl font-extrabold text-white">{aiMetrics.totalCalls}</div>
                <div className="text-[10px] text-blue-300 font-medium">{t('kpi_ai_calls_desc', 'Ejecutadas en producción')}</div>
              </div>

              <div className="glass-panel p-4 card-top-cyan flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(6,182,212,0.08)]">
                <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_ai_latency', 'Latencia Promedio')}</div>
                <div className="text-2xl font-extrabold text-white">{aiMetrics.avgLatencyMs} ms</div>
                <div className="text-[10px] text-cyan-300 font-medium">{t('kpi_ai_latency_desc', 'Tiempo de respuesta API')}</div>
              </div>

              <div className="glass-panel p-4 card-top-purple flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(168,85,247,0.08)]">
                <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_ai_tokens', 'Tokens Consumidos')}</div>
                <div className="text-2xl font-extrabold text-white">{aiMetrics.totalTokens.toLocaleString()}</div>
                <div className="text-[10px] text-purple-300 font-medium">{t('kpi_ai_tokens_desc', 'Prompt + Output tokens')}</div>
              </div>

              <div className="glass-panel p-4 card-top-emerald flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(16,185,129,0.08)]">
                <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_ai_success', 'Tasa de Éxito API')}</div>
                <div className="text-2xl font-extrabold text-white">{aiMetrics.successRate}%</div>
                <div className="text-[10px] text-emerald-300 font-medium">{t('kpi_ai_success_desc', 'Peticiones exitosas sin error')}</div>
              </div>
            </div>

            <div className="layout-grid items-stretch">
              
              {/* Agent execution logs terminal */}
              <div className="glass-panel p-6 col-span-8 flex flex-col gap-4 glow-cyan">
                <div className="flex justify-between items-center">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-cyan-400" />
                    {t('lbl_agent_logs', 'Registro de Ejecución del Agente (Agent Logs)')}
                  </h3>
                  <button 
                    onClick={resetAIMetrics}
                    className="text-[11px] font-bold text-red-400 hover:text-red-300 transition bg-red-950/20 border border-red-500/25 px-3 py-1 rounded-lg active:scale-95 cursor-pointer"
                  >
                    {t('btn_clear_console', 'Limpiar Consola')}
                  </button>
                </div>

                <div className="ai-terminal">
                  <div className="ai-terminal-header">
                    <span className="ai-col-time">{t('tbl_ai_timestamp', 'Marca de Tiempo')}</span>
                    <span className="ai-col-phone">{t('tbl_ai_phone', 'Teléfono')}</span>
                    <span className="ai-col-type">{t('tbl_ai_type', 'Tipo')}</span>
                    <span className="ai-col-message">{t('tbl_ai_message', 'Mensaje / Detalle de IA')}</span>
                  </div>
                  
                  {aiLogs.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-slate-500 italic py-12">
                      {t('lbl_no_ai_logs', 'Sin logs de ejecución registrados en esta sesión. Interactúa con el chat de simulación para generar logs.')}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                      {aiLogs.map((log: any, index: number) => {
                        const typeColor = 
                          log.type === 'error' ? 'text-red-400' :
                          log.type === 'image_analysis' ? 'text-purple-400' :
                          log.type === 'location_received' ? 'text-cyan-400' :
                          'text-emerald-400';
                        return (
                          <div key={index} className="ai-terminal-row">
                            <span className="ai-col-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                            <span className="ai-col-phone">+{log.phone}</span>
                            <span className={`ai-col-type font-bold shrink-0 uppercase text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 ${typeColor}`}>
                              {log.type}
                            </span>
                            <span className="ai-col-message">
                              {log.message}
                              {log.latency_ms && <span className="text-cyan-400/80 font-bold ml-1.5">({log.latency_ms}ms)</span>}
                              {log.tokens_used && <span className="text-purple-400/80 font-bold ml-1.5">({log.tokens_used} tokens)</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Playbook / Status Widget */}
              <div className="glass-panel p-6 col-span-4 flex flex-col gap-5 justify-between glow-purple">
                <div className="flex flex-col gap-4">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <Zap className="h-5 w-5 text-purple-400" />
                    {t('ai_status_title', 'Estado del Sistema de IA')}
                  </h3>

                  <div className="ai-status-card">
                    <div className="ai-status-row">
                      <span className="ai-status-label">{t('ai_playbook_status', 'Estado del Playbook:')}</span>
                      <span className="ai-status-value flex items-center gap-1.5 text-emerald-400">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
                        {t('ai_playbook_active', 'Activo 24/7')}
                      </span>
                    </div>
                    <div className="ai-status-row">
                      <span className="ai-status-label">{t('ai_version', 'Versión de Gemini:')}</span>
                      <span className="ai-status-value text-purple-300">gemini-2.5-flash</span>
                    </div>
                    <div className="ai-status-row">
                      <span className="ai-status-label">{t('ai_channel', 'Canal de Chat:')}</span>
                      <span className="ai-status-value text-cyan-300">WhatsApp Business API</span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-400 leading-relaxed font-medium">
                    💡 <strong>{t('lbl_xprize_evidence_title', 'Evidencia XPRIZE:')}</strong> {t('ai_explanation', 'Este panel demuestra que el agente está interceptando continuamente las peticiones de WhatsApp y decidiendo de forma autónoma cuándo extraer parámetros geográficos (geocodificación) o ejecutar el diagnóstico visual multimodal de placas técnicas.')}
                  </div>
                </div>

                <button 
                  onClick={fetchAICenterData}
                  className="w-full flex items-center justify-center gap-2 btn-premium-purple transition py-2.5 rounded-xl text-xs font-bold text-white shadow-lg active:scale-95 mt-4 cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  {t('btn_sync_ai', 'Sincronizar Métrica de IA')}
                </button>
              </div>

            </div>
          </div>
        )}

        {/* Slide 6: Finanzas y Auditoría */}
        {currentSlide === 5 && (
          <div className="flex flex-col gap-6 animate-fade-in w-full text-slate-100 text-left">
            <div className="text-center md:text-left mb-2 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {t('slide_5_badge', 'XPRIZE: BUSINESS VIABILITY')}
                </span>
                <h2 className="text-4xl font-extrabold tracking-tight text-white font-outfit mt-3 bg-gradient-to-r from-white via-slate-100 to-slate-300">
                  {t('title_finances', 'Finanzas y Auditoría XPRIZE')}
                </h2>
                <p className="text-slate-200 text-sm mt-1 font-medium">{t('desc_finances', 'Control de ingresos, costos de operación y gastos de adquisición de clientes')}</p>
              </div>
              <button
                onClick={exportXPRIZEFinancials}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 transition px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-lg active:scale-95 shrink-0"
              >
                <TrendingUp className="h-4.5 w-4.5" />
                {t('btn_export_xprize', 'Exportar Reporte XPRIZE (CSV)')}
              </button>
            </div>

            {/* Total financial metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="glass-panel p-4 card-top-blue flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(59,130,246,0.08)]">
                <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_total_revenue', 'Ingresos Totales (USD)')}</div>
                <div className="text-2xl font-extrabold text-white">
                  ${(financials.reduce((acc, c) => acc + c.client_revenue + c.related_revenue, 0)).toLocaleString()}
                </div>
                <div className="text-[10px] text-blue-300 font-medium">{t('lbl_may_aug_2026', 'Mayo - Agosto 2026')}</div>
              </div>

              <div className="glass-panel p-4 card-top-purple flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(168,85,247,0.08)]">
                <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_total_costs', 'Costos Totales (Excl. Mkt)')}</div>
                <div className="text-2xl font-extrabold text-white">
                  ${(financials.reduce((acc, c) => acc + c.operating_costs, 0)).toLocaleString()}
                </div>
                <div className="text-[10px] text-purple-300 font-medium">{t('kpi_total_costs_desc', 'Costos técnicos declarados')}</div>
              </div>

              <div className="glass-panel p-4 card-top-amber flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(245,158,11,0.08)]">
                <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_mkt_spend', 'Inversión en Marketing (USD)')}</div>
                <div className="text-2xl font-extrabold text-white">
                  ${(financials.reduce((acc, c) => acc + c.marketing_spend, 0)).toLocaleString()}
                </div>
                <div className="text-[10px] text-amber-300 font-medium">{t('kpi_mkt_spend_desc', 'Costo de adquisición de clientes')}</div>
              </div>

              <div className="glass-panel p-4 card-top-emerald flex flex-col justify-between gap-2 relative overflow-hidden shadow-[0_4px_12px_rgba(16,185,129,0.08)]">
                <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{t('kpi_net_margin', 'Margen Neto (%)')}</div>
                <div className="text-2xl font-extrabold text-white">
                  {(() => {
                    const rev = financials.reduce((acc, c) => acc + c.client_revenue + c.related_revenue, 0);
                    const cost = financials.reduce((acc, c) => acc + c.operating_costs + c.marketing_spend, 0);
                    return rev > 0 ? Math.round(((rev - cost) / rev) * 100) : 0;
                  })()}%
                </div>
                <div className="text-[10px] text-emerald-300 font-medium">{t('kpi_net_margin_desc', 'Rentabilidad acumulada')}</div>
              </div>
            </div>

            <div className="financial-grid items-stretch">
              
              {/* Financial Editor Form Table */}
              <div className="glass-panel p-6 financial-col-editor flex flex-col gap-4 glow-cyan">
                <div className="flex justify-between items-center">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-cyan-400" />
                    {t('tbl_monthly_statement', 'Estado de Ingresos y Costos Mensuales')}
                  </h3>
                  <button
                    onClick={saveFinancials}
                    className="btn-premium-cyan text-white font-bold px-4 py-1.5 rounded-xl text-xs transition active:scale-95 cursor-pointer"
                  >
                    {t('btn_save_changes', 'Guardar Cambios')}
                  </button>
                </div>

                <div className="financial-table-container">
                  <table className="financial-table">
                    <thead>
                      <tr className="border-b border-white/20 text-cyan-300 font-bold uppercase tracking-wider bg-slate-950/60">
                        <th className="p-3 pl-4 rounded-l-lg">{t('tbl_col_month', 'Mes')}</th>
                        <th className="p-3">{t('tbl_col_client_rev', 'Ingresos Clientes')}</th>
                        <th className="p-3">{t('tbl_col_related_rev', 'Ingresos R. P.')}</th>
                        <th className="p-3">{t('tbl_col_op_costs', 'Costo Operación')}</th>
                        <th className="p-3">{t('tbl_col_mkt_spend', 'Gasto Marketing')}</th>
                        <th className="p-3 pr-4 rounded-r-lg">{t('tbl_col_explanation', 'Explicación de Costos')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financials.map((item, index) => (
                        <tr key={index} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-all">
                          <td className="py-4 pl-4 font-bold text-white whitespace-nowrap">{item.month}</td>
                          <td className="py-4 px-2">
                            <div className="financial-input-wrapper">
                              <span>$</span>
                              <input
                                type="number"
                                value={item.client_revenue}
                                onChange={(e) => handleFinancialFieldChange(index, 'client_revenue', e.target.value)}
                                className="financial-input"
                              />
                            </div>
                          </td>
                          <td className="py-4 px-2">
                            <div className="financial-input-wrapper">
                              <span>$</span>
                              <input
                                type="number"
                                value={item.related_revenue}
                                onChange={(e) => handleFinancialFieldChange(index, 'related_revenue', e.target.value)}
                                className="financial-input"
                              />
                            </div>
                          </td>
                          <td className="py-4 px-2">
                            <div className="financial-input-wrapper">
                              <span>$</span>
                              <input
                                type="number"
                                value={item.operating_costs}
                                onChange={(e) => handleFinancialFieldChange(index, 'operating_costs', e.target.value)}
                                className="financial-input"
                              />
                            </div>
                          </td>
                          <td className="py-4 px-2">
                            <div className="financial-input-wrapper">
                              <span>$</span>
                              <input
                                type="number"
                                value={item.marketing_spend}
                                onChange={(e) => handleFinancialFieldChange(index, 'marketing_spend', e.target.value)}
                                className="financial-input"
                              />
                            </div>
                          </td>
                          <td className="py-4 px-2 pr-4">
                            <input
                              type="text"
                              value={item.cost_description || ''}
                              onChange={(e) => handleFinancialFieldChange(index, 'cost_description', e.target.value)}
                              placeholder={t('ph_month_desc', 'Breve descripción del mes')}
                              className="financial-input-text"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* HTML/CSS Bar Chart comparison */}
              <div className="glass-panel p-6 financial-col-chart flex flex-col gap-4 glow-purple text-left justify-between">
                <div>
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-purple-400" />
                    {t('chart_comparison', 'Comparación: Ingreso vs Costo Total')}
                  </h3>

                  <div className="financial-chart-container">
                    {financials.map((item, index) => {
                      const revenue = item.client_revenue + item.related_revenue;
                      const costs = item.operating_costs + item.marketing_spend;
                      const maxVal = Math.max(...financials.map(f => Math.max(f.client_revenue + f.related_revenue, f.operating_costs + f.marketing_spend)));
                      
                      const revPct = maxVal > 0 ? Math.round((revenue / maxVal) * 100) : 0;
                      const costPct = maxVal > 0 ? Math.round((costs / maxVal) * 100) : 0;

                      return (
                        <div key={index} className="financial-chart-row">
                          <div className="financial-chart-header">
                            <span className="text-white">{item.month}</span>
                            <span className="text-slate-400">
                              <span className="text-cyan-300">${revenue.toLocaleString()}</span> vs <span className="text-purple-300">${costs.toLocaleString()}</span>
                            </span>
                          </div>
                          
                          <div className="financial-chart-bars-card">
                            {/* Revenue Bar */}
                            <div className="financial-chart-bar-row">
                              <span className="financial-chart-bar-label text-cyan-400">{t('lbl_ing', 'ING')}</span>
                              <div className="financial-chart-bar-bg">
                                <div 
                                  className="financial-chart-bar-fill-rev"
                                  style={{ width: `${revPct}%` }}
                                ></div>
                              </div>
                            </div>
                            
                            {/* Cost Bar */}
                            <div className="financial-chart-bar-row">
                              <span className="financial-chart-bar-label text-purple-400">{t('lbl_cos', 'COS')}</span>
                              <div className="financial-chart-bar-bg">
                                <div 
                                  className="financial-chart-bar-fill-cost"
                                  style={{ width: `${costPct}%` }}
                                ></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="text-[10px] text-slate-400 italic text-center mt-4">
                  * {t('lbl_dynamic_financial_note', 'Datos actualizados de forma dinámica a partir de la persistencia de Furtz Clima.')}
                </div>
              </div>

            </div>

            {/* Tariff and Equipment Pricing Settings Panel */}
            {pricingConfig && (
              <div className="glass-panel p-6 w-full glow-cyan flex flex-col gap-6 mt-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/10 pb-4 gap-4">
                  <div className="flex items-center gap-3">
                    <Settings className="h-6 w-6 text-cyan-400 shrink-0" />
                    <div>
                      <h3 className="text-xl font-bold text-white font-outfit">
                        {t('title_pricing_config', 'Configuración de Tarifas y Equipos')}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t('desc_pricing_config', 'Modifica los precios base de mantenciones, visitas de factibilidad técnica y rangos de precio por BTU de equipos.')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={savePricingConfig}
                    className="btn-premium-cyan text-white font-bold px-6 py-2.5 rounded-xl text-sm transition active:scale-95 cursor-pointer flex items-center gap-2"
                  >
                    <Save className="h-4.5 w-4.5" />
                    {t('btn_save_config', 'Guardar Tarifas')}
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* General Costs (Left Column - Span 4) */}
                  <div className="lg:col-span-4 flex flex-col gap-4">
                    <h4 className="text-xs text-cyan-300 font-bold uppercase tracking-wider border-b border-white/5 pb-2">
                      {t('lbl_general_fees', 'Costos y Comisiones Generales')}
                    </h4>
                    
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                        {t('lbl_maintenance_cost', 'Costo Base Mantención (CLP)')}
                      </label>
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          value={pricingConfig.maintenance_cost}
                          onChange={(e) => handleConfigValueChange('maintenance_cost', Number(e.target.value) || 0)}
                          className="w-full pl-7 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                        {t('lbl_feasibility_cost', 'Costo Visita Factibilidad (CLP)')}
                      </label>
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          value={pricingConfig.feasibility_visit_cost}
                          onChange={(e) => handleConfigValueChange('feasibility_visit_cost', Number(e.target.value) || 0)}
                          className="w-full pl-7 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                        {t('lbl_installation_cost_min', 'Instalación Básica Mínima (CLP)')}
                      </label>
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          value={pricingConfig.installation_cost.min}
                          onChange={(e) => handleConfigNestedValueChange('installation_cost', 'min', Number(e.target.value) || 0)}
                          className="w-full pl-7 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                        {t('lbl_installation_cost_max', 'Instalación Básica Máxima (CLP)')}
                      </label>
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          value={pricingConfig.installation_cost.max}
                          onChange={(e) => handleConfigNestedValueChange('installation_cost', 'max', Number(e.target.value) || 0)}
                          className="w-full pl-7 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Pricing Matrix (Right Column - Span 8) */}
                  <div className="lg:col-span-8 flex flex-col gap-4">
                    <h4 className="text-xs text-cyan-300 font-bold uppercase tracking-wider border-b border-white/5 pb-2">
                      {t('lbl_pricing_matrix', 'Matriz de Precios de Equipos (Rangos en CLP)')}
                    </h4>
                    
                    <div className="overflow-x-auto border border-white/10 rounded-xl bg-slate-950/20">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/10 bg-white/5 text-[10px] font-bold text-cyan-300 uppercase tracking-wider">
                            <th className="p-3 pl-4">BTU</th>
                            <th className="p-3">{t('lbl_economical', 'Económicas')}</th>
                            <th className="p-3">{t('lbl_intermediate', 'Intermedias')}</th>
                            <th className="p-3 pr-4">{t('lbl_premium', 'Premium')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.keys(pricingConfig.pricing_matrix).map((btu) => (
                            <tr key={btu} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                              <td className="p-3 pl-4 font-bold text-white whitespace-nowrap text-sm">{btu}</td>
                              <td className="p-3">
                                <input
                                  type="text"
                                  value={pricingConfig.pricing_matrix[btu].economicas}
                                  onChange={(e) => handleMatrixValueChange(btu, 'economicas', e.target.value)}
                                  className="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-400/50"
                                />
                              </td>
                              <td className="p-3">
                                <input
                                  type="text"
                                  value={pricingConfig.pricing_matrix[btu].intermedias}
                                  onChange={(e) => handleMatrixValueChange(btu, 'intermedias', e.target.value)}
                                  className="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-400/50"
                                />
                              </td>
                              <td className="p-3 pr-4">
                                <input
                                  type="text"
                                  value={pricingConfig.pricing_matrix[btu].premium}
                                  onChange={(e) => handleMatrixValueChange(btu, 'premium', e.target.value)}
                                  className="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-400/50"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        </div>
      </div>

      {/* SVG gradients defines */}
      <svg className="hidden">
        <defs>
          <linearGradient id="cyanGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="purpleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id="emeraldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
      </svg>

      {/* Email Modal Dialog */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel max-w-md w-full p-6 border border-white/10 relative overflow-hidden flex flex-col gap-4 shadow-2xl shadow-emerald-500/5">
            <div className="absolute top-0 right-0 h-32 w-32 bg-emerald-500/5 rounded-full filter blur-2xl"></div>
            
            <button 
              onClick={() => setShowEmailModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white font-outfit">{t('lbl_send_report_accountant', 'Enviar Reporte al Contador')}</h3>
                <p className="text-xs text-slate-400">{t('desc_send_report_accountant', 'Exporta y envía el CSV de clientes instalados')}</p>
              </div>
            </div>

            {emailStatus.type === null ? (
              <div className="flex flex-col gap-4 mt-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_accountant_email', 'Correo del Contador')}</label>
                  <input
                    type="email"
                    value={accountantEmail}
                    onChange={(e) => setAccountantEmail(e.target.value)}
                    placeholder={t('ph_accountant_email', 'ejemplo@contador.cl')}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-emerald-400/50"
                  />
                </div>

                <div className="bg-white/5 border border-white/5 rounded-xl p-3 text-xs text-slate-400 leading-relaxed">
                  💡 <strong>{t('lbl_note', 'Nota')}:</strong> {t('desc_accountant_email_note', 'Se enviará un correo con un archivo adjunto conteniendo únicamente a los clientes en estado "Instalado". Si usas una cuenta SMTP simulada, recibirás un enlace de bandeja virtual para visualizar el correo.')}
                </div>

                <button
                  onClick={sendEmailToAccountant}
                  disabled={sendingEmail || !accountantEmail}
                  className="flex items-center justify-center gap-2 mt-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 transition py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 active:scale-95 shadow-lg shadow-emerald-950/20 animate-pulse-subtle"
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('lbl_sending_report', 'Enviando reporte...')}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t('btn_confirm_send', 'Confirmar y Enviar')}
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center gap-4 py-4">
                {emailStatus.type === 'success' ? (
                  <div className="h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 animate-bounce">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>
                ) : (
                  <div className="h-16 w-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                    <AlertCircle className="h-8 w-8" />
                  </div>
                )}
                
                <div>
                  <h4 className="font-semibold text-white">{emailStatus.type === 'success' ? t('lbl_report_sent', '¡Reporte Enviado!') : t('lbl_send_error', 'Error de Envío')}</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-[280px]">{emailStatus.message}</p>
                </div>

                {emailStatus.testUrl && (
                  <a
                    href={emailStatus.testUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 transition px-4 py-2 rounded-xl text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                  >
                    📬 {t('lbl_open_virtual_inbox', 'Abrir Bandeja de Entrada Virtual')}
                  </a>
                )}

                <button
                  onClick={() => {
                    if (emailStatus.type === 'success') {
                      setShowEmailModal(false);
                    }
                    setEmailStatus({ type: null, message: '' });
                  }}
                  className="mt-4 text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  {emailStatus.type === 'success' ? t('btn_close_window', 'Cerrar Ventana') : t('btn_try_again', 'Volver a intentar')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Client Modal Dialog */}
      {showAddClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="glass-panel max-w-lg w-full p-6 border border-white/10 relative overflow-hidden flex flex-col gap-4 shadow-2xl shadow-cyan-500/5 my-8">
            <div className="absolute top-0 right-0 h-32 w-32 bg-cyan-500/5 rounded-full filter blur-2xl"></div>
            
            <button 
              type="button"
              onClick={() => setShowAddClientModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white font-outfit">{t('title_add_client', 'Registrar Nuevo Cliente')}</h3>
                <p className="text-xs text-slate-400">{t('desc_leads', 'Gestión directa de visitas técnicas, asignación y estado de servicios')}</p>
              </div>
            </div>

            <form onSubmit={handleAddClient} className="flex flex-col gap-4 mt-2 max-h-[70vh] overflow-y-auto pr-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_client_name', 'Nombre del Cliente')}</label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Phone */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_phone', 'Número de Teléfono')}</label>
                  <input
                    type="text"
                    required
                    value={newClientPhone}
                    onChange={(e) => setNewClientPhone(e.target.value)}
                    placeholder="56990939188"
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                  />
                </div>

                {/* Service Type */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_service_type', 'Tipo de Servicio')}</label>
                  <select
                    value={newClientServiceType}
                    onChange={(e) => setNewClientServiceType(e.target.value as 'installation' | 'maintenance')}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                  >
                    <option value="installation">{t('lbl_installation', 'Instalación')}</option>
                    <option value="maintenance">{t('lbl_maintenance', 'Mantenimiento')}</option>
                  </select>
                </div>

                {/* Conditional fields */}
                {newClientServiceType === 'installation' ? (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_area', 'Superficie de Instalación (m²)')}</label>
                    <input
                      type="number"
                      value={newClientAreaM2}
                      onChange={(e) => setNewClientAreaM2(e.target.value)}
                      placeholder="35"
                      className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_age_input', 'Antigüedad del Equipo')}</label>
                    <input
                      type="text"
                      value={newClientAge}
                      onChange={(e) => setNewClientAge(e.target.value)}
                      placeholder="2 años"
                      className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                    />
                  </div>
                )}

                {/* Status */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('th_status', 'Estado')}</label>
                  <select
                    value={newClientStatus}
                    onChange={(e) => setNewClientStatus(e.target.value)}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                  >
                    <option value="Pendiente">{t('status_pending', 'Pendiente')}</option>
                    <option value="Evaluado">{t('status_evaluated', 'Evaluado')}</option>
                    <option value="Instalado">{t('status_installed', 'Instalado')}</option>
                    <option value="Cancelado">{t('status_cancelled', 'Cancelado')}</option>
                  </select>
                </div>
              </div>

              {/* Date pickers for campaign */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Installation Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_installation_date', 'Fecha de Instalación')}</label>
                  <input
                    type="date"
                    value={newClientInstallationDate}
                    onChange={(e) => setNewClientInstallationDate(e.target.value)}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                  />
                </div>

                {/* Last Maintenance Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_last_maintenance_date', 'Último Mantenimiento')}</label>
                  <input
                    type="date"
                    value={newClientLastMaintenanceDate}
                    onChange={(e) => setNewClientLastMaintenanceDate(e.target.value)}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                  />
                </div>
              </div>

              {/* Address */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_address', 'Dirección')}</label>
                <input
                  type="text"
                  value={newClientAddress}
                  onChange={(e) => setNewClientAddress(e.target.value)}
                  placeholder="Calle Libertad 123, Valdivia"
                  className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                />
              </div>

              {/* Appointment Time (datetime-local) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_appointment', 'Fecha y Hora de Cita')}</label>
                <input
                  type="datetime-local"
                  value={newClientAppointmentTime}
                  onChange={(e) => setNewClientAppointmentTime(e.target.value)}
                  className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                />
              </div>

              {/* Calendar validation info */}
              {newClientAppointmentTime && (() => {
                const dateStr = newClientAppointmentTime.split('T')[0];
                const busyVisits = getAppointmentsForDate(newClientAppointmentTime);
                if (busyVisits.length > 0) {
                  return (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>
                          {t('lbl_busy_warning', 'Advertencia de Agenda: Hay {count} visitas ya programadas para este día ({date}).')
                            .replace('{count}', String(busyVisits.length))
                            .replace('{date}', dateStr)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        <div className="font-bold mb-1">{t('lbl_busy_list', 'Horarios programados para este día:')}</div>
                        <ul className="list-disc list-inside flex flex-col gap-0.5">
                          {busyVisits.map((v, i) => (
                            <li key={i} className="truncate">
                              {v.appointment_time?.includes('T') 
                                ? v.appointment_time.split('T')[1].substring(0, 5) 
                                : v.appointment_time} - Cliente: +{v.phone} ({v.technician || 'Sin asignar'})
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5 text-xs text-emerald-400 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{t('lbl_no_busy', 'Fecha disponible. No hay visitas programadas aún.')}</span>
                    </div>
                  );
                }
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Technician */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('ph_technician', 'Técnico')}</label>
                  <select
                    value={newClientTechnician}
                    onChange={(e) => setNewClientTechnician(e.target.value)}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50"
                  >
                    <option value="">{t('lbl_to_define', 'Por definir')}</option>
                    <option value="Francisco">Francisco (+56990939188)</option>
                    <option value="Felipe">Felipe</option>
                    <option value="Juan">Juan</option>
                  </select>
                </div>

                {/* Suggest visit toggle (installation only) */}
                {newClientServiceType === 'installation' && (
                  <div className="flex items-center gap-2 mt-4">
                    <input
                      type="checkbox"
                      id="suggestVisitCheck"
                      checked={newClientSuggestVisit}
                      onChange={(e) => setNewClientSuggestVisit(e.target.checked)}
                      className="h-4.5 w-4.5 accent-cyan-400 cursor-pointer"
                    />
                    <label htmlFor="suggestVisitCheck" className="text-xs text-slate-200 font-semibold cursor-pointer leading-tight">
                      {t('lbl_suggest_visit', 'Sugerir Visita de Factibilidad Técnica')} (${(pricingConfig?.feasibility_visit_cost || 5000).toLocaleString('es-CL')} CLP)
                    </label>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t('lbl_notes', 'Notas / Observaciones')}</label>
                <textarea
                  value={newClientNotes}
                  onChange={(e) => setNewClientNotes(e.target.value)}
                  placeholder="Ingresar comentarios adicionales..."
                  rows={2}
                  className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50 resize-none"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowAddClientModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-slate-300 hover:bg-white/5 transition active:scale-95"
                >
                  {t('btn_cancel', 'Cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={creatingClient || !newClientPhone}
                  className="flex-1 flex items-center justify-center gap-2 btn-premium-cyan py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 active:scale-95"
                >
                  {creatingClient ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('lbl_registering', 'Registrando...')}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t('btn_register', 'Registrar')}
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Modal de conversación del cliente */}
      {chatLead && (
        <div className="modal-overlay" onClick={() => setChatLead(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>
                  <MessageSquare className="h-5 w-5" style={{ color: '#22d3ee' }} />
                  +{chatLead.phone}
                </h3>
                <p className="modal-sub">
                  {chatLead.service_type === 'installation' ? 'Instalación' : chatLead.service_type === 'maintenance' ? 'Mantención' : 'Servicio sin definir'}
                  {chatLead.client_type ? ` · ${chatLead.client_type}` : ''}
                  {chatLead.payment_method ? ` · Paga con ${chatLead.payment_method}` : ''}
                  {chatLead.appointment_time ? ` · Cita: ${chatLead.appointment_time}` : ''}
                </p>
              </div>
              <button className="modal-cerrar" onClick={() => setChatLead(null)} aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>

            {(chatLead.satisfaction_rating || chatLead.satisfaction_comment) && (
              <div className="chat-encuesta">
                <div className="chat-encuesta-titulo">
                  <Star className="h-4 w-4" />
                  Encuesta de satisfacción
                  {chatLead.satisfaction_rating && <span>{chatLead.satisfaction_rating}/7</span>}
                </div>
                {chatLead.satisfaction_comment && <p>{chatLead.satisfaction_comment}</p>}
              </div>
            )}

            <div className="modal-body">
              {chatLead.conversation && chatLead.conversation.length > 0 ? (
                chatLead.conversation.map((msg, i) => (
                  <div key={i} className={`chat-fila ${msg.role === 'user' ? 'cliente' : 'bot'}`}>
                    <div className={`chat-burbuja ${msg.role === 'user' ? 'cliente' : 'bot'}`}>
                      <div className="chat-autor">{msg.role === 'user' ? 'Cliente' : 'Bot'}</div>
                      {msg.text}
                    </div>
                  </div>
                ))
              ) : (
                <div className="chat-vacio">
                  Todavía no hay conversación guardada para este cliente.
                </div>
              )}
            </div>

            <div className="modal-footer">
              <a
                href={`https://wa.me/${chatLead.phone}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34d399', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
              >
                <Phone className="h-4 w-4" />
                Escribirle por WhatsApp
              </a>
              <button
                onClick={() => handleSendSurvey(chatLead.phone)}
                disabled={sendingSurveyTo === chatLead.phone}
                className="agenda-btn destino"
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'auto', padding: '8px 14px', fontSize: 13 }}
              >
                {sendingSurveyTo === chatLead.phone
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Star className="h-4 w-4" />}
                Enviar encuesta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guide Modal */}
      {showGuideModal && (
        <div className="modal-overlay">
          <div className="modal-panel ancho" style={{ overflowY: 'auto', display: 'block', position: 'relative' }}>
            <button
              onClick={() => setShowGuideModal(false)}
              className="absolute top-4 right-4 p-2 bg-white/5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition"
            >
              <X className="h-5 w-5" />
            </button>
            
            <div className="p-6 md:p-8 space-y-6">
              <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Info className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-bold text-white font-outfit">{t('btn_guide', 'Guía de Uso')}</h3>
              </div>

              <div className="space-y-4 text-slate-300 text-sm leading-relaxed">
                <h4 className="text-white font-bold text-base mt-2">1. ¿Cómo registrar un cliente nuevo?</h4>
                <p>Haz clic en el botón <strong>"Registrar Cliente"</strong> situado en la sección superior derecha de las tablas. Se abrirá un formulario donde podrás ingresar el <strong>Nombre del Cliente</strong>, Teléfono, Tipo de Servicio y otros detalles. Una vez guardado, aparecerá en estado "Pendiente".</p>
                
                <h4 className="text-white font-bold text-base mt-4">2. ¿Qué significan los estados?</h4>
                <ul className="list-disc pl-5 space-y-2">
                  <li><span className="text-amber-400 font-bold">Pendiente:</span> El cliente fue registrado pero aún no ha sido visitado ni evaluado.</li>
                  <li><span className="text-blue-400 font-bold">Evaluado:</span> El técnico ya revisó las condiciones (factibilidad) pero la instalación o mantención aún no se ha completado.</li>
                  <li><span className="text-emerald-400 font-bold">Instalado:</span> El servicio se completó con éxito. (Estos pueden enviarse al Contador).</li>
                  <li><span className="text-rose-400 font-bold">Cancelado:</span> El servicio no se pudo realizar o el cliente desistió.</li>
                </ul>

                <h4 className="text-white font-bold text-base mt-4">3. ¿Cómo asignar un técnico?</h4>
                <p>En la tabla principal ("Gestión de Leads y Factibilidad"), busca al cliente y en la columna de <strong>Asignación</strong> elige al técnico (ej. Juan, Felipe, Francisco) del menú desplegable. Esto enviará una notificación al técnico para que inicie su ruta.</p>

                <h4 className="text-white font-bold text-base mt-4">4. ¿Cómo usar el mapa?</h4>
                <p>El mapa muestra las ubicaciones de los clientes pendientes. La herramienta calculará automáticamente la <strong>Ruta Óptima</strong> para que los técnicos gasten menos tiempo y combustible.</p>
              </div>

              <div className="pt-4 border-t border-white/10 flex justify-end">
                <button
                  onClick={() => setShowGuideModal(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 text-white transition active:scale-95"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
