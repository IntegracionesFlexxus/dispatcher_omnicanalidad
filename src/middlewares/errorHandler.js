const logger = require('../utils/logger');
const config = require('../config');

/**
 * Clase de error personalizada para errores operacionales
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Errores específicos
 */
class ValidationError extends AppError {
  constructor(message) {
    super(message, 400, true);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 404, true);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, 401, true);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Prohibido') {
    super(message, 403, true);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflicto') {
    super(message, 409, true);
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Servicio no disponible') {
    super(message, 503, true);
  }
}

/**
 * Middleware de manejo de errores global
 */
function errorHandler(err, req, res, next) {
  // Default values
  err.statusCode = err.statusCode || 500;
  err.isOperational = err.isOperational !== undefined ? err.isOperational : false;

  // Log error
  if (err.statusCode >= 500) {
    logger.error('❌ Error del servidor:', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
      requestId: req.id,
    });
  } else {
    logger.warn('⚠️  Error del cliente:', {
      error: err.message,
      url: req.url,
      method: req.method,
      statusCode: err.statusCode,
    });
  }

  // Respuesta según entorno
  if (config.isDevelopment()) {
    // Desarrollo: devolver detalles completos
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        statusCode: err.statusCode,
        stack: err.stack,
        name: err.name,
      },
    });
  }

  // Producción: distinguir entre errores operacionales y de programación
  if (err.isOperational) {
    // Error operacional (ej: validación, recurso no encontrado)
    // Es seguro exponer al cliente
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    });
  }

  // Error de programación o desconocido
  // No exponer detalles al cliente
  return res.status(500).json({
    error: {
      message: 'Error interno del servidor',
      statusCode: 500,
    },
  });
}

/**
 * Middleware para rutas no encontradas (404)
 */
function notFoundHandler(req, res, next) {
  const error = new NotFoundError(`Ruta ${req.method} ${req.path} no encontrada`);
  next(error);
}

/**
 * Wrapper para funciones async en rutas
 * Atrapa errores automáticamente y los pasa al error handler
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ServiceUnavailableError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
};
