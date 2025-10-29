const express = require('express');
const router = express.Router();
const config = require('../config');
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsapp.service');
const routerService = require('../services/router.service');
const { asyncHandler } = require('../middlewares/errorHandler');
const { validateQuery } = require('../middlewares/validator');
const { webhookVerificationSchema } = require('../validators/schemas');
const { webhookRateLimitMiddleware } = require('../middlewares/rateLimiter');
const { verifyWebhookSignature } = require('../middlewares/webhookSignature');
const { logBox, logWhatsAppMessage, logWebhookReceived } = require('../utils/logHelper');

/**
 * Rutas de Webhook de WhatsApp
 */

/**
 * GET /webhook - Verificación de webhook por WhatsApp
 */
router.get(
  '/',
  validateQuery(webhookVerificationSchema),
  asyncHandler(async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
      logger.info('✅ Webhook verificado por WhatsApp');
      res.status(200).send(challenge);
    } else {
      logger.warn('❌ Verificación de webhook fallida', {
        receivedToken: token,
        expectedToken: config.whatsapp.verifyToken,
      });
      res.sendStatus(403);
    }
  })
);

/**
 * POST /webhook - Recibir mensajes de WhatsApp
 */
router.post(
  '/',
  verifyWebhookSignature, // Verificar firma X-Hub-Signature-256 de WhatsApp
  webhookRateLimitMiddleware,
  asyncHandler(async (req, res) => {
    const body = req.body;

    logger.info(logWebhookReceived(body));

    // Responder inmediatamente a WhatsApp (ACK)
    res.sendStatus(200);

    try {
      // Validación
      const esValido = whatsappService.validarWebhook(body);

      if (!esValido) {
        logger.warn(logBox('Webhook Inválido', {
          'Razón': 'Estructura incorrecta',
          'Body preview': JSON.stringify(body).substring(0, 200),
        }, 'warning'));
        return;
      }

      // Intentar extraer mensaje
      const mensaje = whatsappService.extraerMensaje(body);

      if (mensaje) {
        logger.info(logWhatsAppMessage(mensaje));

        // Enrutar mensaje
        const resultado = await routerService.enrutarMensaje(mensaje.from, body);

        logger.info(logBox('Webhook Procesado - Mensaje', {
          'Número': mensaje.from,
          'App destino': resultado.appNombre,
          'Éxito': resultado.resultado?.success ? 'Sí' : 'No',
          'Status': resultado.resultado?.status || 'N/A',
        }, 'success'));

        // Opcional: marcar como leído
        if (config.whatsapp.markAsRead) {
          await whatsappService.marcarComoLeido(mensaje.id);
        }

        return;
      }

      // Intentar extraer status update
      const status = whatsappService.extraerStatus(body);

      if (status) {
        logger.info(logBox('Status Update Recibido', {
          'ID': status.id,
          'Estado': status.status,
          'Destinatario': status.recipient_id,
        }, 'info'));
        return;
      }

      // Ni mensaje ni status
      logger.warn(logBox('Webhook sin contenido procesable', {
        'Tipo': 'Desconocido',
        'Body preview': JSON.stringify(body).substring(0, 200),
      }, 'warning'));

    } catch (error) {
      logger.error(logBox('Error procesando Webhook', {
        'Error': error.message,
        'Stack': error.stack?.substring(0, 500),
        'Body preview': JSON.stringify(req.body).substring(0, 200),
      }, 'error'));
    }
  })
);

module.exports = router;
