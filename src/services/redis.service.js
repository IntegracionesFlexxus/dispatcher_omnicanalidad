const config = require('../config');
const logger = require('../utils/logger');
const { conversacionesActivas } = require('../utils/metrics');

/**
 * Servicio de almacenamiento EN MEMORIA (sin Redis)
 * Los datos se pierden al reiniciar el servidor
 *
 * Para producción con persistencia, instalar Redis y usar redis.service.real.js
 */

// Almacenamiento en memoria
const storage = new Map();
const stats = new Map();
const expirations = new Map();

let isConnected = false;

/**
 * Conectar (solo simula conexión)
 */
async function connect() {
  try {
    isConnected = true;
    logger.info('✅ Almacenamiento en MEMORIA iniciado (sin Redis)');
    logger.warn('⚠️  Los datos se perderán al reiniciar el servidor');
    logger.warn('⚠️  Para persistencia, instalar Redis');
    return true;
  } catch (error) {
    logger.error('❌ Error iniciando almacenamiento:', error);
    throw error;
  }
}

/**
 * Desconectar
 */
async function disconnect() {
  storage.clear();
  stats.clear();
  expirations.clear();
  isConnected = false;
  logger.info('👋 Almacenamiento desconectado');
}

/**
 * Verificar si está conectado
 */
function isRedisConnected() {
  return isConnected;
}

/**
 * Obtener aplicación asignada a un número
 * @param {string} numero - Número de teléfono
 * @returns {Promise<string>} App key (default: 'bot')
 */
async function getAppAsignada(numero) {
  try {
    // Verificar si expiró
    const expireTime = expirations.get(`routing:${numero}`);
    if (expireTime && Date.now() > expireTime) {
      storage.delete(`routing:${numero}`);
      expirations.delete(`routing:${numero}`);
      return 'bot';
    }

    const app = storage.get(`routing:${numero}`);
    return app || 'bot';
  } catch (error) {
    logger.error('Error obteniendo app asignada:', { numero, error: error.message });
    return 'bot';
  }
}

/**
 * Asignar aplicación a un número
 * @param {string} numero - Número de teléfono
 * @param {string} app - App key
 * @param {number} ttl - TTL en segundos (default: 86400 = 24 horas)
 */
async function setAppAsignada(numero, app, ttl = 86400) {
  try {
    storage.set(`routing:${numero}`, app);

    // Simular TTL (expiración)
    const expireTime = Date.now() + (ttl * 1000);
    expirations.set(`routing:${numero}`, expireTime);

    logger.info(`📍 Routing: ${numero} → ${app} (TTL: ${ttl}s)`);
  } catch (error) {
    logger.error('Error asignando app:', { numero, app, error: error.message });
    throw error;
  }
}

/**
 * Eliminar asignación (volver al bot)
 * @param {string} numero - Número de teléfono
 */
async function clearAppAsignada(numero) {
  try {
    storage.delete(`routing:${numero}`);
    expirations.delete(`routing:${numero}`);
    logger.info(`🧹 Routing limpiado: ${numero} → bot`);
  } catch (error) {
    logger.error('Error limpiando routing:', { numero, error: error.message });
    throw error;
  }
}

/**
 * Incrementar contador de estadísticas
 * @param {string} key - Clave de estadística
 */
async function incrementStats(key) {
  try {
    const current = stats.get(key) || 0;
    stats.set(key, current + 1);
  } catch (error) {
    logger.error('Error incrementando stats:', { key, error: error.message });
  }
}

/**
 * Obtener estadísticas
 * @returns {Promise<Object>}
 */
async function getStats() {
  try {
    const result = {};
    stats.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  } catch (error) {
    logger.error('Error obteniendo stats:', { error: error.message });
    return {};
  }
}

/**
 * Obtener todas las conversaciones activas
 * @returns {Promise<Array>}
 */
async function getAllRoutings() {
  try {
    const routings = [];
    const now = Date.now();

    storage.forEach((app, key) => {
      if (key.startsWith('routing:')) {
        const numero = key.replace('routing:', '');
        const expireTime = expirations.get(key);

        // Solo incluir si no ha expirado
        if (!expireTime || now <= expireTime) {
          const ttl = expireTime ? Math.floor((expireTime - now) / 1000) : -1;

          routings.push({
            numero,
            app,
            expira_en: ttl,
          });
        } else {
          // Limpiar expirados
          storage.delete(key);
          expirations.delete(key);
        }
      }
    });

    // Actualizar métrica
    conversacionesActivas.set(routings.length);

    return routings;
  } catch (error) {
    logger.error('Error obteniendo routings:', { error: error.message });
    return [];
  }
}

/**
 * Obtener estado del bot para un número específico
 * @param {string} numero - Número de teléfono
 * @returns {Promise<{activo: boolean, desactivado_en: string|null, motivo: string|null}>}
 */
async function getBotEstado(numero) {
  const data = storage.get(`bot:desactivado:${numero}`);
  if (!data) {
    return { activo: true, desactivado_en: null, motivo: null };
  }
  return data;
}

/**
 * Guardar estado del bot para un número específico
 * @param {string} numero - Número de teléfono
 * @param {Object} estado - { activo, desactivado_en, motivo }
 */
async function setBotEstado(numero, estado) {
  if (estado.activo) {
    storage.delete(`bot:desactivado:${numero}`);
  } else {
    storage.set(`bot:desactivado:${numero}`, estado);
  }
  logger.info(`🤖 Bot estado para ${numero}: ${estado.activo ? 'ACTIVO' : 'DESACTIVADO'}`);
}

/**
 * Obtener todos los números con bot desactivado
 * @returns {Promise<Array>}
 */
async function getAllBotDesactivados() {
  const desactivados = [];
  storage.forEach((data, key) => {
    if (key.startsWith('bot:desactivado:')) {
      const numero = key.replace('bot:desactivado:', '');
      desactivados.push({ numero, ...data });
    }
  });
  return desactivados;
}

/**
 * Guardar conversation_id del asesor para un número
 * @param {string} numero - Número de teléfono
 * @param {number|string} conversationId - ID de conversación del asesor
 */
async function setConversationId(numero, conversationId) {
  storage.set(`conversation:${numero}`, conversationId);
  logger.info(`💬 Conversation ID guardado: ${numero} → ${conversationId}`);
}

/**
 * Obtener conversation_id del asesor para un número
 * @param {string} numero - Número de teléfono
 * @returns {Promise<number|string|null>}
 */
async function getConversationId(numero) {
  return storage.get(`conversation:${numero}`) || null;
}

/**
 * Limpiar conversation_id de un número
 * @param {string} numero - Número de teléfono
 */
async function clearConversationId(numero) {
  storage.delete(`conversation:${numero}`);
}

/**
 * Health check
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  return isConnected;
}

/**
 * Obtener cliente (no disponible en modo memoria)
 */
function getClient() {
  return null;
}

module.exports = {
  connect,
  disconnect,
  isRedisConnected,
  getAppAsignada,
  setAppAsignada,
  clearAppAsignada,
  incrementStats,
  getStats,
  getAllRoutings,
  getBotEstado,
  setBotEstado,
  getAllBotDesactivados,
  healthCheck,
  getClient,
  setConversationId,
  getConversationId,
  clearConversationId,
};
