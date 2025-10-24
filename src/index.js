/**
 * WhatsApp Dispatcher - Servidor Principal
 * Sistema de enrutamiento de mensajes omnicanal
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');
const redisService = require('./services/redis.service');
const { measureHttpDuration } = require('./utils/metrics');
const { sanitizeToken } = require('./utils/sanitize');

// Middlewares
const { addRequestId, requestLogger, webhookLogger } = require('./middlewares/requestLogger');
const { rateLimitMiddleware } = require('./middlewares/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

// Rutas
const routes = require('./routes');

// Crear app Express
const app = express();

// ========== MIDDLEWARES GLOBALES ==========

// Seguridad
app.use(helmet());

// CORS - Configuración según entorno
if (config.isDevelopment()) {
  // Desarrollo: permitir todos los orígenes
  app.use(cors());
  logger.info('🔓 CORS: Modo desarrollo (todos los orígenes permitidos)');
} else {
  // Producción: CORS restrictivo
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

  if (allowedOrigins.length > 0) {
    // Si hay orígenes configurados, permitir solo esos
    app.use(
      cors({
        origin: allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'X-API-Key', 'X-App-Name', 'Authorization'],
      })
    );
    logger.info('🔒 CORS: Modo restrictivo', { allowedOrigins });
  } else {
    // Si no hay orígenes configurados, bloquear navegadores (solo server-to-server)
    app.use(
      cors({
        origin: false, // Bloquea requests desde navegadores
      })
    );
    logger.info('🔒 CORS: Modo restrictivo (solo server-to-server)');
  }
}

// Parsear JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request ID y logging
app.use(addRequestId);
app.use(requestLogger);
app.use(webhookLogger);

// Métricas
app.use(measureHttpDuration);

// Rate limiting (aplicar a todas las rutas)
app.use(rateLimitMiddleware);

// ========== RUTAS ==========

app.use('/', routes);

// ========== ERROR HANDLERS ==========

// 404
app.use(notFoundHandler);

// Error handler global
app.use(errorHandler);

// ========== INICIO DEL SERVIDOR ==========

let server;

/**
 * Iniciar el servidor y conectar dependencias
 */
async function iniciar() {
  try {
    logger.info('🚀 Iniciando Dispatcher...');
    logger.info(`📍 Entorno: ${config.NODE_ENV}`);

    // Conectar a Redis
    logger.info('🔌 Conectando a Redis...');
    await redisService.connect();
    logger.info('✅ Redis conectado');

    // Validar configuración de WhatsApp
    if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
      logger.warn('⚠️  WhatsApp no configurado completamente');
      logger.warn('   El dispatcher funcionará pero no podrá enviar mensajes');
    } else {
      logger.info('✅ WhatsApp configurado');
    }

    // Validar aplicaciones
    const appCount = Object.keys(config.apps).length;
    if (appCount === 0) {
      logger.warn('⚠️  No hay aplicaciones configuradas');
    } else {
      logger.info(`✅ ${appCount} aplicación(es) registrada(s)`);
    }

    // Iniciar servidor HTTP
    server = app.listen(config.PORT, config.HOST, () => {
      logger.info('');
      logger.info('🚀 ========================================');
      logger.info(`   DISPATCHER corriendo en ${config.HOST}:${config.PORT}`);
      logger.info('🚀 ========================================');
      logger.info('');

      // Configuración de WhatsApp
      logger.info('📱 Configuración WhatsApp:');
      logger.info(`   • Token: ${config.whatsapp.token ? sanitizeToken(config.whatsapp.token) : 'NO CONFIGURADO'}`);
      logger.info(`   • Phone ID: ${config.whatsapp.phoneNumberId || 'NO CONFIGURADO'}`);
      logger.info(`   • Verify Token: ${config.whatsapp.verifyToken ? sanitizeToken(config.whatsapp.verifyToken) : 'NO CONFIGURADO'}`);
      logger.info('');

      // Información de webhook para configurar en Meta
      logger.info('📍 ========================================');
      logger.info('   CONFIGURACIÓN WEBHOOK EN META');
      logger.info('📍 ========================================');
      logger.info('');
      logger.info('1️⃣  Ve a: https://developers.facebook.com/apps');
      logger.info('2️⃣  Tu App > WhatsApp > Configuration');
      logger.info('3️⃣  En "Webhook" haz clic en "Edit"');
      logger.info('');

      if (config.isProduction()) {
        logger.info('📌 Callback URL:');
        logger.info('   https://tu-dominio.com/webhook');
      } else {
        logger.info('📌 Callback URL (desarrollo):');
        logger.info(`   http://localhost:${config.PORT}/webhook`);
        logger.info('');
        logger.info('   ⚠️  Meta requiere HTTPS, usa ngrok:');
        logger.info('   ngrok http ' + config.PORT);
        logger.info('   Luego usa: https://xxxxx.ngrok.io/webhook');
      }
      logger.info('');
      logger.info('📌 Verify Token:');
      logger.info(`   ${config.whatsapp.verifyToken}`);
      logger.info('');
      logger.info('4️⃣  Haz clic en "Verify and Save"');
      logger.info('5️⃣  Suscríbete a: messages, message_status');
      logger.info('📍 ========================================');
      logger.info('');

      // Apps registradas
      logger.info(`🔧 Aplicaciones registradas: ${appCount}`);
      Object.entries(config.apps).forEach(([key, app]) => {
        logger.info(`   • ${app.nombre} (${key}) → ${app.url} [prioridad: ${app.prioridad}]`);
      });
      logger.info('');

      // Endpoints disponibles
      logger.info('📡 Endpoints principales:');
      logger.info(`   • Health:       GET  http://localhost:${config.PORT}/health`);
      logger.info(`   • Webhook:      POST http://localhost:${config.PORT}/webhook`);
      logger.info(`   • Enviar:       POST http://localhost:${config.PORT}/enviar`);
      logger.info(`   • Transferir:   POST http://localhost:${config.PORT}/transferir`);
      logger.info(`   • Estado:       GET  http://localhost:${config.PORT}/estado`);
      logger.info(`   • Métricas:     GET  http://localhost:${config.PORT}/metrics`);
      logger.info('');

      logger.info('✅ Sistema listo para recibir mensajes');
      logger.info('');
    });

    // Manejar errores del servidor
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Puerto ${config.PORT} ya está en uso`);
      } else {
        logger.error('❌ Error del servidor:', error);
      }
      process.exit(1);
    });
  } catch (error) {
    logger.error('❌ Error fatal iniciando:', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

/**
 * Shutdown graceful
 */
async function shutdown(signal) {
  logger.info(`\n📥 Recibido ${signal}, iniciando shutdown graceful...`);

  // Dejar de aceptar nuevas conexiones
  if (server) {
    server.close(() => {
      logger.info('✅ Servidor HTTP cerrado');
    });
  }

  try {
    // Dar tiempo a requests en proceso
    logger.info('⏳ Esperando requests en proceso (máx 30s)...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Cerrar conexión a Redis
    logger.info('🔌 Cerrando conexión a Redis...');
    await redisService.disconnect();
    logger.info('✅ Redis desconectado');

    logger.info('👋 Shutdown completado');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error durante shutdown:', error);
    process.exit(1);
  }
}

// ========== MANEJADORES DE SEÑALES ==========

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', {
    error: error.message,
    stack: error.stack,
  });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Unhandled Rejection:', {
    reason,
    promise,
  });
  shutdown('unhandledRejection');
});

// ========== INICIAR ==========

iniciar();

// Exportar app para testing
module.exports = app;
