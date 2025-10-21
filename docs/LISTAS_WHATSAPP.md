# Guía de Uso: Listas Interactivas de WhatsApp

Esta guía explica cómo utilizar la funcionalidad de listas interactivas de WhatsApp en el Dispatcher.

## Descripción

Las listas interactivas de WhatsApp permiten enviar mensajes con opciones seleccionables, facilitando la interacción con los usuarios. Son ideales para:
- Menús de opciones
- Catálogos de productos
- Selección de servicios
- Encuestas y formularios

## Endpoint

```
POST /enviar
```

**Requiere autenticación:** Sí (API Key en header `X-API-Key`)

**Detección automática:** El dispatcher detecta automáticamente si debe enviar un mensaje de texto o una lista interactiva basándose en los parámetros del body:
- Si incluye el parámetro `sections`, envía una **lista interactiva**
- Si solo incluye `mensaje`, envía un **mensaje de texto normal**

## Estructura del Mensaje

### Parámetros Requeridos

| Parámetro | Tipo | Descripción | Límite |
|-----------|------|-------------|--------|
| `numero` | string | Número de teléfono en formato internacional (ej: 5493512345678) | 10-15 dígitos |
| `button_text` | string | Texto del botón que despliega la lista | Máx 20 caracteres |
| `body_text` | string | Texto principal del mensaje | Máx 1024 caracteres |
| `sections` | array | Array de secciones con opciones | 1-10 secciones |

### Parámetros Opcionales

| Parámetro | Tipo | Descripción | Límite |
|-----------|------|-------------|--------|
| `header_text` | string | Texto del encabezado (opcional) | Máx 60 caracteres |
| `footer_text` | string | Texto del pie de página (opcional) | Máx 60 caracteres |

### Estructura de Secciones

Cada sección debe contener:

```javascript
{
  "title": "Título de la sección",  // Opcional, máx 24 caracteres
  "rows": [                          // Obligatorio, 1-10 filas por sección
    {
      "id": "id_unico",              // Obligatorio, máx 200 caracteres
      "title": "Título opción",      // Obligatorio, máx 24 caracteres
      "description": "Descripción"   // Opcional, máx 72 caracteres
    }
  ]
}
```

## Ejemplos de Uso

### Ejemplo 1: Lista Simple (Menú de Servicios)

```bash
curl -X POST http://localhost:8080/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key_aqui" \
  -d '{
    "numero": "5493512345678",
    "button_text": "Ver opciones",
    "body_text": "Selecciona el servicio que necesitas:",
    "sections": [
      {
        "rows": [
          {
            "id": "soporte_tecnico",
            "title": "Soporte Técnico",
            "description": "Asistencia técnica especializada"
          },
          {
            "id": "ventas",
            "title": "Ventas",
            "description": "Consultas sobre productos"
          },
          {
            "id": "facturacion",
            "title": "Facturación",
            "description": "Información de pagos y facturas"
          }
        ]
      }
    ]
  }'
```

### Ejemplo 2: Lista con Header y Footer

```bash
curl -X POST http://localhost:8080/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key_aqui" \
  -d '{
    "numero": "5493512345678",
    "header_text": "Bienvenido",
    "button_text": "Elegir opción",
    "body_text": "Por favor selecciona una categoría de productos:",
    "footer_text": "Atención 24/7",
    "sections": [
      {
        "title": "Categorías",
        "rows": [
          {
            "id": "cat_electronica",
            "title": "Electrónica",
            "description": "Smartphones, tablets, etc"
          },
          {
            "id": "cat_hogar",
            "title": "Hogar",
            "description": "Muebles y decoración"
          },
          {
            "id": "cat_ropa",
            "title": "Ropa",
            "description": "Indumentaria y calzado"
          }
        ]
      }
    ]
  }'
```

### Ejemplo 3: Lista con Múltiples Secciones

```bash
curl -X POST http://localhost:8080/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key_aqui" \
  -d '{
    "numero": "5493512345678",
    "header_text": "Menú Principal",
    "button_text": "Ver menú",
    "body_text": "Selecciona una opción del menú:",
    "footer_text": "Delivery disponible",
    "sections": [
      {
        "title": "Entradas",
        "rows": [
          {
            "id": "entrada_ensalada",
            "title": "Ensalada César",
            "description": "$850 - Lechuga, pollo, croutones"
          },
          {
            "id": "entrada_sopa",
            "title": "Sopa del día",
            "description": "$650 - Consultar sabor"
          }
        ]
      },
      {
        "title": "Platos Principales",
        "rows": [
          {
            "id": "plato_milanesa",
            "title": "Milanesa Napolitana",
            "description": "$1850 - Con papas fritas"
          },
          {
            "id": "plato_pizza",
            "title": "Pizza Especial",
            "description": "$1650 - Muzzarella y jamón"
          }
        ]
      },
      {
        "title": "Postres",
        "rows": [
          {
            "id": "postre_flan",
            "title": "Flan Casero",
            "description": "$550 - Con dulce de leche"
          },
          {
            "id": "postre_helado",
            "title": "Helado Artesanal",
            "description": "$750 - 2 sabores"
          }
        ]
      }
    ]
  }'
```

### Ejemplo 4: Mensaje de Texto Normal (mismo endpoint)

```bash
curl -X POST http://localhost:8080/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key_aqui" \
  -d '{
    "numero": "5493512345678",
    "mensaje": "Hola, este es un mensaje de texto normal"
  }'
```

**Respuesta:**
```json
{
  "ok": true,
  "tipo": "texto",
  "mensaje": "Mensaje enviado correctamente"
}
```

### Ejemplo 5: Desde JavaScript/Node.js

```javascript
const axios = require('axios');

async function enviarListaWhatsApp() {
  try {
    const response = await axios.post('http://localhost:8080/enviar', {
      numero: '5493512345678',
      button_text: 'Seleccionar',
      body_text: '¿Qué te gustaría hacer hoy?',
      header_text: 'Menu de Opciones',
      footer_text: 'Respuesta en minutos',
      sections: [
        {
          title: 'Servicios',
          rows: [
            {
              id: 'srv_consulta',
              title: 'Hacer una consulta',
              description: 'Consultas generales'
            },
            {
              id: 'srv_reclamo',
              title: 'Realizar un reclamo',
              description: 'Reportar problemas'
            },
            {
              id: 'srv_sugerencia',
              title: 'Enviar sugerencia',
              description: 'Ayúdanos a mejorar'
            }
          ]
        }
      ]
    }, {
      headers: {
        'X-API-Key': process.env.API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('Lista enviada:', response.data);
    // { ok: true, tipo: 'lista', mensaje: 'Lista interactiva enviada correctamente' }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// También puedes enviar texto normal con el mismo endpoint
async function enviarTextoWhatsApp() {
  try {
    const response = await axios.post('http://localhost:8080/enviar', {
      numero: '5493512345678',
      mensaje: 'Hola, este es un mensaje de texto'
    }, {
      headers: {
        'X-API-Key': process.env.API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('Mensaje enviado:', response.data);
    // { ok: true, tipo: 'texto', mensaje: 'Mensaje enviado correctamente' }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

enviarListaWhatsApp();
```

## Recibir Respuestas de Listas

Cuando un usuario selecciona una opción de la lista, WhatsApp envía un webhook con tipo `interactive`. El dispatcher extrae esta información y la envía a la aplicación correspondiente.

### Estructura del Mensaje Recibido

```javascript
{
  "id": "wamid.xxxxx",
  "from": "5493512345678",
  "timestamp": "1634567890",
  "type": "interactive",
  "text": "{\"type\":\"list_reply\",\"list_reply\":{\"id\":\"srv_consulta\",\"title\":\"Hacer una consulta\"}}",
  "mensaje_completo": { /* objeto completo del mensaje */ },
  "profile_name": "Juan Pérez"
}
```

### Parsear la Respuesta

Para obtener la opción seleccionada:

```javascript
// En tu aplicación que recibe el webhook
app.post('/webhook', (req, res) => {
  const mensaje = req.body;

  if (mensaje.type === 'interactive') {
    const interactive = JSON.parse(mensaje.text);

    if (interactive.type === 'list_reply') {
      const opcionSeleccionada = interactive.list_reply.id;
      const tituloOpcion = interactive.list_reply.title;

      console.log(`Usuario seleccionó: ${opcionSeleccionada} (${tituloOpcion})`);

      // Procesar según la opción seleccionada
      switch(opcionSeleccionada) {
        case 'srv_consulta':
          // Manejar consulta
          break;
        case 'srv_reclamo':
          // Manejar reclamo
          break;
        // ... etc
      }
    }
  }

  res.sendStatus(200);
});
```

## Validaciones y Límites

### Límites de WhatsApp

- **Botón:** Máximo 20 caracteres
- **Header:** Máximo 60 caracteres
- **Body:** Máximo 1024 caracteres
- **Footer:** Máximo 60 caracteres
- **Título de sección:** Máximo 24 caracteres
- **Título de fila:** Máximo 24 caracteres
- **Descripción de fila:** Máximo 72 caracteres
- **ID de fila:** Máximo 200 caracteres
- **Secciones:** Mínimo 1, máximo 10
- **Filas por sección:** Mínimo 1, máximo 10

### Errores Comunes

#### Error 400: Validación fallida

```json
{
  "error": "Validation Error",
  "details": "Texto del botón no puede exceder 20 caracteres"
}
```

**Solución:** Verifica que todos los campos cumplan con los límites establecidos.

#### Error 401: No autorizado

```json
{
  "error": "No autorizado"
}
```

**Solución:** Verifica que el header `X-API-Key` esté presente y sea correcto.

#### Error 500: Error al enviar

```json
{
  "error": "Error enviando lista a 5493512345678"
}
```

**Solución:** Verifica:
- Que el número de teléfono sea válido
- Que WhatsApp esté configurado correctamente (WHATSAPP_TOKEN, PHONE_NUMBER_ID)
- Que el número tenga WhatsApp activo
- Los logs del dispatcher para más detalles

## Buenas Prácticas

1. **IDs únicos:** Usa IDs descriptivos y únicos para cada opción (ej: `prod_123`, `cat_electronica`)

2. **Descripciones claras:** Aprovecha las descripciones para dar contexto adicional

3. **Organización:** Agrupa opciones relacionadas en la misma sección

4. **Botón descriptivo:** El texto del botón debe indicar la acción (ej: "Ver opciones", "Elegir categoría")

5. **Límite de opciones:** Aunque puedes tener hasta 100 opciones (10 secciones × 10 filas), considera la experiencia del usuario. Listas muy largas pueden ser difíciles de navegar.

6. **Fallback:** Siempre ofrece una opción para contactar a un humano o volver al menú principal

## Integración con el Flujo de Conversación

### Ejemplo de Flujo Completo

```javascript
// 1. Usuario inicia conversación
// Dispatcher recibe mensaje de texto y lo envía al BOT

// 2. BOT procesa y decide enviar lista (mismo endpoint /enviar)
await axios.post('http://dispatcher:8080/enviar', {
  numero: usuario,
  button_text: 'Ver servicios',
  body_text: '¿En qué podemos ayudarte?',
  sections: [
    {
      title: 'Opciones',
      rows: [
        { id: 'hablar_con_asesor', title: 'Hablar con asesor' },
        { id: 'informacion', title: 'Información general' }
      ]
    }
  ]
});
// El dispatcher detecta automáticamente que es una lista por el parámetro 'sections'

// 3. Usuario selecciona opción
// Dispatcher recibe mensaje interactive y lo envía al BOT

// 4. BOT procesa selección
if (mensaje.type === 'interactive') {
  const seleccion = JSON.parse(mensaje.text).list_reply.id;

  if (seleccion === 'hablar_con_asesor') {
    // Transferir a aplicación de asesores
    await axios.post('http://dispatcher:8080/transferir', {
      numero: usuario,
      app_destino: 'asesor',
      contexto: { motivo: 'solicitud_usuario' }
    });
  } else {
    // Responder con mensaje de texto normal (mismo endpoint)
    await axios.post('http://dispatcher:8080/enviar', {
      numero: usuario,
      mensaje: 'Aquí tienes la información que solicitaste...'
    });
    // El dispatcher detecta automáticamente que es texto por no tener 'sections'
  }
}
```

## Monitoreo

Las listas enviadas se registran en las métricas del dispatcher:

```bash
# Ver métricas
curl http://localhost:8080/metrics

# Buscar estadísticas de listas
# listas_enviadas: contador de listas enviadas
```

## Recursos Adicionales

- [Documentación oficial de WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages#interactive-messages)
- [INTEGRACION_TERCEROS.md](./INTEGRACION_TERCEROS.md) - Cómo integrar tu aplicación
- [GUIA_REDIS.md](./GUIA_REDIS.md) - Configuración de Redis

## Soporte

Para reportar problemas o sugerencias, contacta al equipo de desarrollo.
