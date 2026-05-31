#!/bin/bash
# 🧠 Carregar Memória do Dudu - Script de Restauração
# Executar APÓS instalar o Hermes na máquina local
# Uso: bash carregar-memoria.sh

set -e

echo "🧠 Carregando memória do Dudu..."
echo ""

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PROFILE="${HERMES_PROFILE:-futebol}"
PROFILE_DIR="$HERMES_HOME/profiles/$PROFILE"

# ── Verificar se o Hermes está instalado ──
if [ ! -d "$HERMES_HOME" ]; then
    echo "❌ Hermes não encontrado em $HERMES_HOME"
    echo "Instale o Hermes primeiro: https://hermes-agent.nousresearch.com/docs"
    exit 1
fi

# ── Garantir que o profile existe ──
mkdir -p "$PROFILE_DIR/memories"
mkdir -p "$PROFILE_DIR/skills"

# ── Copiar memórias ──
echo "📝 Copiando memórias..."
cp -f hermes-data/memories/USER.md "$PROFILE_DIR/memories/USER.md" 2>/dev/null && echo "  ✅ USER.md" || echo "  ⚠️  USER.md não encontrado"
cp -f hermes-data/memories/MEMORY.md "$PROFILE_DIR/memories/MEMORY.md" 2>/dev/null && echo "  ✅ MEMORY.md" || echo "  ⚠️  MEMORY.md não encontrado"
cp -f hermes-data/memories/SOUL.md "$PROFILE_DIR/memories/SOUL.md" 2>/dev/null && echo "  ✅ SOUL.md" || echo "  ⚠️  SOUL.md não encontrado"

# ── Copiar SOUL.md (personalidade) ──
if [ -f hermes-data/SOUL.md ]; then
    cp hermes-data/SOUL.md "$PROFILE_DIR/SOUL.md"
    echo "  ✅ Personalidade (SOUL.md)"
fi

# ── Copiar skills ──
echo ""
echo "🔧 Copiando skills..."
SKILLS_SRC="hermes-data/skills"
if [ -d "$SKILLS_SRC" ]; then
    for skill_dir in "$SKILLS_SRC"/*/; do
        skill_name=$(basename "$skill_dir")
        if [ -f "$skill_dir/SKILL.md" ]; then
            mkdir -p "$PROFILE_DIR/skills/$skill_name"
            cp -r "$skill_dir/"* "$PROFILE_DIR/skills/$skill_name/"
            echo "  ✅ Skill: $skill_name"
        fi
    done
fi

# ── Configurar profile no Hermes ──
echo ""
echo "⚙️  Ativando profile..."
if command -v hermes &> /dev/null; then
    hermes profile use "$PROFILE" 2>/dev/null && echo "  ✅ Profile '$PROFILE' ativado" || echo "  ⚠️  Crie o profile manualmente: hermes profile create $PROFILE"
else
    echo "  ⚠️  Hermes CLI não encontrado no PATH"
    echo "  Crie o profile $PROFILE manualmente após instalar o Hermes"
fi

echo ""
echo "✅ Memória carregada com sucesso!"
echo "🎯 Agora é só ativar o profile e começar:"
echo "   hermes profile use futebol"
echo "   hermes run (ou inicie no Telegram)"
echo ""
echo "🔥 Bora operar, Everton!"
