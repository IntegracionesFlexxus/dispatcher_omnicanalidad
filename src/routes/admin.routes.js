const express = require('express');
const router = express.Router();
const config = require('../config');
const logger = require('../utils/logger');
const redisService = require('../services/redis.service');
const whatsappService = require('../services/whatsapp.service');
const routerService = require('../services/router.service');
const { asyncHandler } = require('../middlewares/errorHandler');
const { authenticate } = require('../middlewares/auth');
const { validateBody, validateParams } = require('../middlewares/validator');
const {
  enviarMensajeSchema,
  transferirSchema,
  finalizarSchema,
  numeroParamSchema,
  enviarTemplateSchema,
  enviarMediaSchema,
} = require('../validators/schemas');
const multer = require('multer');
const { logBox } = require('../utils/logHelper');

// Configurar multer en memoria (no escribe a disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

// Mime types permitidos y sus tipos de WhatsApp
const ALLOWED_MEDIA_TYPES = {
  'image/jpeg': { tipo: 'image', maxSize: 5 * 1024 * 1024 },
  'image/png': { tipo: 'image', maxSize: 5 * 1024 * 1024 },
  'image/webp': { tipo: 'image', maxSize: 5 * 1024 * 1024 },
  'video/mp4': { tipo: 'video', maxSize: 16 * 1024 * 1024 },
  'video/3gpp': { tipo: 'video', maxSize: 16 * 1024 * 1024 },
  'application/pdf': { tipo: 'document', maxSize: 25 * 1024 * 1024 },
  'application/msword': { tipo: 'document', maxSize: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { tipo: 'document', maxSize: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { tipo: 'document', maxSize: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { tipo: 'document', maxSize: 25 * 1024 * 1024 },
  'application/vnd.ms-excel': { tipo: 'document', maxSize: 25 * 1024 * 1024 },
  'text/csv': { tipo: 'document', maxSize: 25 * 1024 * 1024 },
};
const { register: metricsRegister } = require('../utils/metrics');

/**
 * Verificar ventana de 24hs y enviar template de re-engagement si es necesario.
 * Retorna true si la ventana está abierta (o se reabrió con template), false si no se puede enviar.
 * @param {string} numero - Número de teléfono
 * @returns {Promise<{abierta: boolean, templateEnviado: boolean}>}
 */
async function verificarVentanaYReabrir(numero, conversationId = null) {
  const ventanaAbierta = await redisService.isVentanaAbierta(numero);

  if (ventanaAbierta) {
    return { abierta: true, templateEnviado: false };
  }

  // Ventana cerrada - intentar reabrir con template
  const templateName = config.whatsapp.reengagementTemplate;

  if (!templateName) {
    logger.warn(logBox('Ventana de 24hs cerrada', {
      'Número': numero,
      'Template': 'No configurado (WHATSAPP_REENGAGEMENT_TEMPLATE)',
      'Acción': 'Mensaje enviado sin verificación de ventana',
    }, 'warning'));
    // Sin template configurado, dejamos que Meta decida (puede fallar con 131047)
    return { abierta: true, templateEnviado: false };
  }

  logger.info(logBox('Ventana de 24hs cerrada - Enviando template', {
    'Número': numero,
    'Template': templateName,
    'Idioma': config.whatsapp.reengagementLanguage,
  }, 'info'));

  await whatsappService.enviarTemplate(
    numero,
    templateName,
    config.whatsapp.reengagementLanguage
  );
  await redisService.incrementStats('templates_reengagement');

  // Asegurar que cuando el usuario responda al template, el mensaje llegue al CRM
  await redisService.setAppAsignada(numero, 'asesor');
  await redisService.setBotEstado(numero, {
    activo: false,
    desactivado_en: new Date().toISOString(),
    motivo: 'Re-engagement template enviado',
  });

  // Guardar conversation_id si fue proporcionado, para que la respuesta del botón
  // se asocie a la conversación existente en el CRM
  if (conversationId) {
    await redisService.setConversationId(numero, conversationId);
  }

  // Con template Marketing, la ventana no se abre hasta que el usuario responda.
  // No se debe enviar el mensaje original, solo el template.
  return { abierta: false, templateEnviado: true };
}

/**
 * Rutas administrativas (requieren autenticación)
 */

/**
 * GET /health - Health check
 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const redisOk = await redisService.healthCheck();
    const whatsappOk = whatsappService.isConfigured();

    const health = {
      status: redisOk ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        redis: {
          status: redisOk ? 'ok' : 'error',
          connected: redisService.isRedisConnected(),
        },
        whatsapp: {
          status: whatsappOk ? 'ok' : 'not_configured',
          configured: whatsappOk,
        },
      },
      apps: Object.keys(config.apps).length,
      environment: config.NODE_ENV,
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  })
);

/**
 * GET /health/live - Liveness probe (Kubernetes)
 */
router.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * GET /health/ready - Readiness probe (Kubernetes)
 */
router.get(
  '/health/ready',
  asyncHandler(async (req, res) => {
    const redisOk = await redisService.healthCheck();
    const ready = redisOk;

    if (ready) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not_ready' });
    }
  })
);

/**
 * GET /metrics - Métricas de Prometheus
 */
router.get(
  '/metrics',
  asyncHandler(async (req, res) => {
    res.set('Content-Type', metricsRegister.contentType);
    const metrics = await metricsRegister.metrics();
    res.end(metrics);
  })
);

/**
 * POST /enviar - Enviar mensaje a WhatsApp (texto, botones o lista)
 * Detecta automáticamente el tipo basándose en los parámetros enviados:
 * - Si incluye 'buttons', envía botones interactivos
 * - Si incluye 'sections', envía lista interactiva
 * - Si solo incluye 'mensaje', envía mensaje de texto
 */
router.post(
  '/enviar',
  authenticate,
  validateBody(enviarMensajeSchema),
  asyncHandler(async (req, res) => {
    const { numero, mensaje, buttons, sections, button_text, body_text, header_text, footer_text, conversation_id } = req.body;

    // Verificar ventana de 24hs y reabrir con template si es necesario
    const { abierta, templateEnviado } = await verificarVentanaYReabrir(numero, conversation_id);

    // Si la ventana está cerrada y se envió template, no enviar el mensaje original.
    // El usuario debe responder al template primero para abrir la ventana.
    if (!abierta && templateEnviado) {
      return res.json({
        ok: true,
        tipo: 'template_reengagement',
        mensaje: 'Ventana de 24hs cerrada. Se envió template de re-engagement. El mensaje se podrá enviar cuando el usuario responda.',
        ventana_reabierta: false,
        mensaje_pendiente: true,
      });
    }

    // Detectar tipo de mensaje
    if (buttons && buttons.length > 0) {
      // Enviar botones interactivos
      logger.info(`🔘 Enviando botones interactivos a ${numero}`);

      await whatsappService.enviarBotones(
        numero,
        body_text,
        buttons,
        header_text,
        footer_text
      );

      await redisService.incrementStats('botones_enviados');

      res.json({
        ok: true,
        tipo: 'botones',
        mensaje: 'Botones interactivos enviados correctamente',
      });
    } else if (sections && sections.length > 0) {
      // Enviar lista interactiva
      logger.info(`📋 Enviando lista interactiva a ${numero}`);

      await whatsappService.enviarLista(
        numero,
        button_text,
        body_text,
        sections,
        header_text,
        footer_text
      );

      await redisService.incrementStats('listas_enviadas');

      res.json({
        ok: true,
        tipo: 'lista',
        mensaje: 'Lista interactiva enviada correctamente',
      });
    } else {
      // Enviar mensaje de texto normal
      logger.info(`💬 Enviando mensaje de texto a ${numero}`);

      await whatsappService.enviarMensaje(numero, mensaje);
      await redisService.incrementStats('mensajes_enviados');

      res.json({
        ok: true,
        tipo: 'texto',
        mensaje: 'Mensaje enviado correctamente',
      });
    }
  })
);

/**
 * POST /enviar-template - Enviar template de WhatsApp
 */
router.post(
  '/enviar-template',
  authenticate,
  validateBody(enviarTemplateSchema),
  asyncHandler(async (req, res) => {
    const { numero, template_name, language_code, components } = req.body;

    await whatsappService.enviarTemplate(numero, template_name, language_code, components);
    await redisService.incrementStats('templates_enviados');

    res.json({
      ok: true,
      mensaje: 'Template enviado correctamente',
    });
  })
);

/**
 * POST /enviar-media - Enviar archivo (imagen, documento, video) por WhatsApp
 * Content-Type: multipart/form-data
 * Campos: numero (string), archivo (file), caption (string, opcional)
 */
router.post(
  '/enviar-media',
  authenticate,
  upload.single('archivo'),
  asyncHandler(async (req, res) => {
    // Validar que se envió un archivo
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'El campo "archivo" es requerido',
      });
    }

    // Validar numero y caption con Joi
    const { error, value } = enviarMediaSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errorMessage = error.details.map((d) => d.message).join(', ');
      return res.status(400).json({
        success: false,
        error: errorMessage,
      });
    }

    const { numero, caption, conversation_id } = value;
    const { mimetype, buffer, originalname, size } = req.file;

    // Verificar ventana de 24hs y reabrir con template si es necesario
    const { abierta, templateEnviado } = await verificarVentanaYReabrir(numero, conversation_id);

    if (!abierta && templateEnviado) {
      return res.json({
        success: true,
        tipo: 'template_reengagement',
        mensaje: 'Ventana de 24hs cerrada. Se envió template de re-engagement. El archivo se podrá enviar cuando el usuario responda.',
        ventana_reabierta: false,
        mensaje_pendiente: true,
      });
    }

    // Validar mime type permitido
    const mediaConfig = ALLOWED_MEDIA_TYPES[mimetype];
    if (!mediaConfig) {
      return res.status(400).json({
        success: false,
        error: `Tipo de archivo no permitido: ${mimetype}. Tipos permitidos: ${Object.keys(ALLOWED_MEDIA_TYPES).join(', ')}`,
      });
    }

    // Validar tamaño según tipo
    if (size > mediaConfig.maxSize) {
      const maxMB = (mediaConfig.maxSize / (1024 * 1024)).toFixed(0);
      return res.status(400).json({
        success: false,
        error: `Archivo excede el tamaño máximo para ${mediaConfig.tipo}: ${maxMB}MB`,
      });
    }

    const tipoMedia = mediaConfig.tipo;

    logger.info(`📎 Enviando ${tipoMedia} a ${numero}: ${originalname} (${(size / 1024).toFixed(1)} KB)`);

    // 1. Subir archivo a Meta Media API
    const mediaId = await whatsappService.subirMedia(buffer, mimetype, originalname);

    // 2. Enviar mensaje con el media_id
    const response = await whatsappService.enviarMedia(
      numero,
      mediaId,
      tipoMedia,
      caption || null,
      originalname
    );

    const messageId = response?.messages?.[0]?.id || null;

    await redisService.incrementStats('media_enviados');

    res.json({
      success: true,
      messageId,
    });
  })
);

/**
 * POST /transferir - Transferir conversación a otra app
 */
router.post(
  '/transferir',
  authenticate,
  validateBody(transferirSchema),
  asyncHandler(async (req, res) => {
    const { numero, app_destino, contexto } = req.body;

    const resultado = await routerService.transferir(numero, app_destino, contexto);

    res.json({
      ok: true,
      ...resultado,
    });
  })
);

/**
 * POST /finalizar/:numero - Finalizar conversación
 */
router.post(
  '/finalizar/:numero',
  authenticate,
  validateParams(numeroParamSchema),
  validateBody(finalizarSchema),
  asyncHandler(async (req, res) => {
    const { numero } = req.params;
    const { mensaje_despedida } = req.body;

    const resultado = await routerService.finalizar(numero);

    // Enviar mensaje de despedida si se solicita
    if (mensaje_despedida !== false) {
      const { abierta } = await verificarVentanaYReabrir(numero);
      if (abierta) {
        await whatsappService.enviarMensaje(
          numero,
          '👋 Conversación finalizada. Si necesitas ayuda, vuelve a escribir.'
        );
      }
    }

    res.json({
      ok: true,
      ...resultado,
    });
  })
);

/**
 * GET /media/:mediaId - Descargar media de Meta (proxy para CRM)
 */
router.get(
  '/media/:mediaId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { mediaId } = req.params;

    if (!mediaId || mediaId.length < 5) {
      return res.status(400).json({ ok: false, error: 'mediaId inválido' });
    }

    const { buffer, contentType } = await whatsappService.descargarMedia(mediaId);

    res.set('Content-Type', contentType);
    res.set('Content-Length', buffer.length);
    res.send(buffer);
  })
);

/**
 * POST /bot/desactivar/:numero - Desactivar bot para un número
 */
router.post(
  '/bot/desactivar/:numero',
  authenticate,
  validateParams(numeroParamSchema),
  asyncHandler(async (req, res) => {
    const { numero } = req.params;
    const { motivo, conversation_id } = req.body || {};

    const resultado = await routerService.desactivarBot(numero, motivo, conversation_id);

    if (resultado.ya_desactivado) {
      return res.status(409).json({
        ok: false,
        mensaje: `El bot ya se encuentra desactivado para ${numero}`,
        desactivado_en: resultado.desactivado_en,
      });
    }

    res.json({
      ok: true,
      mensaje: `Bot desactivado para ${numero}`,
      ...resultado,
    });
  })
);

/**
 * POST /bot/activar/:numero - Activar bot para un número
 */
router.post(
  '/bot/activar/:numero',
  authenticate,
  validateParams(numeroParamSchema),
  asyncHandler(async (req, res) => {
    const { numero } = req.params;

    const resultado = await routerService.activarBot(numero);

    res.json({
      ok: true,
      mensaje: `Bot activado para ${numero}`,
      ...resultado,
    });
  })
);

/**
 * GET /bot/estado/:numero - Ver estado del bot para un número
 */
router.get(
  '/bot/estado/:numero',
  authenticate,
  validateParams(numeroParamSchema),
  asyncHandler(async (req, res) => {
    const { numero } = req.params;
    const estado = await routerService.getEstadoBot(numero);

    res.json({
      ok: true,
      ...estado,
    });
  })
);

/**
 * GET /bot/desactivados - Listar todos los números con bot desactivado
 */
router.get(
  '/bot/desactivados',
  authenticate,
  asyncHandler(async (req, res) => {
    const desactivados = await routerService.getBotDesactivados();

    res.json({
      ok: true,
      total: desactivados.length,
      desactivados,
    });
  })
);

/**
 * GET /estado - Ver estado del sistema
 */
router.get(
  '/estado',
  authenticate,
  asyncHandler(async (req, res) => {
    const routings = await redisService.getAllRoutings();
    const stats = await redisService.getStats();
    const circuitBreakers = routerService.getCircuitBreakerStats();
    const botDesactivados = await routerService.getBotDesactivados();

    res.json({
      total_conversaciones: routings.length,
      bot_desactivados: botDesactivados,
      conversaciones: routings,
      estadisticas: stats,
      circuit_breakers: circuitBreakers,
      aplicaciones: Object.keys(config.apps).map((key) => ({
        key,
        nombre: config.apps[key].nombre,
        url: config.apps[key].url,
        prioridad: config.apps[key].prioridad,
      })),
    });
  })
);

/**
 * GET /aplicaciones - Listar aplicaciones registradas
 */
router.get('/aplicaciones', (req, res) => {
  const apps = Object.entries(config.apps).map(([key, data]) => ({
    key,
    nombre: data.nombre,
    url: data.url,
    prioridad: data.prioridad,
  }));

  res.json({
    total: apps.length,
    aplicaciones: apps,
  });
});

/**
 * GET / - Información del servicio
 */
router.get('/', (req, res) => {
  res.json({
    service: 'WhatsApp Dispatcher',
    version: '1.0.0',
    status: 'running',
    environment: config.NODE_ENV,
    endpoints: {
      health: 'GET /health',
      webhook: 'POST /webhook',
      enviar: 'POST /enviar (texto o lista)',
      enviarMedia: 'POST /enviar-media (multipart/form-data)',
      enviarTemplate: 'POST /enviar-template',
      transferir: 'POST /transferir',
      finalizar: 'POST /finalizar/:numero',
      botDesactivar: 'POST /bot/desactivar/:numero',
      botActivar: 'POST /bot/activar/:numero',
      botEstado: 'GET /bot/estado/:numero',
      botDesactivados: 'GET /bot/desactivados',
      estado: 'GET /estado',
      aplicaciones: 'GET /aplicaciones',
      metrics: 'GET /metrics',
    },
  });
});

module.exports = router;
