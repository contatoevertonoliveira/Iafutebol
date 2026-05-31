#!/bin/bash
# 🚀 Setup Completo - Iafutebol Trading Bot + Supabase Local
# Execute após clonar o repositório na sua máquina local
# Tudo rodando LOCALMENTE = mesmo IP = sem bloqueio Betfair!

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║   🚀 IAFUTEBOL - SETUP COMPLETO             ║"
echo "║   Trading Betfair Local + Supabase Local     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Dependências Python ────────────────────────
echo "📦 [1/5] Instalando dependências Python..."
pip3 install requests python-dotenv 2>/dev/null || pip install requests python-dotenv
echo "  ✅ Python pronto!"
echo ""

# ── 2. Configuração Betfair ───────────────────────
echo "📁 [2/5] Configurando ambiente Betfair..."

# Cria .env a partir do example se não existir
if [ ! -f scripts/.env ]; then
    cp scripts/.env.example scripts/.env
    echo "  ⚠️  EDITE scripts/.env com seu EMAIL e SENHA Betfair!"
else
    echo "  ✅ scripts/.env já existe"
fi

# Cria pasta de certificados se não existir
mkdir -p certs
if ls certs/*.crt 1>/dev/null 2>&1 && ls certs/*.key 1>/dev/null 2>&1; then
    echo "  ✅ Certificados encontrados em certs/"
else
    echo "  ⚠️  COLOQUE SEUS CERTIFICADOS EM certs/"
    echo "     - client-2048.crt"
    echo "     - client-2048.key"
fi

# ── 3. Verificar Docker ────────────────────────────
echo "🐳 [3/5] Verificando Docker..."
if command -v docker &> /dev/null; then
    echo "  ✅ Docker instalado: $(docker --version)"
else
    echo "  ⚠️  Docker não encontrado! Instale para rodar Supabase local:"
    echo "     https://docs.docker.com/engine/install/"
fi
echo ""

# ── 4. Supabase CLI ────────────────────────────────
echo "⚡ [4/5] Verificando Supabase CLI..."
if command -v supabase &> /dev/null; then
    echo "  ✅ Supabase CLI: $(supabase --version)"
else
    echo "  ⚠️  Supabase CLI não encontrado."
    echo "     Instale com:"
    echo "     macOS: brew install supabase/tap/supabase"
    echo "     Linux: curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.deb -o /tmp/supabase.deb && sudo dpkg -i /tmp/supabase.deb"
    echo "     Ou: npm install -g supabase"
fi
echo ""

# ── 5. Carregar Memória do Dudu ───────────────────
echo "🧠 [5/5] Carregando memória do Dudu..."
if [ -f hermes-data/carregar-memoria.sh ]; then
    echo "  ✅ Script de memória encontrado!"
    echo "  ▶️  Execute depois que o Hermes estiver instalado:"
    echo "     bash hermes-data/carregar-memoria.sh"
else
    echo "  ⚠️  Pacote hermes-data não encontrado (push mais recente?)"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✅ SETUP CONCLUÍDO!                        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo ""
echo "1️⃣  EDITAR CREDENCIAIS"
echo "    Edite scripts/.env com seu email e senha Betfair"
echo ""
echo "2️⃣  COLOCAR CERTIFICADOS"
echo "    Copie client-2048.crt e client-2048.key para a pasta certs/"
echo ""
echo "3️⃣  INICIAR SUPABASE LOCAL (Docker)"
echo "    cd $(pwd)"
echo "    supabase start"
echo "    supabase functions serve betfair-core-server-1119702f --env-file supabase/functions/betfair-core-server-1119702f/secrets.env"
echo ""
echo "4️⃣  TESTAR AUTENTICAÇÃO DIRETA"
echo "    cd scripts && python3 trade.py funds"
echo ""
echo "5️⃣  INSTALAR HERMES + CARREGAR MEMÓRIA"
echo "    bash hermes-data/carregar-memoria.sh"
echo ""
echo "🔥 Tudo local = mesmo IP = sem bloqueios = BORA TRADAR!"
echo ""
