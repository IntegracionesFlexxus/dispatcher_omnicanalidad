const { RateLimiterMemory } = require('rate-limiter-flexible');
const config = require('../config');
const logger = require('../utils/logger');
const { rateLimitHits } = require('../utils/metrics');

/**
 * Rate Limiter - Limita requests por IP
 * Usa memoria por ahora, puede cambiarse a Redis para cluster
 */

// Rate limiter principal
const rateLimiter = new RateLimiterMemory({
  points: config.rateLimit.max, // Número de requests
  duration: config.rateLimit.windowMs / 1000, // Ventana en segundos
  blockDuration: 60, // Bloquear por 60 segundos si excede
});

/**
 * Middleware de rate limiting
 */
async function rateLimitMiddleware(req, res, next) {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (error) {
    logger.warn('⚠️  Rate limit excedido', {
      ip: req.ip,
      path: req.path,
    });

    rateLimitHits.labels(req.ip).inc();

    res.status(429).json({
      error: {
        message: 'Demasiadas solicitudes. Por favor, intenta más tarde.',
        statusCode: 429,
        retryAfter: Math.ceil(error.msBeforeNext / 1000),
      },
    });
  }
}

/**
 * Rate limiter más permisivo para webhooks
 */
const webhookRateLimiter = new RateLimiterMemory({
  points: 1000, // 1000 requests
  duration: 60, // por minuto
});

async function webhookRateLimitMiddleware(req, res, next) {
  try {
    await webhookRateLimiter.consume(req.ip);
    next();
  } catch (error) {
    logger.error('❌ Rate limit de webhook excedido', {
      ip: req.ip,
    });

    res.status(429).json({
      error: 'Demasiadas solicitudes de webhook',
    });
  }
}

module.exports = {
  rateLimitMiddleware,
  webhookRateLimitMiddleware,
};
