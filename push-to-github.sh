#!/bin/bash

# Script para fazer push das atualizações para o GitHub
# Execute este script manualmente com suas credenciais

echo "🚀 Preparando para fazer push das atualizações do Iafutebol"
echo "=========================================================="

# Verificar status
echo "📊 Status atual do repositório:"
git status

echo ""
echo "📝 Resumo das mudanças:"
echo "----------------------"
echo "✅ Sistema de treinamento otimizado com worker em background"
echo "✅ Dashboard de treinamento (/training) com controle granular"
echo "✅ Sistema de checkpoints automáticos e early stopping"
echo "✅ Datasets incrementais com download inteligente"
echo "✅ Sistema de notificações multi-canal"
echo "✅ Correções CORS para football-data.org"
echo "✅ Configuração Vite otimizada para HMR e proxy"
echo "✅ 17 arquivos modificados/criados"

echo ""
echo "🔧 Para fazer push manualmente:"
echo "-------------------------------"
echo "1. Configure suas credenciais do GitHub:"
echo "   git config --global user.email 'seu-email@exemplo.com'"
echo "   git config --global user.name 'Seu Nome'"
echo ""
echo "2. Use um token de acesso pessoal:"
echo "   git remote set-url origin https://SEU_TOKEN@github.com/contatoevertonoliveira/Iafutebol.git"
echo ""
echo "3. Ou configure chave SSH:"
echo "   - Gere chave SSH: ssh-keygen -t ed25519 -C 'seu-email@exemplo.com'"
echo "   - Adicione ao GitHub: https://github.com/settings/keys"
echo ""
echo "4. Execute o push:"
echo "   git push origin main"
echo ""
echo "📄 Mais detalhes no arquivo CHANGELOG.md"

# Tentar push (pode falhar sem credenciais)
echo ""
echo "🔄 Tentando push automático..."
if git push origin main; then
    echo "✅ Push realizado com sucesso!"
else
    echo "❌ Falha no push. Configure as credenciais conforme instruções acima."
    echo ""
    echo "💡 Dica rápida para token:"
    echo "1. Acesse: https://github.com/settings/tokens"
    echo "2. Crie novo token com permissão 'repo'"
    echo "3. Use: git remote set-url origin https://SEU_TOKEN@github.com/contatoevertonoliveira/Iafutebol.git"
    echo "4. Execute: git push origin main"
fi