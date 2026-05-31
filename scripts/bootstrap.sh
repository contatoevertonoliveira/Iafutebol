#!/bin/bash
# ==============================================================
# 🚀 IA Futebol - Bootstrap Definitivo
# ==============================================================
# Esse script resolve TUDO:
#   git pull, gera certificados, atualiza base64 inline,
#   sobe o Supabase local, testa saúde
# ==============================================================
# Uso: ./scripts/bootstrap.sh [--force]
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()    { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; }
ok()     { echo -e "${GREEN}  ✅ $1${NC}"; }
warn()   { echo -e "${YELLOW}  ⚠️  $1${NC}"; }
fail()   { echo -e "${RED}  ❌ $1${NC}" >&2; }

FORCE="${1:-}"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   🚀 IA Futebol - Bootstrap Definitivo  ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ==============================================================
# PASSO 1
# ==============================================================
log "📦 Passo 1/5: Sincronizando com GitHub..."
if git pull origin main 2>&1; then
  ok "Repositório atualizado!"
else
  warn "Git pull falhou. Seguindo com código local..."
fi

# ==============================================================
# PASSO 2
# ==============================================================
log "🔐 Passo 2/5: Verificando certificados..."

CERTS_DIR="$SCRIPT_DIR/certs"
mkdir -p "$CERTS_DIR"

CERT_FILE="$CERTS_DIR/betfair-test.pem"
KEY_FILE="$CERTS_DIR/betfair-test.key"

generate_certs() {
  log "  Gerando novo par de certificados auto-assinados..."
  openssl req -x509 -newkey rsa:2048 -keyout "$KEY_FILE" \
    -out "$CERT_FILE" -days 365 -nodes \
    -subj "/CN=BetfairTest/O=IAFutebol/C=BR" \
    -addext "extendedKeyUsage=clientAuth" 2>/dev/null
  chmod 600 "$KEY_FILE" "$CERT_FILE"
  ok "Certificados gerados!"
}

if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  warn "Certificados não encontrados! Gerando novos..."
  generate_certs
elif [ "$FORCE" = "--force" ]; then
  warn "Forçando regeneração dos certificados..."
  generate_certs
else
  SZ=$(stat -c%s "$CERT_FILE" 2>/dev/null || stat -f%z "$CERT_FILE" 2>/dev/null)
  ok "Certificados OK (${SZ:-?} bytes)"
fi

# ==============================================================
# PASSO 3
# ==============================================================
log "📝 Passo 3/5: Atualizando inline base64 das secrets..."

INDEX_FILE="$SCRIPT_DIR/supabase/functions/betfair-core-server-1119702f/index.ts"
SECRETS_FILE="$SCRIPT_DIR/supabase/functions/betfair-core-server-1119702f/secrets.env"

if [ ! -f "$INDEX_FILE" ]; then
  fail "index.ts não encontrado em $INDEX_FILE"
  exit 1
fi

if [ -f "$SECRETS_FILE" ]; then
  python3 "$SCRIPT_DIR/scripts/update_b64.py" \
    "$SECRETS_FILE" "$CERT_FILE" "$KEY_FILE" "$INDEX_FILE" 2>&1
  if [ $? -eq 0 ]; then
    ok "Base64 inline atualizado com sucesso!"
  else
    warn "Falha ao atualizar base64 (veja erro acima)"
  fi
else
  warn "secrets.env não encontrado - pulando atualização"
fi

# ==============================================================
# PASSO 4
# ==============================================================
log "🔥 Passo 4/5: Iniciando Supabase local..."

SUPABASE_DIR="$SCRIPT_DIR/supabase"
if [ -d "$SUPABASE_DIR" ]; then
  if command -v npx &>/dev/null && npx supabase --version &>/dev/null 2>&1; then
    SUPACMD="npx supabase"
  elif command -v supabase &>/dev/null; then
    SUPACMD="supabase"
  else
    warn "Supabase CLI não encontrado (npm install -g supabase)"
    SUPACMD=""
  fi

  if [ -n "$SUPACMD" ]; then
    log "  Parando instância anterior..."
    (cd "$SUPABASE_DIR" && $SUPACMD stop 2>/dev/null) || true
    sleep 2
    log "  Iniciando Supabase..."
    if (cd "$SUPABASE_DIR" && $SUPACMD start 2>&1); then
      ok "Supabase rodando! 🚀"
    else
      warn "Supabase start falhou"
    fi
  fi
else
  warn "Diretório supabase/ não encontrado"
fi

cd "$SCRIPT_DIR"

# ==============================================================
# PASSO 5
# ==============================================================
log "💚 Passo 5/5: Verificando saúde..."

if command -v docker &>/dev/null; then
  EDGE=$(docker ps --filter "name=supabase_edge_runtime" --format "{{.Names}}" 2>/dev/null | head -1)
  if [ -n "$EDGE" ]; then
    ok "Edge Runtime rodando: $EDGE"
  fi
fi

if curl -sf http://localhost:54321/functions/v1/ping &>/dev/null 2>&1; then
  ok "Functions respondendo na porta 54321!"
else
  warn "Functions não responderam (aguarde alguns segundos)"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ BOOTSTRAP COMPLETO!                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  📁 Projeto: $SCRIPT_DIR"
echo "  🔐 Certs:   $CERTS_DIR/"
echo "  🔧 Script:  ./scripts/bootstrap.sh"
echo "  🔧 Forçar:  ./scripts/bootstrap.sh --force"
echo ""
