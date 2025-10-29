/**
 * Helper para logs estructurados y legibles
 */

/**
 * Crea una caja de texto para logs importantes
 * @param {string} title - Título de la caja
 * @param {Object} content - Contenido a mostrar
 * @param {string} type - Tipo: 'info', 'success', 'error', 'warning'
 */
function logBox(title, content = {}, type = 'info') {
  const icons = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    start: '🚀',
    end: '🏁',
  };

  const icon = icons[type] || 'ℹ️';
  const lines = [];

  lines.push('╔════════════════════════════════════════════════════════════════');
  lines.push(`║ ${icon} ${title.toUpperCase()}`);
  lines.push('╠════════════════════════════════════════════════════════════════');

  // Agregar contenido
  if (typeof content === 'object' && !Array.isArray(content)) {
    Object.entries(content).forEach(([key, value]) => {
      const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
      lines.push(`║ ${key}: ${displayValue}`);
    });
  } else if (typeof content === 'string') {
    lines.push(`║ ${content}`);
  }

  lines.push('╚════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Log de inicio de operación
 */
function logOperationStart(operation, details = {}) {
  return logBox(`Iniciando: ${operation}`, details, 'start');
}

/**
 * Log de fin de operación exitosa
 */
function logOperationSuccess(operation, details = {}) {
  return logBox(`Completado: ${operation}`, details, 'success');
}

/**
 * Log de error en operación
 */
function logOperationError(operation, error, details = {}) {
  return logBox(`Error en: ${operation}`, {
    ...details,
    error: error.message || error,
    stack: error.stack,
  }, 'error');
}

/**
 * Log de sección (para separar bloques de logs)
 */
function logSection(title) {
  return `\n${'═'.repeat(80)}\n  ${title}\n${'═'.repeat(80)}`;
}

/**
 * Log de subsección
 */
function logSubSection(title) {
  return `\n${'─'.repeat(80)}\n  ${title}\n${'─'.repeat(80)}`;
}

/**
 * Log de flujo (para mostrar el flujo de una operación)
 */
function logFlow(steps) {
  const lines = ['Flujo de operación:'];
  steps.forEach((step, index) => {
    const icon = step.status === 'done' ? '✅' : step.status === 'error' ? '❌' : '▶️';
    lines.push(`  ${icon} ${index + 1}. ${step.description}`);
  });
  return lines.join('\n');
}

/**
 * Log de datos estructurados
 */
function logData(label, data, maxDepth = 2) {
  return `${label}:\n${JSON.stringify(data, null, 2)}`;
}

/**
 * Log compacto de request HTTP
 */
function logHttpRequest(method, url, body = null) {
  const lines = [
    `→ ${method} ${url}`,
  ];

  if (body && Object.keys(body).length > 0) {
    lines.push(`  Body: ${JSON.stringify(body, null, 2)}`);
  }

  return lines.join('\n');
}

/**
 * Log compacto de response HTTP
 */
function logHttpResponse(status, data = null, duration = null) {
  const statusIcon = status >= 200 && status < 300 ? '✅' : status >= 400 ? '❌' : '⚠️';
  const lines = [
    `← ${statusIcon} Response ${status}${duration ? ` (${duration}ms)` : ''}`,
  ];

  if (data) {
    const preview = typeof data === 'string' ? data.substring(0, 100) : JSON.stringify(data).substring(0, 100);
    lines.push(`  Data: ${preview}${preview.length >= 100 ? '...' : ''}`);
  }

  return lines.join('\n');
}

/**
 * Log de enrutamiento
 */
function logRouting(numero, fromApp, toApp, reason = '') {
  const arrow = fromApp ? `${fromApp} → ${toApp}` : toApp;
  return logBox('Enrutamiento', {
    'Número': numero,
    'Ruta': arrow,
    'Razón': reason || 'N/A',
    'Timestamp': new Date().toISOString(),
  }, 'info');
}

/**
 * Log de transferencia
 */
function logTransfer(numero, fromApp, toApp, context = {}) {
  return logBox('Transferencia de Conversación', {
    'Número': numero,
    'De': fromApp,
    'A': toApp,
    'Contexto': Object.keys(context).length > 0 ? JSON.stringify(context) : 'Ninguno',
    'Timestamp': new Date().toISOString(),
  }, 'info');
}

/**
 * Log de finalización
 */
function logFinalization(numero, app, sendMessage = true) {
  return logBox('Finalización de Conversación', {
    'Número': numero,
    'App anterior': app,
    'Mensaje despedida': sendMessage ? 'Sí' : 'No',
    'Timestamp': new Date().toISOString(),
  }, 'end');
}

/**
 * Log de mensaje de WhatsApp
 */
function logWhatsAppMessage(message) {
  return logBox('Mensaje de WhatsApp', {
    'ID': message.id,
    'De': message.from,
    'Nombre': message.profile_name,
    'Tipo': message.type,
    'Texto': message.text || 'N/A',
    'Timestamp': new Date(parseInt(message.timestamp) * 1000).toISOString(),
  }, 'info');
}

/**
 * Log de webhook recibido
 */
function logWebhookReceived(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];
  const status = change?.value?.statuses?.[0];

  let type = 'desconocido';
  let details = {};

  if (message) {
    type = 'mensaje';
    details = {
      'De': message.from,
      'Tipo': message.type,
      'Texto': message.text?.body || message.type,
    };
  } else if (status) {
    type = 'status';
    details = {
      'Estado': status.status,
      'Destinatario': status.recipient_id,
    };
  }

  return logBox(`Webhook Recibido (${type})`, details, 'info');
}

module.exports = {
  logBox,
  logOperationStart,
  logOperationSuccess,
  logOperationError,
  logSection,
  logSubSection,
  logFlow,
  logData,
  logHttpRequest,
  logHttpResponse,
  logRouting,
  logTransfer,
  logFinalization,
  logWhatsAppMessage,
  logWebhookReceived,
};
