#!/bin/bash
# 🚀 Setup - Iafutebol Trading Bot
# Execute após clonar o repositório na sua máquina local

set -e

echo "🚀 Instalando dependências..."
pip3 install requests python-dotenv 2>/dev/null || pip install requests python-dotenv

echo ""
echo "📁 Configurando ambiente..."

# Cria .env a partir do example se não existir
if [ ! -f scripts/.env ]; then
    cp scripts/.env.example scripts/.env
    echo "⚠️  EDITE O ARQUIVO scripts/.env com suas credenciais Betfair!"
fi

# Cria pasta de certificados se não existir
mkdir -p certs
if [ ! -f certs/client-2048.crt ]; then
    echo "⚠️  COLOQUE SEUS CERTIFICADOS em:"
    echo "   - $(pwd)/certs/client-2048.crt"
    echo "   - $(pwd)/certs/client-2048.key"
fi

echo ""
echo "✅ Setup concluído!"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo "1️⃣  Edite scripts/.env com seu email e senha Betfair"
echo "2️⃣  Coloque os certificados .crt e .key em certs/"
echo "3️⃣  Teste a autenticação: cd scripts && python3 trade.py funds"
echo "4️⃣  Veja jogos ao vivo: python3 trade.py catalogue"
echo ""
echo "🔥 Bons trades!"
