const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const redisService = require('./redis.service');
const whatsappService = require('./whatsapp.service');
const { createBreaker } = require('../utils/circuitBreaker');
const { mensajesRecibidos, transferencias, finalizaciones, erroresApps } = require('../utils/metrics');
const {
  logBox,
  logHttpRequest,
  logHttpResponse,
  logRouting,
  logTransfer,
  logFinalization,
  logOperationError,
} = require('../utils/logHelper');

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
  const startTime = Date.now();

  logger.info(logBox('Envío a Aplicación', {
    'App': appKey.toUpperCase(),
    'Operación': 'Preparando envío',
  }, 'info'));

  const app = config.apps[appKey];

  if (!app) {
    logger.error(logBox('Error - App no encontrada', {
      'App solicitada': appKey,
      'Apps disponibles': Object.keys(config.apps).join(', '),
    }, 'error'));
    return { error: 'App no encontrada', appKey };
  }

  const url = app.url;

  // Headers adicionales según la app
  const extraHeaders = {};
  if (appKey === 'asesor' && config.asesor?.apiKey) {
    extraHeaders['X-API-Key'] = config.asesor.apiKey;
  }

  logger.info(logHttpRequest('POST', url, body));

  const breaker = getCircuitBreaker(appKey);

  try {
    const response = await breaker.fire(url, body, extraHeaders);
    const duration = Date.now() - startTime;

    if (response.status >= 200 && response.status < 300) {
      logger.info(logHttpResponse(response.status, response.data, duration));
      logger.info(logBox('Respuesta Exitosa', {
        'App': app.nombre,
        'Status': response.status,
        'Duración': `${duration}ms`,
        'Preview': JSON.stringify(response.data).substring(0, 100) + '...',
      }, 'success'));

      return {
        success: true,
        status: response.status,
        data: response.data,
      };
    } else if (response.status >= 400 && response.status < 500) {
      logger.warn(logBox('Error del Cliente (4xx)', {
        'App': app.nombre,
        'Status': response.status,
        'Tipo': 'Client error',
        'Data': JSON.stringify(response.data),
      }, 'warning'));

      return {
        success: false,
        status: response.status,
        error: 'Client error',
        data: response.data,
      };
    } else {
      logger.error(logBox('Error del Servidor (5xx)', {
        'App': app.nombre,
        'Status': response.status,
        'Tipo': 'Server error',
      }, 'error'));

      erroresApps.labels(appKey, 'server_error').inc();
      return {
        success: false,
        status: response.status,
        error: 'Server error',
      };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    let errorType = 'unknown';
    let errorMessage = error.message;

    if (error.code === 'ECONNREFUSED') {
      errorType = 'connection_refused';
      errorMessage = 'App no disponible';
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      errorType = 'timeout';
      errorMessage = `Timeout después de ${duration}ms`;
    } else if (error.message.includes('breaker is open')) {
      errorType = 'circuit_open';
      errorMessage = 'Circuit breaker abierto';
    } else {
      errorType = 'network_error';
    }

    logger.error(logBox('Error de Conexión', {
      'App': app.nombre,
      'URL': url,
      'Tipo error': errorType,
      'Mensaje': errorMessage,
      'Código': error.code || 'N/A',
      'Duración': `${duration}ms`,
    }, 'error'));

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
  try {
    // Obtener app asignada desde Redis
    const appKey = await redisService.getAppAsignada(numero);

    logger.info(logRouting(numero, null, appKey, 'Routing desde Redis'));

    const app = config.apps[appKey];

    if (!app) {
      logger.warn(logBox('App no configurada - Fallback', {
        'Número': numero,
        'App asignada': appKey,
        'Apps disponibles': Object.keys(config.apps).join(', '),
        'Acción': 'Redirigiendo a BOT',
      }, 'warning'));

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
            message: mensaje?.caption || mensaje?.text || null,
            message_type: mensaje?.type || 'text',
            media_id: mensaje?.media_id || null,
            mime_type: mensaje?.mime_type || null,
            filename: mensaje?.filename || null,
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
        message: mensaje?.caption || mensaje?.text || null,
        message_type: mensaje?.type || 'text',
        media_id: mensaje?.media_id || null,
        mime_type: mensaje?.mime_type || null,
        filename: mensaje?.filename || null,
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

    logger.info(logBox('Enrutamiento Completado', {
      'Número': numero,
      'App': app.nombre,
      'Éxito': resultado.success ? 'Sí' : 'No',
      'Status': resultado.status || 'N/A',
    }, 'success'));

    return {
      appKey,
      appNombre: app.nombre,
      resultado,
    };
  } catch (error) {
    logger.error(logOperationError('Enrutar Mensaje', error, {
      'Número': numero,
    }));

    // Intentar fallback al bot
    logger.warn(logBox('Activando Fallback', {
      'Número': numero,
      'Razón': 'Error en enrutamiento principal',
      'Error': error.message,
    }, 'warning'));

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
      logger.info('✅ Fallback al BOT exitoso');
      return {
        appKey: 'bot',
        appNombre: 'BOT (fallback)',
        resultado: fallbackResult,
        error: error.message,
      };
    } catch (fallbackError) {
      logger.error(logBox('Fallback Falló', {
        'Número': numero,
        'Error original': error.message,
        'Error fallback': fallbackError.message,
      }, 'error'));

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

  logger.info(logTransfer(numero, appAnterior, appDestino, contexto));

  // Cambiar routing en Redis
  await redisService.setAppAsignada(numero, appDestino);

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

    logger.info(logBox('Notificación a Asesor', {
      'Channel ID': config.asesor?.channelId || 1,
      'Teléfono': numero,
      'Nombre': contexto.customer_name || contexto.nombre || 'Cliente',
      'Mensaje inicial': contexto.initial_message || contexto.motivo || 'N/A',
    }, 'info'));
  } else {
    // Formato genérico para otras apps
    notificacion = {
      tipo: 'nueva_conversacion',
      numero: numero,
      contexto: contexto,
      desde_app: appAnterior,
      timestamp: new Date().toISOString(),
    };

    logger.info(logBox('Notificación Genérica', {
      'Tipo': 'nueva_conversacion',
      'Número': numero,
      'Desde': appAnterior,
      'Contexto': Object.keys(contexto).length > 0 ? 'Sí' : 'No',
    }, 'info'));
  }

  const resultado = await enviarAApp(appDestino, notificacion);

  // Si transferimos al asesor, desactivar el bot
  if (appDestino === 'asesor') {
    try {
      const botApp = config.apps['bot'];
      if (botApp) {
        const baseUrl = botApp.url.replace(/\/webhook\/?$/, '');
        const desactivarUrl = `${baseUrl}/api/desactivar-modo-asesor`;

        logger.info(logBox('Desactivando Bot para Modo Asesor', {
          'Número': numero,
          'URL': desactivarUrl,
        }, 'info'));

        const response = await axios.post(
          desactivarUrl,
          { celular: numero },
          {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: (status) => status < 500,
          }
        );

        if (response.status >= 200 && response.status < 300) {
          logger.info(logBox('Bot Desactivado', {
            'Número': numero,
            'Status': response.status,
          }, 'success'));
        } else {
          logger.warn(logBox('Bot respondió con error', {
            'Número': numero,
            'Status': response.status,
          }, 'warning'));
        }
      }
    } catch (error) {
      logger.error(logBox('Error desactivando bot', {
        'Número': numero,
        'Error': error.message,
        'Nota': 'La transferencia se completó correctamente',
      }, 'error'));
    }
  }

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

  logger.info(logFinalization(numero, appAnterior, false));

  await redisService.clearAppAsignada(numero);
  await redisService.clearConversationId(numero);
  await redisService.setBotEstado(numero, { activo: true, desactivado_en: null, motivo: null });

  // Si venía del asesor, desactivar modo asesor en el bot
  if (appAnterior === 'asesor') {
    try {
      const botApp = config.apps['bot'];
      if (botApp) {
        const baseUrl = botApp.url.replace(/\/webhook\/?$/, '');
        const desactivarUrl = `${baseUrl}/api/desactivar-modo-asesor`;

        logger.info(`🔄 Desactivando modo asesor en bot para ${numero} → ${desactivarUrl}`);

        const response = await axios.post(
          desactivarUrl,
          { celular: numero },
          {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: (status) => status < 500,
          }
        );

        if (response.status >= 200 && response.status < 300) {
          logger.info(`✅ Modo asesor desactivado en bot para ${numero} (${response.status})`);
        } else {
          logger.warn(`⚠️  Bot respondió ${response.status} al desactivar modo asesor para ${numero}`);
        }
      } else {
        logger.warn(`⚠️  App BOT no configurada, no se puede desactivar modo asesor`);
      }
    } catch (error) {
      // No fallar la finalización si falla la desactivación del modo asesor
      logger.error(`❌ Error desactivando modo asesor para ${numero}: ${error.message} (finalización en Redis fue exitosa)`);
    }
  }

  logger.info(`🔚 Finalizado: ${numero} (era ${appAnterior}) - Bot reactivado`);

  // Incrementar stats
  await redisService.incrementStats('finalizaciones');
  await redisService.incrementStats(`finalizaciones_${appAnterior}`);
  finalizaciones.inc();

  logger.info(logBox('Finalización Completada', {
    'Número': numero,
    'App anterior': appAnterior,
    'App actual': 'bot',
    'Redis limpiado': 'Sí',
  }, 'success'));

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
