const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { retryOnNetworkError } = require('../utils/retry');
const { mensajesEnviados, erroresWhatsApp } = require('../utils/metrics');
const { sanitizeToken, sanitizeHeaders, sanitizeError } = require('../utils/sanitize');
const { logBox, logHttpRequest, logHttpResponse } = require('../utils/logHelper');

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
    logger.error(logBox('WhatsApp no configurado', {
      'Token': config.whatsapp.token ? 'Presente' : 'Faltante',
      'Phone Number ID': config.whatsapp.phoneNumberId || 'Faltante',
    }, 'error'));
    erroresWhatsApp.labels('config').inc();
    throw new Error('WhatsApp no configurado');
  }

  const startTime = Date.now();

  try {
    const url = `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to: numero,
      text: { body: texto },
    };

    logger.info(logBox('Enviando mensaje WhatsApp', {
      'Número': numero,
      'Mensaje': texto?.substring(0, 100) + (texto?.length > 100 ? '...' : ''),
      'API': 'WhatsApp Cloud API',
    }, 'info'));

    const response = await retryOnNetworkError(
      async () => {
        return await axios.post(url, payload, {
          headers: {
            Authorization: `Bearer ${config.whatsapp.token}`,
            'Content-Type': 'application/json',
          },
          timeout: config.whatsapp.timeout,
        });
      },
      {
        maxRetries: 3,
        delay: 500,
        operation: `enviarMensaje a ${numero}`,
      }
    );

    const duration = Date.now() - startTime;

    logger.info(logBox('Mensaje WhatsApp Enviado', {
      'Número': numero,
      'Message ID': response.data?.messages?.[0]?.id || 'N/A',
      'Duración': `${duration}ms`,
      'Status': 'Enviado',
    }, 'success'));

    mensajesEnviados.labels('success').inc();

    return response.data;
  } catch (error) {
    const duration = Date.now() - startTime;
    const sanitizedError = sanitizeError(error);

    logger.error(logBox('Error enviando mensaje WhatsApp', {
      'Número': numero,
      'Status': sanitizedError.status || 'N/A',
      'Error': sanitizedError.statusText || error.message,
      'Duración': `${duration}ms`,
      'Respuesta': JSON.stringify(sanitizedError.responseData).substring(0, 200),
    }, 'error'));

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

    const sanitizedError = sanitizeError(error);
    logger.error('🔍 [WhatsApp] Detalles del error:');
    logger.error(`   • Status: ${sanitizedError.status}`);
    logger.error(`   • Status Text: ${sanitizedError.statusText}`);
    logger.error(`   • Respuesta de WhatsApp:\n${JSON.stringify(sanitizedError.responseData, null, 2)}`);

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
    const sanitizedError = sanitizeError(error);
    logger.error('🔍 [WhatsApp] Detalles del error:');
    logger.error(`   • Status: ${sanitizedError.status}`);
    logger.error(`   • Status Text: ${sanitizedError.statusText}`);
    logger.error(`   • Respuesta de WhatsApp:\n${JSON.stringify(sanitizedError.responseData, null, 2)}`);

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
 * Subir archivo a Meta Media API
 * @param {Buffer} buffer - Contenido del archivo
 * @param {string} mimeType - MIME type del archivo
 * @param {string} filename - Nombre original del archivo
 * @returns {Promise<string>} media_id de Meta
 */
async function subirMedia(buffer, mimeType, filename) {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    erroresWhatsApp.labels('config').inc();
    throw new Error('WhatsApp no configurado');
  }

  const startTime = Date.now();

  try {
    const url = `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/media`;

    const FormData = require('form-data');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', buffer, {
      filename: filename,
      contentType: mimeType,
    });

    logger.info(logBox('Subiendo media a Meta', {
      'Filename': filename,
      'MIME Type': mimeType,
      'Tamaño': `${(buffer.length / 1024).toFixed(1)} KB`,
    }, 'info'));

    const response = await retryOnNetworkError(
      async () => {
        return await axios.post(url, form, {
          headers: {
            Authorization: `Bearer ${config.whatsapp.token}`,
            ...form.getHeaders(),
          },
          timeout: config.whatsapp.timeout,
          maxContentLength: 26 * 1024 * 1024,
          maxBodyLength: 26 * 1024 * 1024,
        });
      },
      {
        maxRetries: 2,
        delay: 1000,
        operation: `subirMedia ${filename}`,
      }
    );

    const mediaId = response.data?.id;
    const duration = Date.now() - startTime;

    logger.info(logBox('Media subida a Meta', {
      'Media ID': mediaId,
      'Duración': `${duration}ms`,
    }, 'success'));

    return mediaId;
  } catch (error) {
    const duration = Date.now() - startTime;
    const sanitizedError = sanitizeError(error);

    logger.error(logBox('Error subiendo media a Meta', {
      'Filename': filename,
      'Status': sanitizedError.status || 'N/A',
      'Error': sanitizedError.statusText || error.message,
      'Duración': `${duration}ms`,
    }, 'error'));

    erroresWhatsApp.labels(error.response?.status || 'network').inc();
    throw error;
  }
}

/**
 * Enviar mensaje con media a WhatsApp
 * @param {string} numero - Número destino
 * @param {string} mediaId - ID del media en Meta
 * @param {string} tipoMedia - Tipo: 'image', 'video', 'document'
 * @param {string|null} caption - Caption opcional
 * @param {string|null} filename - Nombre del archivo (solo para documents)
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarMedia(numero, mediaId, tipoMedia, caption = null, filename = null) {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    erroresWhatsApp.labels('config').inc();
    throw new Error('WhatsApp no configurado');
  }

  const startTime = Date.now();

  try {
    const url = `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/messages`;

    const mediaObject = { id: mediaId };
    if (caption) {
      mediaObject.caption = caption;
    }
    if (tipoMedia === 'document' && filename) {
      mediaObject.filename = filename;
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: numero,
      type: tipoMedia,
      [tipoMedia]: mediaObject,
    };

    logger.info(logBox('Enviando media WhatsApp', {
      'Número': numero,
      'Tipo': tipoMedia,
      'Media ID': mediaId,
      'Caption': caption ? caption.substring(0, 50) + (caption.length > 50 ? '...' : '') : 'Sin caption',
    }, 'info'));

    const response = await retryOnNetworkError(
      async () => {
        return await axios.post(url, payload, {
          headers: {
            Authorization: `Bearer ${config.whatsapp.token}`,
            'Content-Type': 'application/json',
          },
          timeout: config.whatsapp.timeout,
        });
      },
      {
        maxRetries: 3,
        delay: 500,
        operation: `enviarMedia ${tipoMedia} a ${numero}`,
      }
    );

    const duration = Date.now() - startTime;

    logger.info(logBox('Media WhatsApp Enviada', {
      'Número': numero,
      'Tipo': tipoMedia,
      'Message ID': response.data?.messages?.[0]?.id || 'N/A',
      'Duración': `${duration}ms`,
    }, 'success'));

    mensajesEnviados.labels('media').inc();

    return response.data;
  } catch (error) {
    const duration = Date.now() - startTime;
    const sanitizedError = sanitizeError(error);

    logger.error(logBox('Error enviando media WhatsApp', {
      'Número': numero,
      'Tipo': tipoMedia,
      'Status': sanitizedError.status || 'N/A',
      'Error': sanitizedError.statusText || error.message,
      'Duración': `${duration}ms`,
    }, 'error'));

    erroresWhatsApp.labels(error.response?.status || 'network').inc();
    mensajesEnviados.labels('error').inc();

    throw error;
  }
}

/**
 * Descargar media desde Meta por su ID
 * @param {string} mediaId - ID del media en Meta
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
async function descargarMedia(mediaId) {
  if (!config.whatsapp.token) {
    throw new Error('WhatsApp no configurado');
  }

  const startTime = Date.now();

  try {
    // Paso 1: obtener URL de descarga
    const metaUrl = `${WHATSAPP_API_URL}/${mediaId}`;
    const metaResponse = await retryOnNetworkError(
      async () => {
        return await axios.get(metaUrl, {
          headers: { Authorization: `Bearer ${config.whatsapp.token}` },
          timeout: config.whatsapp.timeout,
        });
      },
      { maxRetries: 2, delay: 1000, operation: `descargarMedia metadata ${mediaId}` }
    );

    const downloadUrl = metaResponse.data?.url;
    if (!downloadUrl) {
      throw new Error('Meta no devolvió URL de descarga');
    }

    // Paso 2: descargar el binario
    const fileResponse = await retryOnNetworkError(
      async () => {
        return await axios.get(downloadUrl, {
          headers: { Authorization: `Bearer ${config.whatsapp.token}` },
          responseType: 'arraybuffer',
          timeout: 30000,
          maxContentLength: 26 * 1024 * 1024,
        });
      },
      { maxRetries: 2, delay: 1000, operation: `descargarMedia file ${mediaId}` }
    );

    const duration = Date.now() - startTime;
    const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';

    logger.info(logBox('Media descargada de Meta', {
      'Media ID': mediaId,
      'Content-Type': contentType,
      'Tamaño': `${(fileResponse.data.length / 1024).toFixed(1)} KB`,
      'Duración': `${duration}ms`,
    }, 'success'));

    return {
      buffer: Buffer.from(fileResponse.data),
      contentType,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const sanitizedError = sanitizeError(error);

    logger.error(logBox('Error descargando media de Meta', {
      'Media ID': mediaId,
      'Status': sanitizedError.status || 'N/A',
      'Error': sanitizedError.statusText || error.message,
      'Duración': `${duration}ms`,
    }, 'error'));

    erroresWhatsApp.labels(error.response?.status || 'network').inc();
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
    let media_id = null;
    let mime_type = null;
    let filename = null;
    let caption = null;

    switch (tipo) {
      case 'text':
        contenido = mensaje.text?.body || '';
        break;
      case 'image':
        media_id = mensaje.image?.id || null;
        mime_type = mensaje.image?.mime_type || null;
        caption = mensaje.image?.caption || null;
        contenido = caption || '';
        break;
      case 'audio':
        media_id = mensaje.audio?.id || null;
        mime_type = mensaje.audio?.mime_type || null;
        contenido = '';
        break;
      case 'video':
        media_id = mensaje.video?.id || null;
        mime_type = mensaje.video?.mime_type || null;
        caption = mensaje.video?.caption || null;
        contenido = caption || '';
        break;
      case 'document':
        media_id = mensaje.document?.id || null;
        mime_type = mensaje.document?.mime_type || null;
        filename = mensaje.document?.filename || null;
        caption = mensaje.document?.caption || null;
        contenido = caption || '';
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
      media_id,
      mime_type,
      filename,
      caption,
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
  subirMedia,
  enviarMedia,
  descargarMedia,
  marcarComoLeido,
  validarWebhook,
  extraerMensaje,
  extraerStatus,
  isConfigured,
};
