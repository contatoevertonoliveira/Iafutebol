import { Brain, Cpu, Database, Bell, BarChart3 } from 'lucide-react';
import TrainingControlPanel from '../components/TrainingControlPanel';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

export default function TrainingDashboard() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-10 h-10 text-purple-600" />
            <div>
              <h1 className="text-4xl font-bold text-gray-900">Dashboard de Treinamento</h1>
              <p className="text-gray-600">
                Sistema otimizado de treinamento dos agentes de IA
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge className="bg-green-100 text-green-800 border-green-300">
              <Cpu className="w-3 h-3 mr-1" />
              Worker em Background
            </Badge>
            <Badge className="bg-blue-100 text-blue-800 border-blue-300">
              <Database className="w-3 h-3 mr-1" />
              Datasets Incrementais
            </Badge>
            <Badge className="bg-purple-100 text-purple-800 border-purple-300">
              <Bell className="w-3 h-3 mr-1" />
              Sistema de Notificações
            </Badge>
            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
              <BarChart3 className="w-3 h-3 mr-1" />
              Checkpoints Automáticos
            </Badge>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Cpu className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-lg font-bold text-blue-900">Worker em Background</h3>
            </div>
            <p className="text-blue-800 text-sm">
              Treinamento não bloqueia a interface. Continue navegando normalmente enquanto os agentes aprendem em segundo plano.
            </p>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-100 rounded-lg">
                <Database className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-green-900">Datasets Incrementais</h3>
            </div>
            <p className="text-green-800 text-sm">
              Baixa apenas dados novos. Não re-baixa tudo sempre. Otimiza tempo e banda.
            </p>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Bell className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-lg font-bold text-purple-900">Sistema Inteligente</h3>
            </div>
            <p className="text-purple-800 text-sm">
              Checkpoints automáticos, early stopping, notificações e retomada de treinamentos interrompidos.
            </p>
          </Card>
        </div>

        {/* Features Grid */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Funcionalidades Implementadas</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">✅ Checkpoints Automáticos</h4>
              <p className="text-sm text-gray-600">
                Salva progresso a cada N épocas. Permite retomar de onde parou.
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">✅ Early Stopping</h4>
              <p className="text-sm text-gray-600">
                Para automaticamente se accuracy não melhorar. Evita overfitting.
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">✅ Notificações Multi-canal</h4>
              <p className="text-sm text-gray-600">
                Toast no navegador, email e Slack. Configurável por evento.
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">✅ Controle Granular</h4>
              <p className="text-sm text-gray-600">
                Pausa, retomada, interrupção. Controle total do treinamento.
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">✅ Monitoramento em Tempo Real</h4>
              <p className="text-sm text-gray-600">
                Acompanhe progresso, accuracy, tempo restante e uso de recursos.
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">✅ Limpeza Automática</h4>
              <p className="text-sm text-gray-600">
                Remove sessões antigas automaticamente. Mantém storage otimizado.
              </p>
            </div>
          </div>
        </div>

        {/* Painel de Controle Principal */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Painel de Controle</h2>
          <p className="text-gray-600 mb-6">
            Controle completo do sistema de treinamento. Inicie, pause, retome ou interrompa treinamentos.
            Configure notificações e gerencie datasets.
          </p>
          <TrainingControlPanel />
        </div>

        {/* Instructions */}
        <Card className="p-6 bg-gradient-to-br from-gray-50 to-gray-100">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Como Usar</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-gray-800">1. Configurar Kaggle</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Crie conta em kaggle.com</li>
                <li>• Obtenha API key</li>
                <li>• Configure em Settings</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-gray-800">2. Baixar Dataset</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Clique em "Atualizar" no dataset</li>
                <li>• Sistema baixa apenas dados novos</li>
                <li>• Pronto para treinar</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-gray-800">3. Iniciar Treinamento</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Escolha o agente</li>
                <li>• Clique em "Iniciar"</li>
                <li>• Continue usando o sistema</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}