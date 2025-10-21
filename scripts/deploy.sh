#!/bin/bash

# Script de deployment para Dispatcher
# Uso: ./scripts/deploy.sh [environment]
# Ejemplo: ./scripts/deploy.sh production

set -e  # Exit on error

ENVIRONMENT=${1:-production}
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Iniciando deployment - Entorno: ${ENVIRONMENT}${NC}"
echo ""

# Validar entorno
if [ "$ENVIRONMENT" != "production" ] && [ "$ENVIRONMENT" != "staging" ]; then
    echo -e "${RED}❌ Entorno inválido. Usar: production o staging${NC}"
    exit 1
fi

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ No se encuentra package.json. Ejecutar desde el root del proyecto.${NC}"
    exit 1
fi

# Backup de .env actual
echo -e "${YELLOW}📦 Creando backup de configuración...${NC}"
if [ -f ".env.${ENVIRONMENT}" ]; then
    cp .env.${ENVIRONMENT} .env.${ENVIRONMENT}.backup.$(date +%Y%m%d_%H%M%S)
fi

# Pull latest code
echo -e "${YELLOW}📥 Actualizando código...${NC}"
git pull origin main

# Build Docker image
echo -e "${YELLOW}🔨 Building Docker image...${NC}"
if [ "$ENVIRONMENT" = "production" ]; then
    docker-compose -f docker-compose.prod.yml build
else
    docker-compose build
fi

# Stop old containers
echo -e "${YELLOW}⏹️  Deteniendo contenedores antiguos...${NC}"
if [ "$ENVIRONMENT" = "production" ]; then
    docker-compose -f docker-compose.prod.yml down
else
    docker-compose down
fi

# Start new containers
echo -e "${YELLOW}▶️  Iniciando contenedores nuevos...${NC}"
if [ "$ENVIRONMENT" = "production" ]; then
    docker-compose -f docker-compose.prod.yml up -d
else
    docker-compose up -d
fi

# Wait for services to be ready
echo -e "${YELLOW}⏳ Esperando que los servicios estén listos...${NC}"
sleep 10

# Health check
echo -e "${YELLOW}🏥 Verificando health check...${NC}"
MAX_RETRIES=10
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Health check OK${NC}"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo -e "${YELLOW}⏳ Esperando... (${RETRY_COUNT}/${MAX_RETRIES})${NC}"
        sleep 3
    fi
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ Health check falló después de ${MAX_RETRIES} intentos${NC}"
    echo -e "${RED}❌ Deployment FALLÓ${NC}"

    # Rollback
    echo -e "${YELLOW}🔄 Haciendo rollback...${NC}"
    if [ "$ENVIRONMENT" = "production" ]; then
        docker-compose -f docker-compose.prod.yml down
    else
        docker-compose down
    fi

    exit 1
fi

# Ver logs
echo ""
echo -e "${GREEN}✅ Deployment completado exitosamente${NC}"
echo ""
echo -e "${YELLOW}📊 Ver logs:${NC}"
if [ "$ENVIRONMENT" = "production" ]; then
    echo "   docker-compose -f docker-compose.prod.yml logs -f dispatcher"
else
    echo "   docker-compose logs -f dispatcher"
fi
echo ""
echo -e "${YELLOW}📈 Ver estado:${NC}"
echo "   curl http://localhost:8080/estado -H 'X-API-Key: tu_api_key'"
echo ""
