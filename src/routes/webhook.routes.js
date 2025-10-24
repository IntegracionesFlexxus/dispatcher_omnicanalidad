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
    // LOG 1: Webhook recibido
    logger.info('🔔 ========== WEBHOOK RECIBIDO ==========');
    logger.info('📥 Body completo:', { body: JSON.stringify(req.body, null, 2) });

    // Responder inmediatamente a WhatsApp (ACK)
    res.sendStatus(200);

    try {
      const body = req.body;

      // LOG 2: Validación
      logger.info('🔍 Validando webhook...');
      const esValido = whatsappService.validarWebhook(body);
      logger.info(`✓ Validación: ${esValido ? 'VÁLIDO' : 'INVÁLIDO'}`);

      if (!esValido) {
        logger.warn('⚠️  Webhook inválido recibido', {
          body: JSON.stringify(body),
        });
        return;
      }

      // LOG 3: Intentar extraer mensaje
      logger.info('📤 Extrayendo mensaje...');
      const mensaje = whatsappService.extraerMensaje(body);

      if (mensaje) {
        // LOG 4: Mensaje extraído exitosamente
        logger.info('✅ MENSAJE EXTRAÍDO:');
        logger.info(`   • ID: ${mensaje.id}`);
        logger.info(`   • De: ${mensaje.from}`);
        logger.info(`   • Nombre: ${mensaje.profile_name}`);
        logger.info(`   • Tipo: ${mensaje.type}`);
        logger.info(`   • Texto: "${mensaje.text}"`);
        logger.info(`   • Timestamp: ${mensaje.timestamp}`);

        // LOG 5: Enrutando
        logger.info('🔀 Enrutando mensaje...');
        const resultado = await routerService.enrutarMensaje(mensaje.from, body);

        // LOG 6: Resultado del enrutamiento
        logger.info('✅ ENRUTAMIENTO COMPLETADO:');
        logger.info(`   • App Key: ${resultado.appKey}`);
        logger.info(`   • App Nombre: ${resultado.appNombre}`);
        logger.info(`   • Success: ${resultado.resultado?.success}`);
        logger.info(`   • Error: ${resultado.resultado?.error || 'ninguno'}`);
        logger.info('🔔 ========== FIN WEBHOOK ==========\n');

        // Opcional: marcar como leído
        if (config.whatsapp.markAsRead) {
          await whatsappService.marcarComoLeido(mensaje.id);
        }

        return;
      }

      // LOG 7: Intentar extraer status update
      logger.info('📊 No es mensaje, intentando extraer status...');
      const status = whatsappService.extraerStatus(body);

      if (status) {
        logger.info(`📊 Status update recibido:`, {
          id: status.id,
          status: status.status,
          recipient: status.recipient_id,
        });
        return;
      }

      // LOG 8: Ni mensaje ni status
      logger.warn('📭 Webhook sin mensaje ni status');
      logger.warn('Body recibido:', JSON.stringify(body, null, 2));

    } catch (error) {
      // LOG 9: Error
      logger.error('❌ ========== ERROR EN WEBHOOK ==========');
      logger.error('Error:', error.message);
      logger.error('Stack:', error.stack);
      logger.error('Body:', JSON.stringify(req.body, null, 2));
      logger.error('❌ ========================================\n');
    }
  })
);

module.exports = router;
