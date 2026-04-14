const Joi = require('joi');

/**
 * Schemas de validación con Joi
 */

// Pattern para número de teléfono (formato internacional flexible)
// Acepta: 549XXXXXXXXXX, +549XXXXXXXXXX, o cualquier número internacional
const phonePattern = /^\+?\d{10,15}$/; // 10-15 dígitos, opcional '+'

// ========== SCHEMAS ==========

/**
 * Schema para enviar mensaje (texto, botones o lista)
 * Si incluye 'buttons', se envía como botones interactivos
 * Si incluye 'sections', se envía como lista interactiva
 * Si solo incluye 'mensaje', se envía como texto
 */
const enviarMensajeSchema = Joi.object({
  numero: Joi.string()
    .pattern(phonePattern)
    .required()
    .messages({
      'string.pattern.base': 'Número debe tener entre 10 y 15 dígitos (formato internacional)',
      'any.required': 'Número es requerido',
    }),
  mensaje: Joi.string().max(4096).when('sections', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.when('buttons', {
      is: Joi.exist(),
      then: Joi.optional(),
      otherwise: Joi.required()
    })
  }).messages({
    'string.max': 'Mensaje no puede exceder 4096 caracteres',
    'any.required': 'Mensaje es requerido cuando no se envía lista o botones',
  }),

  // Parámetros para botones interactivos (opcionales)
  buttons: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid('reply').default('reply'),
        reply: Joi.object({
          id: Joi.string().max(256).required().messages({
            'string.max': 'ID de botón no puede exceder 256 caracteres',
            'any.required': 'ID de botón es requerido',
          }),
          title: Joi.string().max(20).required().messages({
            'string.max': 'Título de botón no puede exceder 20 caracteres',
            'any.required': 'Título de botón es requerido',
          }),
        }).required(),
      })
    )
    .min(1)
    .max(3)
    .optional()
    .messages({
      'array.min': 'Debe haber al menos 1 botón',
      'array.max': 'No puede haber más de 3 botones',
    }),

  // Parámetros para listas interactivas (opcionales)
  button_text: Joi.string().max(20).when('sections', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }).messages({
    'string.max': 'Texto del botón no puede exceder 20 caracteres',
    'any.required': 'button_text es requerido cuando se envía lista',
  }),

  // body_text: requerido para botones y listas, opcional en otros casos
  body_text: Joi.string().max(1024).optional().messages({
    'string.max': 'Texto del cuerpo no puede exceder 1024 caracteres',
  }),

  header_text: Joi.string().max(60).optional().messages({
    'string.max': 'Texto del encabezado no puede exceder 60 caracteres',
  }),

  footer_text: Joi.string().max(60).optional().messages({
    'string.max': 'Texto del pie no puede exceder 60 caracteres',
  }),

  sections: Joi.array()
    .items(
      Joi.object({
        title: Joi.string().max(24).optional().messages({
          'string.max': 'Título de sección no puede exceder 24 caracteres',
        }),
        rows: Joi.array()
          .min(1)
          .max(10)
          .items(
            Joi.object({
              id: Joi.string().max(200).required().messages({
                'string.max': 'ID de fila no puede exceder 200 caracteres',
                'any.required': 'ID de fila es requerido',
              }),
              title: Joi.string().max(24).required().messages({
                'string.max': 'Título de fila no puede exceder 24 caracteres',
                'any.required': 'Título de fila es requerido',
              }),
              description: Joi.string().max(72).optional().messages({
                'string.max': 'Descripción de fila no puede exceder 72 caracteres',
              }),
            })
          )
          .required()
          .messages({
            'array.min': 'Cada sección debe tener al menos 1 fila',
            'array.max': 'Cada sección no puede tener más de 10 filas',
            'any.required': 'Filas son requeridas',
          }),
      })
    )
    .min(1)
    .max(10)
    .optional()
    .messages({
      'array.min': 'Debe haber al menos 1 sección',
      'array.max': 'No puede haber más de 10 secciones',
    }),
});

/**
 * Schema para transferir conversación
 */
const transferirSchema = Joi.object({
  numero: Joi.string().pattern(phonePattern).required().messages({
    'string.pattern.base': 'Número debe tener entre 10 y 15 dígitos (formato internacional)',
    'any.required': 'Número es requerido',
  }),
  app_destino: Joi.string().required().messages({
    'any.required': 'app_destino es requerido',
  }),
  contexto: Joi.object().optional(),
});

/**
 * Schema para finalizar conversación
 */
const finalizarSchema = Joi.object({
  mensaje_despedida: Joi.boolean().optional().default(true),
});

/**
 * Schema para parámetros de número
 */
const numeroParamSchema = Joi.object({
  numero: Joi.string().pattern(phonePattern).required().messages({
    'string.pattern.base': 'Número debe tener entre 10 y 15 dígitos (formato internacional)',
    'any.required': 'Número es requerido',
  }),
});

/**
 * Schema para webhook de WhatsApp (verificación GET)
 */
const webhookVerificationSchema = Joi.object({
  'hub.mode': Joi.string().valid('subscribe').required(),
  'hub.verify_token': Joi.string().required(),
  'hub.challenge': Joi.string().required(),
});

/**
 * Schema para enviar template
 */
const enviarTemplateSchema = Joi.object({
  numero: Joi.string().pattern(phonePattern).required().messages({
    'string.pattern.base': 'Número debe tener entre 10 y 15 dígitos (formato internacional)',
    'any.required': 'Número es requerido',
  }),
  template_name: Joi.string().required(),
  language_code: Joi.string().default('es').optional(),
  components: Joi.array().optional(),
});

/**
 * Schema para enviar media (valida campos del form-data, no el archivo)
 */
const enviarMediaSchema = Joi.object({
  numero: Joi.string()
    .pattern(phonePattern)
    .required()
    .messages({
      'string.pattern.base': 'Número debe tener entre 10 y 15 dígitos (formato internacional)',
      'any.required': 'Número es requerido',
    }),
  caption: Joi.string().max(1024).optional().allow('').messages({
    'string.max': 'Caption no puede exceder 1024 caracteres',
  }),
});

module.exports = {
  enviarMensajeSchema,
  transferirSchema,
  finalizarSchema,
  numeroParamSchema,
  webhookVerificationSchema,
  enviarTemplateSchema,
  enviarMediaSchema,
};
