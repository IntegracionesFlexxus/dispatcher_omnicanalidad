const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const redisService = require('./redis.service');
const { createBreaker } = require('../utils/circuitBreaker');
const { mensajesRecibidos, transferencias, finalizaciones, erroresApps } = require('../utils/metrics');

/**
 * Servicio de enrutamiento de mensajes con circuit breakers
 */

// Cache de circuit breakers por app
const circuitBreakers = new Map();

/**
 * Obtener o crear circuit breaker para una app
 * @param {string} appKey - Key de la aplicación
 * @returns {CircuitBreaker}
 */
function getCircuitBreaker(appKey) {
  if (!circuitBreakers.has(appKey)) {
    const breaker = createBreaker(
      async (url, body, extraHeaders = {}) => {
        return await axios.post(url, body, {
          timeout: config.appTimeout,
          headers: {
            'Content-Type': 'application/json',
            'X-Dispatcher': 'true',
            'X-Dispatcher-Version': '1.0.0',
            ...extraHeaders,
          },
          validateStatus: (status) => status < 500, // No lanzar error en 4xx
        });
      },
      {
        name: `app-${appKey}`,
        timeout: config.appTimeout,
      }
    );

    circuitBreakers.set(appKey, breaker);
  }

  return circuitBreakers.get(appKey);
}

/**
 * Enviar mensaje a una aplicación específica
 * @param {string} appKey - Key de la aplicación
 * @param {Object} body - Body del mensaje
 * @returns {Promise<Object>}
 */
async function enviarAApp(appKey, body) {
  logger.info(`📤 [enviarAApp] Iniciando envío a app: ${appKey}`);

  const app = config.apps[appKey];

  if (!app) {
    logger.error(`❌ [enviarAApp] Aplicación "${appKey}" NO EXISTE`);
    logger.error(`   Apps disponibles: ${Object.keys(config.apps).join(', ')}`);
    return { error: 'App no encontrada', appKey };
  }

  const url = app.url; // Usar URL completa desde config
  logger.info(`📍 [enviarAApp] URL destino: ${url}`);
  logger.info(`📦 [enviarAApp] Body a enviar:\n${JSON.stringify(body, null, 2)}`);

  const breaker = getCircuitBreaker(appKey);

  // Headers adicionales según la app
  const extraHeaders = {};
  if (appKey === 'asesor' && config.asesor?.apiKey) {
    extraHeaders['X-API-Key'] = config.asesor.apiKey;
    logger.info(`🔑 [enviarAApp] Agregando X-API-Key para ${appKey}`);
  }

  try {
    logger.info(`🔄 [enviarAApp] Ejecutando circuit breaker para ${app.nombre}...`);

    const response = await breaker.fire(url, body, extraHeaders);

    if (response.status >= 200 && response.status < 300) {
      logger.info(`✅ ${app.nombre} respondió OK (${response.status})`);
      logger.info(`📨 [enviarAApp] Respuesta del ${app.nombre}:\n${JSON.stringify(response.data, null, 2)}`);
      return {
        success: true,
        status: response.status,
        data: response.data,
      };
    } else if (response.status >= 400 && response.status < 500) {
      logger.warn(`⚠️  ${app.nombre} respondió con ${response.status} (client error)`);
      return {
        success: false,
        status: response.status,
        error: 'Client error',
        data: response.data,
      };
    } else {
      logger.error(`❌ ${app.nombre} respondió con ${response.status}`);
      erroresApps.labels(appKey, 'server_error').inc();
      return {
        success: false,
        status: response.status,
        error: 'Server error',
      };
    }
  } catch (error) {
    // Errores del circuit breaker o de red
    let errorType = 'unknown';

    if (error.code === 'ECONNREFUSED') {
      logger.error(`❌ ${app.nombre} no está disponible (${app.url})`);
      errorType = 'connection_refused';
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      logger.error(`❌ ${app.nombre} timeout`);
      errorType = 'timeout';
    } else if (error.message.includes('breaker is open')) {
      logger.error(`❌ Circuit breaker abierto para ${app.nombre}`);
      errorType = 'circuit_open';
    } else {
      logger.error(`❌ Error conectando a ${app.nombre}:`, {
        error: error.message,
        code: error.code,
      });
      errorType = 'network_error';
    }

    erroresApps.labels(appKey, errorType).inc();

    return {
      success: false,
      error: error.message,
      errorType,
      appKey,
    };
  }
}

/**
 * Enrutar mensaje a la aplicación correcta según routing en Redis
 * @param {string} numero - Número de teléfono
 * @param {Object} body - Body del webhook
 * @returns {Promise<Object>}
 */
async function enrutarMensaje(numero, body) {
  logger.info(`\n🔀 ========== ENRUTANDO MENSAJE ==========`);
  logger.info(`📞 Número: ${numero}`);

  try {
    // Obtener app asignada desde Redis
    logger.info(`🔍 [enrutarMensaje] Consultando routing en memoria...`);
    const appKey = await redisService.getAppAsignada(numero);
    logger.info(`✓ [enrutarMensaje] App asignada: "${appKey}"`);

    const app = config.apps[appKey];

    if (!app) {
      logger.error(`❌ [enrutarMensaje] App asignada "${appKey}" NO EXISTE para ${numero}`);
      logger.error(`   Apps disponibles: ${Object.keys(config.apps).join(', ')}`);
      logger.info(`🔄 [enrutarMensaje] Ejecutando FALLBACK al bot...`);

      // Fallback al bot
      const fallbackResult = await enviarAApp('bot', body);
      return {
        appKey: 'bot',
        appNombre: config.apps['bot']?.nombre || 'BOT',
        resultado: fallbackResult,
        fallback: true,
      };
    }

    logger.info(`✓ [enrutarMensaje] App encontrada: ${app.nombre} (${appKey})`);
    logger.info(`🎯 [enrutarMensaje] Enviando a: ${app.url}`);

    // Enviar a la app
    const resultado = await enviarAApp(appKey, body);

    // Incrementar estadísticas
    await redisService.incrementStats('mensajes_total');
    await redisService.incrementStats(`mensajes_${appKey}`);
    mensajesRecibidos.labels(appKey).inc();

    logger.info(`✅ [enrutarMensaje] Enrutamiento completado exitosamente`);
    logger.info(`🔀 ========================================\n`);

    return {
      appKey,
      appNombre: app.nombre,
      resultado,
    };
  } catch (error) {
    logger.error(`❌ [enrutarMensaje] ERROR CRÍTICO:`, {
      numero,
      error: error.message,
      stack: error.stack,
    });

    // Intentar fallback al bot
    logger.warn(`🔄 [enrutarMensaje] Intentando FALLBACK al bot por error...`);
    try {
      const fallbackResult = await enviarAApp('bot', body);
      logger.info(`✓ [enrutarMensaje] Fallback exitoso`);
      return {
        appKey: 'bot',
        appNombre: 'BOT (fallback)',
        resultado: fallbackResult,
        error: error.message,
      };
    } catch (fallbackError) {
      logger.error(`❌ [enrutarMensaje] FALLBACK TAMBIÉN FALLÓ:`, fallbackError.message);
      return {
        error: 'Error total en enrutamiento',
        originalError: error.message,
        fallbackError: fallbackError.message,
      };
    }
  }
}

/**
 * Transferir conversación a otra aplicación
 * @param {string} numero - Número de teléfono
 * @param {string} appDestino - Key de la app destino
 * @param {Object} contexto - Contexto adicional
 * @returns {Promise<Object>}
 */
async function transferir(numero, appDestino, contexto = {}) {
  if (!config.apps[appDestino]) {
    throw new Error(`Aplicación "${appDestino}" no existe`);
  }

  const appAnterior = await redisService.getAppAsignada(numero);

  // Cambiar routing en Redis
  await redisService.setAppAsignada(numero, appDestino);

  logger.info(`🔀 Transferencia: ${numero} de ${appAnterior} → ${appDestino}`);

  // Construir notificación según la app destino
  let notificacion;

  if (appDestino === 'asesor') {
    // Formato específico para SOFTWARE_ASESORES
    notificacion = {
      channel_id: config.asesor?.channelId || 1,
      customer_phone: numero,
      customer_name: contexto.customer_name || contexto.nombre || 'Cliente',
      initial_message: contexto.initial_message || contexto.motivo || undefined,
    };
  } else {
    // Formato genérico para otras apps
    notificacion = {
      tipo: 'nueva_conversacion',
      numero: numero,
      contexto: contexto,
      desde_app: appAnterior,
      timestamp: new Date().toISOString(),
    };
  }

  const resultado = await enviarAApp(appDestino, notificacion);

  // Incrementar stats
  await redisService.incrementStats('transferencias');
  await redisService.incrementStats(`transferencias_${appAnterior}_to_${appDestino}`);
  transferencias.labels(appAnterior, appDestino).inc();

  return {
    anterior: appAnterior,
    nueva: appDestino,
    notificacion_enviada: resultado.success,
  };
}

/**
 * Finalizar conversación (volver al bot)
 * @param {string} numero - Número de teléfono
 * @returns {Promise<Object>}
 */
async function finalizar(numero) {
  const appAnterior = await redisService.getAppAsignada(numero);

  await redisService.clearAppAsignada(numero);

  logger.info(`🔚 Finalizado: ${numero} (era ${appAnterior})`);

  // Incrementar stats
  await redisService.incrementStats('finalizaciones');
  await redisService.incrementStats(`finalizaciones_${appAnterior}`);
  finalizaciones.inc();

  return {
    app_anterior: appAnterior,
    app_actual: 'bot',
  };
}

/**
 * Obtener estadísticas de circuit breakers
 * @returns {Array}
 */
function getCircuitBreakerStats() {
  const stats = [];

  for (const [appKey, breaker] of circuitBreakers.entries()) {
    const breakerStats = breaker.stats;
    stats.push({
      app: appKey,
      state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
      failures: breakerStats.failures,
      successes: breakerStats.successes,
      rejects: breakerStats.rejects,
      timeouts: breakerStats.timeouts,
      fires: breakerStats.fires,
    });
  }

  return stats;
}

module.exports = {
  enviarAApp,
  enrutarMensaje,
  transferir,
  finalizar,
  getCircuitBreakerStats,
};
