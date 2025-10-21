const { ValidationError } = require('./errorHandler');
const logger = require('../utils/logger');

/**
 * Middleware para validación con schemas Joi
 */

/**
 * Crear middleware de validación para un schema Joi
 * @param {Object} schema - Schema Joi
 * @param {string} property - Propiedad a validar ('body', 'query', 'params')
 * @returns {Function} Middleware
 */
function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Mostrar todos los errores
      stripUnknown: true, // Remover campos no definidos en schema
    });

    if (error) {
      const errorDetails = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      logger.warn('❌ Validación fallida', {
        path: req.path,
        errors: errorDetails,
        requestId: req.id,
      });

      const errorMessage = errorDetails.map((e) => `${e.field}: ${e.message}`).join(', ');

      throw new ValidationError(errorMessage);
    }

    // Reemplazar con valores validados (sanitizados)
    req[property] = value;
    next();
  };
}

/**
 * Validar body del request
 */
function validateBody(schema) {
  return validate(schema, 'body');
}

/**
 * Validar query params
 */
function validateQuery(schema) {
  return validate(schema, 'query');
}

/**
 * Validar params de URL
 */
function validateParams(schema) {
  return validate(schema, 'params');
}

module.exports = {
  validate,
  validateBody,
  validateQuery,
  validateParams,
};
