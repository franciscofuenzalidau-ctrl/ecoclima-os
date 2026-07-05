import pptxgen from 'pptxgenjs';

function buildPresentation() {
  console.log('Generando archivo PowerPoint Furtz Clima OS con gráficos...');
  const pptx = new pptxgen();

  // Set widescreen layout
  pptx.layout = 'LAYOUT_16x9';

  // Constants for theme styling
  const BG_COLOR = '060B13';       // Dark Navy background
  const CARD_BG = '0C1220';        // HBSJO card blue-grey
  const CARD_BORDER = '162035';    // Crisp low-opacity border
  const TEXT_WHITE = 'FFFFFF';     // Main text
  const TEXT_MUTED = '94A3B8';     // Muted labels/details
  const COLOR_CYAN = '00E5FF';     // Primary Cyan accent
  const COLOR_PURPLE = 'A855F7';   // Secondary Purple accent
  const COLOR_EMERALD = '10B981';  // Green accent for success
  const COLOR_AMBER = 'F59E0B';    // Amber accent for warnings/in-progress

  // Helper to apply base slide settings (background + headers)
  function createBaseSlide(title: string) {
    const slide = pptx.addSlide();
    slide.background = { fill: BG_COLOR };

    // Decorative thin top accent line
    slide.addShape('rect', {
      x: 0,
      y: 0,
      w: 13.33,
      h: 0.08,
      fill: { color: COLOR_CYAN }
    });

    // Widescreen Header Title
    slide.addText(title, {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 0.6,
      fontSize: 26,
      fontFace: 'Arial',
      color: COLOR_CYAN,
      bold: true
    });

    // Furtz Clima OS footer branding
    slide.addText('Furtz Clima OS — XPRIZE Presentation', {
      x: 0.5,
      y: 7.1,
      w: 6.0,
      h: 0.3,
      fontSize: 10,
      color: TEXT_MUTED,
      italic: true
    });

    return slide;
  }

  // ==========================================
  // SLIDE 1: Portada (Title Slide)
  // ==========================================
  const slide1 = pptx.addSlide();
  slide1.background = { fill: BG_COLOR };

  // Decorative diagonal visual design
  slide1.addShape('rect', {
    x: 0,
    y: 0,
    w: 0.15,
    h: 7.5,
    fill: { color: COLOR_CYAN }
  });

  // Widescreen Title
  slide1.addText('FURTZ CLIMA OS', {
    x: 1.0,
    y: 1.8,
    w: 11.33,
    h: 1.0,
    fontSize: 48,
    fontFace: 'Arial',
    color: COLOR_CYAN,
    bold: true
  });

  slide1.addText('Asistente Operativo con Inteligencia Artificial, Logística de Climatización y Auditoría XPRIZE', {
    x: 1.0,
    y: 2.8,
    w: 11.33,
    h: 0.8,
    fontSize: 18,
    color: TEXT_WHITE
  });

  // Description / Context
  slide1.addText('Presentación Técnica del Proyecto — Concurso Build with Gemini XPRIZE\nClimatización Inteligente para el Hogar (Split Muro y Ductos)', {
    x: 1.0,
    y: 3.8,
    w: 9.0,
    h: 0.8,
    fontSize: 12,
    color: TEXT_MUTED
  });

  // Progress KPI Box
  slide1.addShape('rect', {
    x: 1.0,
    y: 5.0,
    w: 4.8,
    h: 1.2,
    fill: { color: '131B2E' },
    line: { color: COLOR_AMBER, width: 2 }
  });

  slide1.addText('PROGRESO ACTUAL DEL PROYECTO', {
    x: 1.2,
    y: 5.15,
    w: 4.4,
    h: 0.3,
    fontSize: 11,
    color: TEXT_MUTED,
    bold: true
  });

  slide1.addText('90% COMPLETADO / EN INTEGRACIÓN', {
    x: 1.2,
    y: 5.45,
    w: 4.4,
    h: 0.5,
    fontSize: 20,
    color: COLOR_AMBER,
    bold: true
  });


  // ==========================================
  // SLIDE 2: Resumen y Objetivo del Proyecto
  // ==========================================
  const slide2 = createBaseSlide('Resumen del Proyecto y Objetivo');

  // Left Card: Objetivo
  slide2.addShape('rect', {
    x: 0.5,
    y: 1.2,
    w: 5.9,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide2.addText('Objetivo Estratégico', {
    x: 0.8,
    y: 1.4,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    color: COLOR_CYAN,
    bold: true
  });

  slide2.addText(
    '- Optimizar integralmente el ciclo de atención comercial, dimensionamiento técnico y despacho logístico de la empresa chilena FURTZ.\n\n' +
    '- Automatizar la interacción inicial con prospectos usando IA para reducir tiempos de respuesta de horas a segundos.\n\n' +
    '- Centralizar auditorías de viabilidad financiera y facturación conforme a los rigurosos estándares requeridos por los jueces de XPRIZE.\n\n' +
    '- Proveer checklists interactivos de calidad móvil para certificar que cada servicio cumple con protocolos del Ministerio de Salud.',
    {
      x: 0.8,
      y: 2.0,
      w: 5.3,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 22
    }
  );

  // Right Card: Arquitectura
  slide2.addShape('rect', {
    x: 6.8,
    y: 1.2,
    w: 6.0,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide2.addText('Arquitectura e Integraciones', {
    x: 7.1,
    y: 1.4,
    w: 5.4,
    h: 0.4,
    fontSize: 18,
    color: COLOR_PURPLE,
    bold: true
  });

  slide2.addText(
    '- Frontend Web: Panel de control React SPA (Vite) responsivo para administración de leads, optimización geográfica de rutas y visualización financiera.\n\n' +
    '- Backend REST: Servidor Express (Node.js/TypeScript) unificado que procesa solicitudes, gestiona la agenda y sirve la aplicación estática.\n\n' +
    '- IA de Google Gemini: Integración directa del SDK oficial para procesamiento multimodal de imágenes y lógica conversacional avanzada.\n\n' +
    '- Base de Datos: Arquitectura híbrida en Firestore Cloud (producción) y respaldo automatizado JSON local para alta disponibilidad offline.',
    {
      x: 7.1,
      y: 2.0,
      w: 5.4,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 22
    }
  );


  // ==========================================
  // SLIDE 3: WhatsApp Bot y Reglas de Negocio
  // ==========================================
  const slide3 = createBaseSlide('Chatbot de WhatsApp: Reglas Conversacionales');

  // Left Card: Mantenimientos
  slide3.addShape('rect', {
    x: 0.5,
    y: 1.2,
    w: 5.9,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide3.addText('1. Foco Exclusivo en Mantenimientos', {
    x: 0.8,
    y: 1.4,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    color: COLOR_CYAN,
    bold: true
  });

  slide3.addText(
    '- Recolección de Datos de Mantención:\n' +
    '  * Potencia del equipo: Opciones fijas a# 9K, b# 12K, c# 18K, d# 24K+ BTU.\n' +
    '  * Antigüedad de instalación (años/meses).\n' +
    '  * Tiempo transcurrido desde el último servicio.\n' +
    '  * Estado operacional (si funciona correctamente o tiene fallas).\n' +
    '  * Dirección y fecha/hora preferida para la visita técnica.\n\n' +
    '- Validación de Agenda Inteligente: El bot consulta la agenda ocupada en tiempo real en la BD e inyecta dinámicamente horarios disponibles en el prompt para evitar colisiones.\n\n' +
    '- Estado Pendiente: Al finalizar, guarda el registro como "pendiente_revision" (Human-in-the-Loop) esperando validación final.',
    {
      x: 0.8,
      y: 2.0,
      w: 5.3,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 19
    }
  );

  // Right Card: Derivación Ventas
  slide3.addShape('rect', {
    x: 6.8,
    y: 1.2,
    w: 6.0,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide3.addText('2. Derivación de Ventas y Autopausa', {
    x: 7.1,
    y: 1.4,
    w: 5.4,
    h: 0.4,
    fontSize: 18,
    color: COLOR_PURPLE,
    bold: true
  });

  slide3.addText(
    '- Detección de Intención de Compra: Si el cliente expresa interés en adquirir un equipo de aire acondicionado nuevo, cotizar o realizar una instalación, el bot corta la conversación automatizada inmediatamente.\n\n' +
    '- Respuesta Fija de Derivación: El bot responde de forma unificada:\n' +
    '  "Perfecto. Te voy a derivar directamente con nuestro Área de Ventas..." e inyecta un enlace directo wa.me al número comercial configurado.\n\n' +
    '- Autopausa de IA: El bot asigna el estado de lead "derivado_ventas" y se pausa en la base de datos para ese teléfono. El webhook omite procesar futuros mensajes entrantes hasta intervención humana.',
    {
      x: 7.1,
      y: 2.0,
      w: 5.4,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 20
    }
  );


  // ==========================================
  // SLIDE 4: Diagnóstico IA Multimodal (Opción 1)
  // ==========================================
  const slide4 = createBaseSlide('Diagnóstico Multimodal: Visión Artificial con Gemini');

  // Left Card: Placa Técnica
  slide4.addShape('rect', {
    x: 0.5,
    y: 1.2,
    w: 5.9,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide4.addText('Análisis de Placa Técnica de Climatización', {
    x: 0.8,
    y: 1.4,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    color: COLOR_CYAN,
    bold: true
  });

  slide4.addText(
    '- Detección de Parámetros: Los técnicos en terreno o clientes pueden enviar una fotografía de la placa de características técnicas del compresor.\n\n' +
    '- Extracción Automática mediante Visión:\n' +
    '  * Marca y Modelo del equipo.\n' +
    '  * Capacidad térmica real expresada en BTU o Watts.\n' +
    '  * Tipo de Tecnología (Split Muro / Inverter / On-Off).\n' +
    '  * Tipo de gas refrigerante utilizado (R410a, R32).\n\n' +
    '- Advertencia de Incompatibilidad: Emite alertas inmediatas si el gas refrigerante u otros parámetros no cumplen los estándares ecológicos vigentes.',
    {
      x: 0.8,
      y: 2.0,
      w: 5.3,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 21
    }
  );

  // Right Card: Tableros Eléctricos
  slide4.addShape('rect', {
    x: 6.8,
    y: 1.2,
    w: 6.0,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide4.addText('Evaluación de Tableros Eléctricos', {
    x: 7.1,
    y: 1.4,
    w: 5.4,
    h: 0.4,
    fontSize: 18,
    color: COLOR_PURPLE,
    bold: true
  });

  slide4.addText(
    '- Escaneo de Seguridad de Factibilidad: Permite subir fotos del panel eléctrico del domicilio para determinar si soporta el consumo del aire acondicionado.\n\n' +
    '- Diagnóstico de Interruptores: Identifica interruptores magneto-térmicos instalados, amperajes y el espacio físico disponible.\n\n' +
    '- Recomendación Preventiva: Advierte si el tablero eléctrico se encuentra al límite de carga e indica explícitamente si se requiere una ampliación del empalme antes del montaje del aire acondicionado para prevenir sobrecargas.',
    {
      x: 7.1,
      y: 2.0,
      w: 5.4,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 21
    }
  );


  // ==========================================
  // SLIDE 5: Centro de Control de IA (AI Control Center)
  // ==========================================
  const slide5 = createBaseSlide('Centro de Control de IA y Monitoreo');

  // Left Card: Telemetría
  slide5.addShape('rect', {
    x: 0.5,
    y: 1.2,
    w: 5.9,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide5.addText('Telemetría de Gemini en Tiempo Real', {
    x: 0.8,
    y: 1.4,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    color: COLOR_CYAN,
    bold: true
  });

  slide5.addText(
    '- Panel de Telemetría Operativo: Registra de manera continua las llamadas a Gemini en producción, asegurando visibilidad del rendimiento del agente:\n\n' +
    '  * Llamadas Totales: Volumen de conversaciones gestionadas.\n' +
    '  * Latencia de Respuesta: Monitoreo en milisegundos (ms) del tiempo de respuesta del modelo.\n' +
    '  * Consumo de Tokens: Registro de tokens de entrada (Prompt) y salida (Output) para auditoría de facturación.\n' +
    '  * Tasa de Éxito: Porcentaje de llamadas resueltas exitosamente sin excepciones de conexión.',
    {
      x: 0.8,
      y: 2.0,
      w: 5.3,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 21
    }
  );

  // Right Card: Logs
  slide5.addShape('rect', {
    x: 6.8,
    y: 1.2,
    w: 6.0,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide5.addText('Consola de Logs y Ajuste de Dólar', {
    x: 7.1,
    y: 1.4,
    w: 5.4,
    h: 0.4,
    fontSize: 18,
    color: COLOR_PURPLE,
    bold: true
  });

  slide5.addText(
    '- Terminal Retro Interactiva: Consola que muestra en vivo las llamadas que realiza la IA, detallando teléfono, evento (mensaje, foto, GPS) y la respuesta exacta.\n\n' +
    '- Configuración Dinámica de Precios: Panel para que los administradores actualicen en tiempo real las tarifas de mantenciones y equipos en vivo ante la fluctuación del dólar.\n\n' +
    '- Impacto Instantáneo: Al guardar, los nuevos precios se actualizan en el prompt del chatbot de Gemini y los cálculos de presupuestos del dashboard.',
    {
      x: 7.1,
      y: 2.0,
      w: 5.4,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 21
    }
  );


  // ==========================================
  // SLIDE 6: Módulo Financiero y Auditoría XPRIZE
  // ==========================================
  const slide6 = createBaseSlide('Finanzas y Auditoría Financiera XPRIZE');

  // Left Card: Business Viability
  slide6.addShape('rect', {
    x: 0.5,
    y: 1.2,
    w: 5.9,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide6.addText('Cumplimiento de Viabilidad del Negocio', {
    x: 0.8,
    y: 1.4,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    color: COLOR_CYAN,
    bold: true
  });

  slide6.addText(
    '- Desglose Mensual: Flujos alineados al formulario oficial de XPRIZE.\n' +
    '- Seguimiento de ingresos de clientes vs costos de operación y marketing.\n' +
    '- Comparativa de Ingresos Totales vs Costos Totales mensuales (CLP x1000):',
    {
      x: 0.8,
      y: 2.0,
      w: 5.3,
      h: 1.8,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 21
    }
  );

  // Financial Bar Chart
  const finanzasData = [
    {
      name: 'Ingresos',
      labels: ['Mayo', 'Junio', 'Julio', 'Agosto'],
      values: [2400, 3100, 4200, 5500]
    },
    {
      name: 'Costos',
      labels: ['Mayo', 'Junio', 'Julio', 'Agosto'],
      values: [1800, 2100, 2900, 3200]
    }
  ];

  slide6.addChart('bar', finanzasData, {
    x: 0.8,
    y: 3.9,
    w: 5.3,
    h: 2.6,
    barDir: 'col',
    chartColors: [COLOR_CYAN, COLOR_PURPLE],
    showLegend: true,
    legendPos: 'b',
    legendColor: TEXT_WHITE,
    legendFontSize: 9,
    valAxisMinVal: 0,
    valAxisMaxVal: 6000,
    catAxisLabelColor: TEXT_WHITE,
    catAxisLabelFontSize: 9,
    valAxisLabelColor: TEXT_WHITE,
    valAxisLabelFontSize: 9,
    showValue: true,
    dataLabelColor: TEXT_WHITE,
    dataLabelFontSize: 8
  });

  // Right Card: Exportacion
  slide6.addShape('rect', {
    x: 6.8,
    y: 1.2,
    w: 6.0,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide6.addText('Exportación y Envío de Reporte a Contador', {
    x: 7.1,
    y: 1.4,
    w: 5.4,
    h: 0.4,
    fontSize: 18,
    color: COLOR_PURPLE,
    bold: true
  });

  slide6.addText(
    '- Formato de Auditoría Oficial: Generación automática de reportes CSV formateados con delimitador de punto y coma e inyección de BOM UTF-8 para compatibilidad en Excel Español.\n\n' +
    '- Envío Automatizado por Correo: Modal interactivo para enviar el reporte de clientes completados (estado "Instalado") directamente al correo del contador.\n\n' +
    '- Transporte de Email Dual: Integración de servidor SMTP real para envío productivo y simulación de bandeja virtual (Ethereal) para pruebas operativas de desarrollo.',
    {
      x: 7.1,
      y: 2.0,
      w: 5.4,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 21
    }
  );


  // ==========================================
  // SLIDE 7: Campaña Preventiva y Re-enganchamiento
  // ==========================================
  const slide7 = createBaseSlide('Campaña Preventiva Automatizada');

  // Left Card: Logica
  slide7.addShape('rect', {
    x: 0.5,
    y: 1.2,
    w: 5.9,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide7.addText('Lógica de Re-enganchamiento Automatizado', {
    x: 0.8,
    y: 1.4,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    color: COLOR_CYAN,
    bold: true
  });

  slide7.addText(
    '- Problema Operativo: Los clientes suelen olvidar realizar las limpiezas y mantenciones de sus equipos cada año, disminuyendo la vida útil y aumentando el consumo eléctrico.\n\n' +
    '- Solución de Escaneo Inteligente: El backend escanea los registros filtrando aquellos clientes cuya fecha de instalación o último mantenimiento supere 1 año (365 días) de inactividad.\n\n' +
    '- Activación con Un Clic: Botón dedicado "Campaña Preventiva" en el panel de Leads que realiza el envío masivo en un solo paso.',
    {
      x: 0.8,
      y: 2.0,
      w: 5.3,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 22
    }
  );

  // Right Card: Envio
  slide7.addShape('rect', {
    x: 6.8,
    y: 1.2,
    w: 6.0,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide7.addText('Mensaje y Flujo del Servicio', {
    x: 7.1,
    y: 1.4,
    w: 5.4,
    h: 0.4,
    fontSize: 18,
    color: COLOR_PURPLE,
    bold: true
  });

  slide7.addText(
    '- Contenido del Mensaje de Campaña:\n' +
    '  "¡Hola! En Furtz Clima recordamos que tu equipo de aire acondicionado fue instalado o mantenido hace más de un año. Te sugerimos realizar un Mantenimiento Preventivo..."\n\n' +
    '- Envío Real y Simulación: Despacha la oferta con el precio base de mantención ($40.000 CLP). Si las claves API de WhatsApp no están configuradas, simula el envío detallado en logs.\n\n' +
    '- Retorno al Flujo: Cambia el estado del cliente a "Pendiente" y guarda una anotación de contacto en sus notas de historial, listándolo de inmediato en la tabla de control.',
    {
      x: 7.1,
      y: 2.0,
      w: 5.4,
      h: 4.4,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 20
    }
  );


  // ==========================================
  // SLIDE 8: Progreso y Avance del Proyecto
  // ==========================================
  const slide8 = createBaseSlide('Progreso General y Estado de Avance');

  // Left Card: Progreso
  slide8.addShape('rect', {
    x: 0.5,
    y: 1.2,
    w: 5.9,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: COLOR_AMBER, width: 2 }
  });

  slide8.addText('Progreso General: 90% (En Integración)', {
    x: 0.8,
    y: 1.4,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    color: COLOR_AMBER,
    bold: true
  });

  slide8.addText(
    '- Software y Lógica del Sistema: 100% completado en desarrollo local.\n' +
    '- Canal de WhatsApp: Listo en simulación; pendiente verificación con chip real.\n' +
    '- Distribución de Avance del Proyecto:',
    {
      x: 0.8,
      y: 2.0,
      w: 5.3,
      h: 1.8,
      fontSize: 13,
      color: TEXT_WHITE,
      lineSpacing: 21
    }
  );

  // Doughnut Progress Chart
  const progressChartData = [
    {
      name: 'Avance del Proyecto',
      labels: ['Listo / Verificado', 'Pendiente Meta API'],
      values: [90, 10]
    }
  ];

  slide8.addChart('doughnut', progressChartData, {
    x: 0.8,
    y: 3.9,
    w: 5.3,
    h: 2.6,
    chartColors: [COLOR_EMERALD, COLOR_AMBER],
    holeSize: 65,
    showLegend: true,
    legendPos: 'b',
    legendColor: TEXT_WHITE,
    legendFontSize: 9,
    showPercent: true,
    showValue: false,
    dataLabelColor: TEXT_WHITE,
    dataLabelFontSize: 10
  });

  // Right Card: Desglose por Modulos
  slide8.addShape('rect', {
    x: 6.8,
    y: 1.2,
    w: 6.0,
    h: 5.5,
    fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1.5 }
  });

  slide8.addText('Detalle de Progreso por Módulos', {
    x: 7.1,
    y: 1.4,
    w: 5.4,
    h: 0.4,
    fontSize: 18,
    color: COLOR_CYAN,
    bold: true
  });

  // Table structure inside Right Card
  const tableData: any[] = [
    [
      { text: 'Módulo / Funcionalidad', options: { bold: true, color: COLOR_CYAN } },
      { text: 'Avance', options: { bold: true, color: COLOR_CYAN } },
      { text: 'Estado', options: { bold: true, color: COLOR_CYAN } }
    ],
    [{ text: 'Lógica del Chatbot de WhatsApp' }, { text: '100%' }, { text: 'Listo (Simulación)' }],
    [{ text: 'Conexión a Número Real (Meta API)' }, { text: '50%' }, { text: 'En Integración' }],
    [{ text: 'Centro de Control / Telemetría' }, { text: '100%' }, { text: 'Completado' }],
    [{ text: 'Diagnóstico IA Multimodal' }, { text: '100%' }, { text: 'Completado' }],
    [{ text: 'Finanzas y Auditoría XPRIZE' }, { text: '100%' }, { text: 'Completado' }],
    [{ text: 'Campaña Preventiva (1 Año)' }, { text: '100%' }, { text: 'Completado' }],
    [{ text: 'Optimización de Rutas GPS' }, { text: '100%' }, { text: 'Completado' }]
  ];

  slide8.addTable(tableData, {
    x: 7.1,
    y: 2.0,
    w: 5.4,
    h: 4.2,
    colW: [2.8, 0.9, 1.7],
    border: { pt: 1, color: '162035' },
    fontSize: 11,
    color: TEXT_WHITE,
    valign: 'middle',
    align: 'left'
  });

  // ==========================================
  // WRITE FILE TO WORKSPACE ROOT
  // ==========================================
  const outputPath = 'c:/Users/Lenovo/Desktop/energia sustentable furtz _ Publicación/Furtz_Clima_OS_Presentacion.pptx';
  pptx.writeFile({ fileName: outputPath })
    .then(fileName => {
      console.log(`\n====================================================`);
      console.log(`POWERPOINT CREADO CON ÉXITO: ${fileName}`);
      console.log(`====================================================\n`);
      process.exit(0);
    })
    .catch(err => {
      console.error('Error al guardar PowerPoint:', err);
      process.exit(1);
    });
}

buildPresentation();
