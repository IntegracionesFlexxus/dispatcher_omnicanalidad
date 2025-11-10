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

      // Fallback al bot
      const fallbackResult = await enviarAApp('bot', body);
      return {
        appKey: 'bot',
        appNombre: config.apps['bot']?.nombre || 'BOT',
        resultado: fallbackResult,
        fallback: true,
      };
    }

    // Transformar body si es asesor
    let payload = body;
    if (appKey === 'asesor') {
      const mensaje = whatsappService.extraerMensaje(body);
      if (mensaje) {
        payload = {
          channel_id: config.asesor?.channelId || 1,
          customer_phone: mensaje.from,
          customer_name: mensaje.profile_name || 'Cliente',
          initial_message: mensaje.text,
        };
        logger.info(logBox('Transformación para Asesor', {
          'Número': mensaje.from,
          'Nombre': mensaje.profile_name,
          'Mensaje': mensaje.text?.substring(0, 50) + '...',
          'Channel ID': config.asesor?.channelId || 1,
        }, 'info'));
      }
    }

    // Enviar a la app
    const resultado = await enviarAApp(appKey, payload);

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

  logger.info(logBox('Transferencia Completada', {
    'Número': numero,
    'De': appAnterior,
    'A': appDestino,
    'Notificación enviada': resultado.success ? 'Sí' : 'No',
    'Status': resultado.status || 'N/A',
  }, 'success'));

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

  logger.info(logFinalization(numero, appAnterior, false));

  await redisService.clearAppAsignada(numero);

  // Si venía del asesor, desactivar modo asesor en el bot
  if (appAnterior === 'asesor') {
    try {
      const botApp = config.apps['bot'];
      if (!botApp) {
        logger.warn(logBox('Bot no configurado', {
          'Número': numero,
          'Acción': 'No se puede desactivar modo asesor',
          'Razón': 'App BOT no encontrada en configuración',
        }, 'warning'));
      } else {
        // Extraer base URL del bot (quitar /webhook si existe)
        const baseUrl = botApp.url.replace(/\/webhook\/?$/, '');
        const desactivarUrl = `${baseUrl}/api/desactivar-modo-asesor`;

        logger.info(logBox('Desactivando Modo Asesor en Bot', {
          'Número': numero,
          'URL': desactivarUrl,
          'Timeout': '5000ms',
        }, 'info'));

        const startTime = Date.now();
        const response = await axios.post(
          desactivarUrl,
          { celular: numero },
          {
            timeout: 5000,
            headers: {
              'Content-Type': 'application/json',
            },
            validateStatus: (status) => status < 500,
          }
        );

        const duration = Date.now() - startTime;

        if (response.status >= 200 && response.status < 300) {
          logger.info(logBox('Modo Asesor Desactivado', {
            'Número': numero,
            'Status': response.status,
            'Duración': `${duration}ms`,
            'Respuesta': response.data?.message || JSON.stringify(response.data),
          }, 'success'));
        } else {
          logger.warn(logBox('Bot respondió con error', {
            'Número': numero,
            'Status': response.status,
            'Duración': `${duration}ms`,
            'Respuesta': JSON.stringify(response.data),
          }, 'warning'));
        }
      }
    } catch (error) {
      // No fallar la finalización si falla la desactivación del modo asesor
      logger.error(logBox('Error desactivando modo asesor', {
        'Número': numero,
        'Error': error.message,
        'Código': error.code || 'N/A',
        'Tipo': error.code === 'ETIMEDOUT' ? 'TIMEOUT - Bot no responde' : error.code === 'ECONNREFUSED' ? 'Bot no disponible' : 'Error de red',
        'Nota': 'La conversación fue finalizada en Redis correctamente',
      }, 'error'));
    }
  }

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
