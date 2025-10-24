const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const { UnauthorizedError } = require('./errorHandler');

/**
 * Middleware para verificar la firma X-Hub-Signature-256 de WhatsApp
 *
 * WhatsApp firma cada webhook con un HMAC SHA-256 usando el App Secret.
 * Esto previene ataques de inyección de webhooks falsos.
 *
 * Documentación: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */

/**
 * Verificar firma X-Hub-Signature-256 de WhatsApp
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Next middleware
 */
function verifyWebhookSignature(req, res, next) {
  // Si no hay APP_SECRET configurado, permitir en desarrollo
  if (!config.whatsapp.appSecret) {
    logger.warn('⚠️  WHATSAPP_APP_SECRET no configurado - verificación de firma deshabilitada');
    logger.warn('⚠️  Esto es un riesgo de seguridad en producción');
    return next();
  }

  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    logger.warn('⚠️  Webhook sin firma X-Hub-Signature-256', {
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
    });
    throw new UnauthorizedError('Firma de webhook requerida');
  }

  try {
    // El body debe estar en formato raw string para calcular la firma
    // Express debe usar express.json() pero necesitamos el raw body
    const payload = JSON.stringify(req.body);

    // Calcular firma esperada usando HMAC SHA-256
    const expectedSignature = crypto
      .createHmac('sha256', config.whatsapp.appSecret)
      .update(payload)
      .digest('hex');

    // La firma viene como "sha256=<hash>"
    const receivedSignature = signature.replace('sha256=', '');

    // Comparación segura contra timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );

    if (!isValid) {
      logger.warn('⚠️  Firma de webhook inválida', {
        ip: req.ip,
        path: req.path,
        receivedSignature: receivedSignature.substring(0, 10) + '...',
        expectedSignature: expectedSignature.substring(0, 10) + '...',
      });
      throw new UnauthorizedError('Firma de webhook inválida');
    }

    logger.debug('✅ Firma de webhook verificada correctamente');
    next();
  } catch (error) {
    // Si el error ya es UnauthorizedError, re-lanzarlo
    if (error instanceof UnauthorizedError) {
      throw error;
    }

    // Otros errores (ej: buffers de diferente longitud)
    logger.error('❌ Error verificando firma de webhook:', {
      error: error.message,
      ip: req.ip,
    });
    throw new UnauthorizedError('Error verificando firma de webhook');
  }
}

/**
 * Middleware opcional de verificación de firma
 * Registra un warning si la firma no es válida pero permite continuar
 */
function optionalVerifyWebhookSignature(req, res, next) {
  try {
    verifyWebhookSignature(req, res, next);
  } catch (error) {
    logger.warn('⚠️  Verificación de firma falló (modo opcional):', {
      error: error.message,
      ip: req.ip,
    });
    next();
  }
}

module.exports = {
  verifyWebhookSignature,
  optionalVerifyWebhookSignature,
};
