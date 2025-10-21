const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { retryOnNetworkError } = require('../utils/retry');
const { mensajesEnviados, erroresWhatsApp } = require('../utils/metrics');

/**
 * Servicio de WhatsApp Cloud API con retry logic
 */

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

/**
 * Enviar mensaje de texto a WhatsApp
 * @param {string} numero - Número destino (formato internacional)
 * @param {string} texto - Texto del mensaje
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarMensaje(numero, texto) {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    logger.error('❌ WhatsApp no configurado correctamente');
    erroresWhatsApp.labels('config').inc();
    throw new Error('WhatsApp no configurado');
  }

  try {
    const url = `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/messages`;

    // LOG DETALLADO: Ver exactamente qué se envía a WhatsApp
    logger.info('🔍 [WhatsApp] Preparando envío a Meta:');
    logger.info(`   • URL: ${url}`);
    logger.info(`   • Phone Number ID: ${config.whatsapp.phoneNumberId}`);
    logger.info(`   • Token (primeros 20 chars): ${config.whatsapp.token ? config.whatsapp.token.substring(0, 20) : 'NO_CONFIGURADO'}...`);
    logger.info(`   • Número destino: ${numero}`);
    logger.info(`   • Mensaje: ${texto ? texto.substring(0, Math.min(50, texto.length)) : 'vacio'}...`);
    logger.info(`   • Body completo:\n${JSON.stringify({
      messaging_product: 'whatsapp',
      to: numero,
      text: { body: texto }
    }, null, 2)}`);

    const response = await retryOnNetworkError(
      async () => {
        return await axios.post(
          url,
          {
            messaging_product: 'whatsapp',
            to: numero,
            text: { body: texto },
          },
          {
            headers: {
              Authorization: `Bearer ${config.whatsapp.token}`,
              'Content-Type': 'application/json',
            },
            timeout: config.whatsapp.timeout,
          }
        );
      },
      {
        maxRetries: 3,
        delay: 500,
        operation: `enviarMensaje a ${numero}`,
      }
    );

    logger.info(`✅ Mensaje enviado a ${numero}`);
    mensajesEnviados.labels('success').inc();

    return response.data;
  } catch (error) {
    logger.error(`❌ Error enviando mensaje a ${numero}:`, {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    // LOG DETALLADO DEL ERROR
    logger.error('🔍 [WhatsApp] Detalles completos del error:');
    logger.error(`   • Status: ${error.response?.status}`);
    logger.error(`   • Status Text: ${error.response?.statusText}`);
    logger.error(`   • Respuesta de WhatsApp:\n${JSON.stringify(error.response?.data, null, 2)}`);
    logger.error(`   • Headers enviados:\n${JSON.stringify(error.config?.headers, null, 2)}`);
    logger.error(`   • URL llamada: ${error.config?.url}`);

    erroresWhatsApp.labels(error.response?.status || 'network').inc();
    mensajesEnviados.labels('error').inc();

    throw error;
  }
}

/**
 * Enviar botones interactivos de WhatsApp
 * @param {string} numero - Número destino (formato internacional)
 * @param {string} bodyText - Texto del cuerpo del mensaje (obligatorio)
 * @param {Array} buttons - Array de botones (máx 3)
 * @param {string} headerText - Texto del encabezado (opcional)
 * @param {string} footerText - Texto del pie (opcional)
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarBotones(numero, bodyText, buttons, headerText = null, footerText = null) {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    logger.error('❌ WhatsApp no configurado correctamente');
    erroresWhatsApp.labels('config').inc();
    throw new Error('WhatsApp no configurado');
  }

  try {
    const url = `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/messages`;

    // Construir objeto interactive para botones
    const interactive = {
      type: 'button',
      body: {
        text: bodyText,
      },
      action: {
        buttons: buttons,
      },
    };

    // Agregar header si existe
    if (headerText) {
      interactive.header = {
        type: 'text',
        text: headerText,
      };
    }

    // Agregar footer si existe
    if (footerText) {
      interactive.footer = {
        text: footerText,
      };
    }

    // LOG DETALLADO
    logger.info('🔍 [WhatsApp] Preparando envío de botones a Meta:');
    logger.info(`   • URL: ${url}`);
    logger.info(`   • Número destino: ${numero}`);
    logger.info(`   • Body: ${bodyText.substring(0, Math.min(50, bodyText.length))}...`);
    logger.info(`   • Botones: ${buttons.length}`);
    logger.info(`   • Body completo:\n${JSON.stringify({
      messaging_product: 'whatsapp',
      to: numero,
      type: 'interactive',
      interactive,
    }, null, 2)}`);

    const response = await retryOnNetworkError(
      async () => {
        return await axios.post(
          url,
          {
            messaging_product: 'whatsapp',
            to: numero,
            type: 'interactive',
            interactive,
          },
          {
            headers: {
              Authorization: `Bearer ${config.whatsapp.token}`,
              'Content-Type': 'application/json',
            },
            timeout: config.whatsapp.timeout,
          }
        );
      },
      {
        maxRetries: 3,
        delay: 500,
        operation: `enviarBotones a ${numero}`,
      }
    );

    logger.info(`✅ Botones enviados a ${numero}`);
    mensajesEnviados.labels('buttons').inc();

    return response.data;
  } catch (error) {
    logger.error(`❌ Error enviando botones a ${numero}:`, {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    logger.error('🔍 [WhatsApp] Detalles completos del error:');
    logger.error(`   • Status: ${error.response?.status}`);
    logger.error(`   • Status Text: ${error.response?.statusText}`);
    logger.error(`   • Respuesta de WhatsApp:\n${JSON.stringify(error.response?.data, null, 2)}`);

    erroresWhatsApp.labels(error.response?.status || 'network').inc();
    mensajesEnviados.labels('error').inc();

    throw error;
  }
}

/**
 * Enviar lista interactiva de WhatsApp
 * @param {string} numero - Número destino (formato internacional)
 * @param {string} buttonText - Texto del botón (máx 20 caracteres)
 * @param {string} bodyText - Texto del cuerpo del mensaje (obligatorio)
 * @param {Array} sections - Array de secciones con filas
 * @param {string} headerText - Texto del encabezado (opcional)
 * @param {string} footerText - Texto del pie (opcional)
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarLista(numero, buttonText, bodyText, sections, headerText = null, footerText = null) {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    logger.error('❌ WhatsApp no configurado correctamente');
    erroresWhatsApp.labels('config').inc();
    throw new Error('WhatsApp no configurado');
  }

  try {
    const url = `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/messages`;

    // Construir objeto interactive
    const interactive = {
      type: 'list',
      body: {
        text: bodyText,
      },
      action: {
        button: buttonText,
        sections: sections,
      },
    };

    // Agregar header si existe
    if (headerText) {
      interactive.header = {
        type: 'text',
        text: headerText,
      };
    }

    // Agregar footer si existe
    if (footerText) {
      interactive.footer = {
        text: footerText,
      };
    }

    // LOG DETALLADO
    logger.info('🔍 [WhatsApp] Preparando envío de lista a Meta:');
    logger.info(`   • URL: ${url}`);
    logger.info(`   • Número destino: ${numero}`);
    logger.info(`   • Botón: ${buttonText}`);
    logger.info(`   • Body: ${bodyText.substring(0, Math.min(50, bodyText.length))}...`);
    logger.info(`   • Secciones: ${sections.length}`);
    logger.info(`   • Body completo:\n${JSON.stringify({
      messaging_product: 'whatsapp',
      to: numero,
      type: 'interactive',
      interactive,
    }, null, 2)}`);

    const response = await retryOnNetworkError(
      async () => {
        return await axios.post(
          url,
          {
            messaging_product: 'whatsapp',
            to: numero,
            type: 'interactive',
            interactive,
          },
          {
            headers: {
              Authorization: `Bearer ${config.whatsapp.token}`,
              'Content-Type': 'application/json',
            },
            timeout: config.whatsapp.timeout,
          }
        );
      },
      {
        maxRetries: 3,
        delay: 500,
        operation: `enviarLista a ${numero}`,
      }
    );

    logger.info(`✅ Lista enviada a ${numero}`);
    mensajesEnviados.labels('list').inc();

    return response.data;
  } catch (error) {
    logger.error(`❌ Error enviando lista a ${numero}:`, {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    // LOG DETALLADO DEL ERROR
    logger.error('🔍 [WhatsApp] Detalles completos del error:');
    logger.error(`   • Status: ${error.response?.status}`);
    logger.error(`   • Status Text: ${error.response?.statusText}`);
    logger.error(`   • Respuesta de WhatsApp:\n${JSON.stringify(error.response?.data, null, 2)}`);

    erroresWhatsApp.labels(error.response?.status || 'network').inc();
    mensajesEnviados.labels('error').inc();

    throw error;
  }
}

/**
 * Enviar mensaje con plantilla (template)
 * @param {string} numero - Número destino
 * @param {string} templateName - Nombre de la plantilla
 * @param {string} languageCode - Código de idioma (ej: 'es', 'en')
 * @param {Array} components - Componentes de la plantilla
 * @returns {Promise<Object>}
 */
async function enviarTemplate(numero, templateName, languageCode = 'es', components = []) {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    throw new Error('WhatsApp no configurado');
  }

  try {
    const url = `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/messages`;

    const response = await retryOnNetworkError(
      async () => {
        return await axios.post(
          url,
          {
            messaging_product: 'whatsapp',
            to: numero,
            type: 'template',
            template: {
              name: templateName,
              language: { code: languageCode },
              components,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${config.whatsapp.token}`,
              'Content-Type': 'application/json',
            },
            timeout: config.whatsapp.timeout,
          }
        );
      },
      {
        maxRetries: 2,
        delay: 500,
        operation: `enviarTemplate ${templateName} a ${numero}`,
      }
    );

    logger.info(`✅ Template ${templateName} enviado a ${numero}`);
    mensajesEnviados.labels('template').inc();

    return response.data;
  } catch (error) {
    logger.error(`❌ Error enviando template a ${numero}:`, {
      template: templateName,
      error: error.message,
      response: error.response?.data,
    });

    erroresWhatsApp.labels('template').inc();
    throw error;
  }
}

/**
 * Marcar mensaje como leído
 * @param {string} messageId - ID del mensaje
 * @returns {Promise<Object>}
 */
async function marcarComoLeido(messageId) {
  try {
    const url = `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/messages`;

    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${config.whatsapp.token}`,
          'Content-Type': 'application/json',
        },
        timeout: config.whatsapp.timeout,
      }
    );

    logger.debug(`✅ Mensaje ${messageId} marcado como leído`);
    return response.data;
  } catch (error) {
    logger.warn(`Error marcando mensaje como leído:`, {
      messageId,
      error: error.message,
    });
    // No lanzar error, marcar como leído no es crítico
  }
}

/**
 * Validar que el webhook viene de WhatsApp
 * @param {Object} body - Body del webhook
 * @returns {boolean}
 */
function validarWebhook(body) {
  return body?.object === 'whatsapp_business_account';
}

/**
 * Extraer mensaje del webhook de WhatsApp
 * @param {Object} body - Body del webhook
 * @returns {Object|null} Mensaje extraído o null
 */
function extraerMensaje(body) {
  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const mensaje = value?.messages?.[0];

    if (!mensaje) {
      return null;
    }

    // Extraer datos según tipo de mensaje
    let contenido = '';
    let tipo = mensaje.type;

    switch (tipo) {
      case 'text':
        contenido = mensaje.text?.body || '';
        break;
      case 'image':
        contenido = mensaje.image?.id || '';
        break;
      case 'audio':
        contenido = mensaje.audio?.id || '';
        break;
      case 'video':
        contenido = mensaje.video?.id || '';
        break;
      case 'document':
        contenido = mensaje.document?.id || '';
        break;
      case 'location':
        contenido = JSON.stringify(mensaje.location);
        break;
      case 'interactive':
        contenido = JSON.stringify(mensaje.interactive);
        break;
      default:
        contenido = '';
    }

    return {
      id: mensaje.id,
      from: mensaje.from,
      timestamp: mensaje.timestamp,
      type: tipo,
      text: contenido,
      mensaje_completo: mensaje,
      profile_name: value?.contacts?.[0]?.profile?.name || 'Usuario',
    };
  } catch (error) {
    logger.error('Error extrayendo mensaje:', {
      error: error.message,
      body: JSON.stringify(body),
    });
    return null;
  }
}

/**
 * Extraer status update del webhook
 * @param {Object} body - Body del webhook
 * @returns {Object|null}
 */
function extraerStatus(body) {
  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const status = value?.statuses?.[0];

    if (!status) {
      return null;
    }

    return {
      id: status.id,
      status: status.status, // sent, delivered, read, failed
      timestamp: status.timestamp,
      recipient_id: status.recipient_id,
    };
  } catch (error) {
    logger.error('Error extrayendo status:', { error: error.message });
    return null;
  }
}

/**
 * Verificar configuración de WhatsApp
 * @returns {boolean}
 */
function isConfigured() {
  return !!(config.whatsapp.token && config.whatsapp.phoneNumberId);
}

module.exports = {
  enviarMensaje,
  enviarBotones,
  enviarLista,
  enviarTemplate,
  marcarComoLeido,
  validarWebhook,
  extraerMensaje,
  extraerStatus,
  isConfigured,
};
