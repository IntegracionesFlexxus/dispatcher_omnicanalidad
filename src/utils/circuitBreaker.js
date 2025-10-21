const CircuitBreaker = require('opossum');
const logger = require('./logger');
const config = require('../config');

/**
 * Circuit Breaker genérico para proteger llamadas a servicios externos
 * Evita llamar a servicios que están fallando repetidamente
 */

/**
 * Crear un circuit breaker para una función
 * @param {Function} fn - Función a proteger
 * @param {Object} options - Opciones del circuit breaker
 * @returns {CircuitBreaker}
 */
function createBreaker(fn, options = {}) {
  const breakerOptions = {
    timeout: options.timeout || config.circuitBreaker.timeout,
    errorThresholdPercentage: options.errorThresholdPercentage || config.circuitBreaker.errorThresholdPercentage,
    resetTimeout: options.resetTimeout || config.circuitBreaker.resetTimeout,
    name: options.name || 'unnamed-breaker',
    ...options,
  };

  const breaker = new CircuitBreaker(fn, breakerOptions);

  // Eventos del circuit breaker
  breaker.on('open', () => {
    logger.warn(`🔴 Circuit breaker ABIERTO: ${breakerOptions.name}`);
  });

  breaker.on('halfOpen', () => {
    logger.info(`🟡 Circuit breaker MEDIO ABIERTO: ${breakerOptions.name}`);
  });

  breaker.on('close', () => {
    logger.info(`🟢 Circuit breaker CERRADO: ${breakerOptions.name}`);
  });

  breaker.on('timeout', () => {
    logger.warn(`⏱️  Timeout en circuit breaker: ${breakerOptions.name}`);
  });

  breaker.on('reject', () => {
    logger.warn(`❌ Llamada rechazada por circuit breaker: ${breakerOptions.name}`);
  });

  return breaker;
}

/**
 * Crear circuit breaker con fallback
 * @param {Function} fn - Función principal
 * @param {Function} fallbackFn - Función de fallback
 * @param {Object} options - Opciones
 * @returns {CircuitBreaker}
 */
function createBreakerWithFallback(fn, fallbackFn, options = {}) {
  const breaker = createBreaker(fn, options);

  breaker.fallback(fallbackFn);

  breaker.on('fallback', (result) => {
    logger.info(`🔄 Fallback ejecutado para: ${options.name || 'unnamed'}`);
  });

  return breaker;
}

/**
 * Obtener estadísticas del circuit breaker
 * @param {CircuitBreaker} breaker
 * @returns {Object}
 */
function getBreakerStats(breaker) {
  const stats = breaker.stats;
  return {
    name: breaker.name,
    state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
    failures: stats.failures,
    successes: stats.successes,
    rejects: stats.rejects,
    timeouts: stats.timeouts,
    fires: stats.fires,
    percentiles: {
      p50: stats.latencyMean,
      p95: stats.percentiles['0.95'],
      p99: stats.percentiles['0.99'],
    },
  };
}

module.exports = {
  createBreaker,
  createBreakerWithFallback,
  getBreakerStats,
};
