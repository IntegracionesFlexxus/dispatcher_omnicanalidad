const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Middleware para logging de requests HTTP
 */

/**
 * Agregar ID único a cada request
 */
function addRequestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}

/**
 * Logger de requests HTTP
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Crear logger con contexto
  req.logger = logger.child({
    requestId: req.id,
  });

  // Log inicial del request
  req.logger.info('→ Request entrante', {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Interceptar el fin del response
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    const logData = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      requestId: req.id,
    };

    // Log según status code
    if (res.statusCode >= 500) {
      req.logger.error('← Response (server error)', logData);
    } else if (res.statusCode >= 400) {
      req.logger.warn('← Response (client error)', logData);
    } else {
      req.logger.info('← Response', logData);
    }
  });

  next();
}

/**
 * Logger específico para webhooks
 */
function webhookLogger(req, res, next) {
  // Solo loggear body en desarrollo para webhooks
  if (req.path.includes('/webhook')) {
    logger.debug('📨 Webhook recibido', {
      body: JSON.stringify(req.body),
      headers: req.headers,
      requestId: req.id,
    });
  }

  next();
}

module.exports = {
  addRequestId,
  requestLogger,
  webhookLogger,
};
