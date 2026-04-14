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
} = require('../validators/schemas');
const { register: metricsRegister } = require('../utils/metrics');

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
    const { numero, mensaje, buttons, sections, button_text, body_text, header_text, footer_text } = req.body;

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
      await whatsappService.enviarMensaje(
        numero,
        '👋 Conversación finalizada. Si necesitas ayuda, vuelve a escribir.'
      );
    }

    res.json({
      ok: true,
      ...resultado,
    });
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
