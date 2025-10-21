const logger = require('./logger');

/**
 * Utilidad de retry con exponential backoff
 * Para operaciones que pueden fallar temporalmente
 */

/**
 * Sleep/delay helper
 * @param {number} ms - Milisegundos a esperar
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry con exponential backoff
 * @param {Function} fn - Función asíncrona a reintentar
 * @param {Object} options - Opciones de retry
 * @param {number} options.maxRetries - Número máximo de reintentos (default: 3)
 * @param {number} options.delay - Delay inicial en ms (default: 1000)
 * @param {number} options.factor - Factor de multiplicación del delay (default: 2)
 * @param {number} options.maxDelay - Delay máximo en ms (default: 30000)
 * @param {Function} options.shouldRetry - Función que determina si se debe reintentar (default: siempre true)
 * @param {string} options.operation - Nombre de la operación (para logs)
 * @returns {Promise} Resultado de la función
 */
async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    delay = 1000,
    factor = 2,
    maxDelay = 30000,
    shouldRetry = () => true,
    operation = 'operación',
  } = options;

  let lastError;
  let currentDelay = delay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();

      if (attempt > 1) {
        logger.info(`✅ ${operation} exitosa en intento ${attempt}/${maxRetries}`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // Si es el último intento o no debemos reintentar, lanzar error
      if (attempt === maxRetries || !shouldRetry(error)) {
        logger.error(`❌ ${operation} falló después de ${attempt} intentos:`, {
          error: error.message,
          stack: error.stack,
        });
        throw error;
      }

      // Calcular delay con exponential backoff
      const waitTime = Math.min(currentDelay, maxDelay);

      logger.warn(`⚠️  ${operation} falló (intento ${attempt}/${maxRetries}), reintentando en ${waitTime}ms...`, {
        error: error.message,
      });

      await sleep(waitTime);
      currentDelay *= factor;
    }
  }

  throw lastError;
}

/**
 * Retry solo para errores específicos
 * @param {Function} fn - Función a ejecutar
 * @param {Array<string>} retryableErrors - Array de códigos de error a reintentar
 * @param {Object} options - Opciones de retry
 * @returns {Promise}
 */
async function retryOnErrors(fn, retryableErrors = [], options = {}) {
  return retry(fn, {
    ...options,
    shouldRetry: (error) => {
      // Reintentar si el código del error está en la lista
      return retryableErrors.includes(error.code) || retryableErrors.includes(error.name);
    },
  });
}

/**
 * Retry para errores de red
 * @param {Function} fn - Función a ejecutar
 * @param {Object} options - Opciones
 * @returns {Promise}
 */
async function retryOnNetworkError(fn, options = {}) {
  const networkErrors = [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNRESET',
    'EPIPE',
    'EHOSTUNREACH',
    'EAI_AGAIN',
  ];

  return retryOnErrors(fn, networkErrors, options);
}

module.exports = {
  retry,
  retryOnErrors,
  retryOnNetworkError,
  sleep,
};
