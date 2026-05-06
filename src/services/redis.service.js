const config = require('../config');
const logger = require('../utils/logger');
const { conversacionesActivas } = require('../utils/metrics');
const { normalizePhone } = require('../utils/phone');

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
  numero = normalizePhone(numero);
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
  numero = normalizePhone(numero);
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
  numero = normalizePhone(numero);
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
  numero = normalizePhone(numero);
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
  numero = normalizePhone(numero);
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
  numero = normalizePhone(numero);
  storage.set(`conversation:${numero}`, conversationId);
  logger.info(`💬 Conversation ID guardado: ${numero} → ${conversationId}`);
}

/**
 * Obtener conversation_id del asesor para un número
 * @param {string} numero - Número de teléfono
 * @returns {Promise<number|string|null>}
 */
async function getConversationId(numero) {
  numero = normalizePhone(numero);
  return storage.get(`conversation:${numero}`) || null;
}

/**
 * Limpiar conversation_id de un número
 * @param {string} numero - Número de teléfono
 */
async function clearConversationId(numero) {
  numero = normalizePhone(numero);
  storage.delete(`conversation:${numero}`);
}

/**
 * Guardar timestamp del último mensaje entrante de un número.
 * Se usa para determinar si la ventana de 24hs de WhatsApp está abierta.
 *
 * Importante: usar el timestamp REAL del mensaje (mensaje.timestamp del webhook
 * de Meta, en segundos epoch). Si Meta hace retry de un webhook viejo (puede
 * pasar hasta 7 días después), Date.now() haría parecer que la ventana está
 * abierta cuando en realidad ya está cerrada del lado de Meta.
 *
 * Solo avanzamos: si ya tenemos un timestamp más nuevo, lo conservamos para
 * que un retry tardío no nos retroceda.
 *
 * @param {string} numero - Número de teléfono
 * @param {number|string} [timestampSec] - Timestamp del mensaje en segundos epoch.
 *   Si no se pasa, se usa Date.now() (para llamadores que no tienen el dato).
 */
async function setUltimoMensajeEntrante(numero, timestampSec) {
  numero = normalizePhone(numero);
  const nuevoMs = timestampSec ? Number(timestampSec) * 1000 : Date.now();
  if (!Number.isFinite(nuevoMs) || nuevoMs <= 0) return;

  const actualMs = storage.get(`ultimo_mensaje:${numero}`) || 0;
  if (nuevoMs > actualMs) {
    storage.set(`ultimo_mensaje:${numero}`, nuevoMs);
  }
}

/**
 * Obtener timestamp del último mensaje entrante de un número
 * @param {string} numero - Número de teléfono
 * @returns {Promise<number|null>} Timestamp en ms o null
 */
async function getUltimoMensajeEntrante(numero) {
  numero = normalizePhone(numero);
  return storage.get(`ultimo_mensaje:${numero}`) || null;
}

/**
 * Verificar si la ventana de 24hs de WhatsApp está abierta para un número
 * Usa un margen de 23hs para evitar falsos positivos por delays
 * @param {string} numero - Número de teléfono
 * @returns {Promise<boolean>} true si la ventana está abierta
 */
async function isVentanaAbierta(numero) {
  const ultimo = await getUltimoMensajeEntrante(numero);
  if (!ultimo) return true; // Sin datos, asumir ventana abierta (dejar que Meta decida)

  const VENTANA_MS = 23 * 60 * 60 * 1000; // 23 horas en ms
  return (Date.now() - ultimo) < VENTANA_MS;
}

// ============================================================
// Side-track encuestador
// ------------------------------------------------------------
// El encuestador es un "detour" temporal: el routing principal
// (bot/asesor) NO se pisa cuando arranca una encuesta. Se guarda
// la encuesta como side-track con TTL propio y, cuando termina,
// el routing principal sigue siendo el mismo de antes.
// ============================================================

async function setSideTrackEncuesta(numero, ttl) {
  numero = normalizePhone(numero);
  storage.set(`sidetrack:${numero}`, 'encuestador');
  const expireTime = Date.now() + (ttl * 1000);
  expirations.set(`sidetrack:${numero}`, expireTime);
  logger.info(`📊 Side-track encuestador activado: ${numero} (TTL: ${ttl}s)`);
}

async function getSideTrackEncuesta(numero) {
  numero = normalizePhone(numero);
  const expireTime = expirations.get(`sidetrack:${numero}`);
  if (expireTime && Date.now() > expireTime) {
    storage.delete(`sidetrack:${numero}`);
    expirations.delete(`sidetrack:${numero}`);
    return null;
  }
  return storage.get(`sidetrack:${numero}`) || null;
}

async function clearSideTrackEncuesta(numero) {
  numero = normalizePhone(numero);
  storage.delete(`sidetrack:${numero}`);
  expirations.delete(`sidetrack:${numero}`);
  logger.info(`📊 Side-track encuestador limpiado: ${numero}`);
}

// ============================================================
// Cooldown post-encuesta
// ------------------------------------------------------------
// Tras finalizar una encuesta el dispatcher entra en modo
// "silencio" durante un TTL configurable: ignora mensajes
// entrantes para evitar que el bot dispare un saludo desde cero
// inmediatamente después de la encuesta.
// ============================================================

async function setPostEncuestaCooldown(numero, ttl) {
  numero = normalizePhone(numero);
  storage.set(`post_encuesta:${numero}`, true);
  const expireTime = Date.now() + (ttl * 1000);
  expirations.set(`post_encuesta:${numero}`, expireTime);
  logger.info(`🔇 Cooldown post-encuesta activado: ${numero} (TTL: ${ttl}s)`);
}

async function isPostEncuestaCooldown(numero) {
  numero = normalizePhone(numero);
  const expireTime = expirations.get(`post_encuesta:${numero}`);
  if (!expireTime) return false;
  if (Date.now() > expireTime) {
    storage.delete(`post_encuesta:${numero}`);
    expirations.delete(`post_encuesta:${numero}`);
    return false;
  }
  return true;
}

async function clearPostEncuestaCooldown(numero) {
  numero = normalizePhone(numero);
  storage.delete(`post_encuesta:${numero}`);
  expirations.delete(`post_encuesta:${numero}`);
}

// ============================================================
// Deduplicación de webhooks por wamid
// ------------------------------------------------------------
// Meta y/o el proxy delante del dispatcher pueden entregar el
// mismo webhook varias veces. Cacheamos los wamid procesados con
// TTL corto para descartar duplicados sin reenviarlos a las apps.
// ============================================================

async function isWamidProcessed(wamid) {
  if (!wamid) return false;
  const expireTime = expirations.get(`wamid:${wamid}`);
  if (!expireTime) return false;
  if (Date.now() > expireTime) {
    storage.delete(`wamid:${wamid}`);
    expirations.delete(`wamid:${wamid}`);
    return false;
  }
  return true;
}

async function markWamidProcessed(wamid, ttl) {
  if (!wamid) return;
  storage.set(`wamid:${wamid}`, true);
  const expireTime = Date.now() + (ttl * 1000);
  expirations.set(`wamid:${wamid}`, expireTime);
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
  setUltimoMensajeEntrante,
  getUltimoMensajeEntrante,
  isVentanaAbierta,
  setSideTrackEncuesta,
  getSideTrackEncuesta,
  clearSideTrackEncuesta,
  setPostEncuestaCooldown,
  isPostEncuestaCooldown,
  clearPostEncuestaCooldown,
  isWamidProcessed,
  markWamidProcessed,
};
