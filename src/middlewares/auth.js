const config = require('../config');
const logger = require('../utils/logger');
const { UnauthorizedError } = require('./errorHandler');

/**
 * Middleware de autenticación con API Key
 */

/**
 * Autenticar request con API Key
 * Si no hay API_KEY configurada, permite acceso (modo desarrollo)
 */
function authenticate(req, res, next) {
  // Si no hay API key configurada, permitir acceso
  if (!config.apiKey) {
    logger.debug('⚠️  No hay API Key configurada, permitiendo acceso');
    return next();
  }

  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey) {
    logger.warn('⚠️  Request sin API Key', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    throw new UnauthorizedError('API Key requerida');
  }

  if (apiKey !== config.apiKey) {
    logger.warn('⚠️  API Key inválida', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    throw new UnauthorizedError('API Key inválida');
  }

  // API Key válida
  logger.debug('✅ API Key válida');
  next();
}

/**
 * Middleware opcional de autenticación
 * Permite acceso sin autenticación, pero registra usuario si está autenticado
 */
function optionalAuth(req, res, next) {
  if (!config.apiKey) {
    return next();
  }

  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (apiKey && apiKey === config.apiKey) {
    req.authenticated = true;
  } else {
    req.authenticated = false;
  }

  next();
}

module.exports = {
  authenticate,
  optionalAuth,
};
