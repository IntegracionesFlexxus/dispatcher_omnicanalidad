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

      // Si el bot está desactivado, reenviar al asesor
      const botEstado = await redisService.getBotEstado(numero);
      if (!botEstado.activo && config.apps['asesor']) {
        logger.warn(`⏸️  [enrutarMensaje] Bot DESACTIVADO para ${numero}, reenviando al asesor (fallback)`);
        const mensaje = require('./whatsapp.service').extraerMensaje(body);
        const payload = {
          channel_id: config.asesor?.channelId || 1,
          customer_phone: numero,
          customer_name: mensaje?.profile_name || 'Cliente',
          message: mensaje?.text || '',
          message_type: mensaje?.type || 'text',
          raw_webhook: body,
        };
        const resultado = await enviarAApp('asesor', payload);
        return {
          appKey: 'asesor',
          appNombre: config.apps['asesor'].nombre,
          resultado,
          fallback: true,
          bot_desactivado: true,
          redirigido: true,
        };
      }

      // Fallback al bot
      const fallbackResult = await enviarAApp('bot', body);
      return {
        appKey: 'bot',
        appNombre: config.apps['bot']?.nombre || 'BOT',
        resultado: fallbackResult,
        fallback: true,
      };
    }

    // Si el bot está desactivado, reenviar al asesor en vez de descartar
    if (appKey === 'bot') {
      const botEstado = await redisService.getBotEstado(numero);
      if (!botEstado.activo) {
        logger.warn(`⏸️  [enrutarMensaje] Bot DESACTIVADO para ${numero}, reenviando al asesor`);
        await redisService.incrementStats('mensajes_bot_desactivado');

        if (config.apps['asesor']) {
          const mensaje = require('./whatsapp.service').extraerMensaje(body);
          const conversationId = await redisService.getConversationId(numero);
          const payload = {
            channel_id: config.asesor?.channelId || 1,
            customer_phone: numero,
            customer_name: mensaje?.profile_name || 'Cliente',
            message: mensaje?.text || '',
            message_type: mensaje?.type || 'text',
            raw_webhook: body,
          };
          if (conversationId) {
            payload.conversation_id = conversationId;
          }
          logger.info(`📋 [enrutarMensaje] Reenviando a asesor (conv: ${conversationId || 'nueva'}): ${JSON.stringify(payload, null, 2)}`);
          const resultado = await enviarAApp('asesor', payload);
          // Guardar conversation_id si el asesor lo devuelve
          if (resultado.data?.conversation_id && !conversationId) {
            await redisService.setConversationId(numero, resultado.data.conversation_id);
          }
          return {
            appKey: 'asesor',
            appNombre: config.apps['asesor'].nombre,
            resultado,
            bot_desactivado: true,
            redirigido: true,
          };
        }
      }
    }

    logger.info(`✓ [enrutarMensaje] App encontrada: ${app.nombre} (${appKey})`);
    logger.info(`🎯 [enrutarMensaje] Enviando a: ${app.url}`);

    // Transformar payload para asesor (espera channel_id, customer_phone, customer_name)
    let payload = body;
    if (appKey === 'asesor') {
      const mensaje = require('./whatsapp.service').extraerMensaje(body);
      const conversationId = await redisService.getConversationId(numero);
      payload = {
        channel_id: config.asesor?.channelId || 1,
        customer_phone: numero,
        customer_name: mensaje?.profile_name || 'Cliente',
        message: mensaje?.text || '',
        message_type: mensaje?.type || 'text',
        raw_webhook: body,
      };
      if (conversationId) {
        payload.conversation_id = conversationId;
      }
      logger.info(`📋 [enrutarMensaje] Payload transformado para asesor (conv: ${conversationId || 'nueva'}): ${JSON.stringify(payload, null, 2)}`);
    }

    // Enviar a la app
    const resultado = await enviarAApp(appKey, payload);

    // Guardar conversation_id si el asesor lo devuelve
    if (appKey === 'asesor' && resultado.data?.conversation_id) {
      const existingConvId = await redisService.getConversationId(numero);
      if (!existingConvId) {
        await redisService.setConversationId(numero, resultado.data.conversation_id);
      }
    }

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
      // Si el bot está desactivado, reenviar al asesor
      const botEstado = await redisService.getBotEstado(numero);
      if (!botEstado.activo && config.apps['asesor']) {
        logger.warn(`⏸️  [enrutarMensaje] Bot DESACTIVADO para ${numero}, reenviando al asesor (error fallback)`);
        const mensaje = require('./whatsapp.service').extraerMensaje(body);
        const payload = {
          channel_id: config.asesor?.channelId || 1,
          customer_phone: numero,
          customer_name: mensaje?.profile_name || 'Cliente',
          message: mensaje?.text || '',
          message_type: mensaje?.type || 'text',
          raw_webhook: body,
        };
        const resultado = await enviarAApp('asesor', payload);
        return {
          appKey: 'asesor',
          appNombre: config.apps['asesor'].nombre,
          resultado,
          error: error.message,
          bot_desactivado: true,
          redirigido: true,
        };
      }

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

  // Guardar conversation_id si el asesor lo devuelve
  if (appDestino === 'asesor' && resultado.data?.conversation_id) {
    await redisService.setConversationId(numero, resultado.data.conversation_id);
  }

  return {
    anterior: appAnterior,
    nueva: appDestino,
    notificacion_enviada: resultado.success,
    conversation_id: resultado.data?.conversation_id || null,
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
  await redisService.clearConversationId(numero);

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
 * Desactivar bot temporalmente para un número
 * @param {string} numero - Número de teléfono
 * @param {string} motivo - Motivo de la desactivación
 * @returns {Promise<Object>}
 */
async function desactivarBot(numero, motivo = '', conversationId = null) {
  const estadoActual = await redisService.getBotEstado(numero);

  if (!estadoActual.activo) {
    return { ya_desactivado: true, numero, desactivado_en: estadoActual.desactivado_en };
  }

  const estado = {
    activo: false,
    desactivado_en: new Date().toISOString(),
    motivo: motivo || null,
  };

  await redisService.setBotEstado(numero, estado);

  // Si el asesor pasa conversation_id, guardarlo para los mensajes siguientes
  if (conversationId) {
    await redisService.setConversationId(numero, conversationId);
    logger.info(`💬 Conversation ID asociado: ${numero} → ${conversationId}`);
  }

  logger.info(`🔴 Bot DESACTIVADO para ${numero}. Motivo: ${motivo || 'No especificado'}`);

  return { numero, ...estado, conversation_id: conversationId };
}

/**
 * Activar bot para un número
 * @param {string} numero - Número de teléfono
 * @returns {Promise<Object>}
 */
async function activarBot(numero) {
  const estadoAnterior = await redisService.getBotEstado(numero);

  const estado = {
    activo: true,
    desactivado_en: null,
    motivo: null,
  };

  await redisService.setBotEstado(numero, estado);
  logger.info(`🟢 Bot ACTIVADO para ${numero}`);

  return {
    numero,
    ...estado,
    estuvo_desactivado_desde: estadoAnterior.desactivado_en,
  };
}

/**
 * Obtener estado del bot para un número
 * @param {string} numero - Número de teléfono
 * @returns {Promise<Object>}
 */
async function getEstadoBot(numero) {
  const estado = await redisService.getBotEstado(numero);
  return { numero, ...estado };
}

/**
 * Obtener todos los números con bot desactivado
 * @returns {Promise<Array>}
 */
async function getBotDesactivados() {
  return await redisService.getAllBotDesactivados();
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
  desactivarBot,
  activarBot,
  getEstadoBot,
  getBotDesactivados,
  getCircuitBreakerStats,
};
