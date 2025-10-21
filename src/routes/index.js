const express = require('express');
const webhookRoutes = require('./webhook.routes');
const adminRoutes = require('./admin.routes');

/**
 * Router principal
 * Combina todas las rutas del sistema
 */

const router = express.Router();

// Rutas de webhook (sin autenticación)
router.use('/webhook', webhookRoutes);

// Todas las demás rutas usan las rutas admin
router.use('/', adminRoutes);

module.exports = router;
