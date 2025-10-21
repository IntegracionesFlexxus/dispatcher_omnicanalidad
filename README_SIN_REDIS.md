# WhatsApp Dispatcher - Sin Redis (Almacenamiento en Memoria)

## 🚀 Inicio Rápido

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar .env

```bash
# Ya está configurado, solo verifica que tengas:
# - WHATSAPP_TOKEN
# - PHONE_NUMBER_ID
# - BOT_APP y ASESOR_APP
```

### 3. Iniciar

```bash
npm run dev
```

### 4. Verificar que funciona

```bash
curl http://localhost:8081/health
```

## ⚠️ Importante

**Almacenamiento en MEMORIA:**
- ✅ Muy rápido
- ✅ Simple, sin dependencias externas
- ❌ Los datos se pierden al reiniciar
- ❌ No funciona con múltiples instancias (cada una tiene su propia memoria)

**Recomendado para:**
- Pruebas locales
- Desarrollo
- Demos

**NO recomendado para:**
- Producción
- Múltiples instancias
- Datos que necesiten persistir

## 📡 Endpoints Disponibles

### Health Check
```bash
curl http://localhost:8081/health
```

### Ver Apps Registradas
```bash
curl http://localhost:8081/aplicaciones
```

### Transferir Conversación
```bash
curl -X POST http://localhost:8081/transferir \
  -H "Content-Type: application/json" \
  -H "X-API-Key: LO_QUE_QUIERAS" \
  -d '{
    "numero": "5493512345678",
    "app_destino": "asesor",
    "contexto": {"test": true}
  }'
```

### Ver Estado
```bash
curl http://localhost:8081/estado \
  -H "X-API-Key: LO_QUE_QUIERAS"
```

## 🔄 Instalar Redis Más Adelante

Si necesitas persistencia, ver: `docs/GUIA_REDIS.md`

## 🐛 Troubleshooting

### Error: "Cannot find module 'redis'"
**Solución:** Ya no necesitas redis, ejecuta:
```bash
npm install
```

### Puerto 8081 ocupado
**Solución:** Cambiar `PORT=8082` en `.env`

### Apps no reciben mensajes
**Verificar:**
1. El bot está corriendo en puerto 4800
2. El software está corriendo en puerto 3001
3. Las URLs en `.env` son correctas

## 📚 Más Información

- Ver README.md completo para toda la documentación
- Ver PLAN_DESARROLLO.md para el roadmap completo
