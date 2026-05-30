import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bot, Copy, Settings as SettingsIcon, Trash2, Wrench, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { loadApiConfig } from '../services/apiConfig';

type SystemBotKey = 'scalpingTicks' | 'overGoalsLimit' | 'asianHandicap' | 'correctScore' | 'favoriteRescue';

type BotRequestV1 = {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  objective: string;
  market: string;
  baseBotKey: SystemBotKey | 'novo';
  safetyNotes: string;
};

type BotRequestsStoreV1 = {
  version: 1;
  items: BotRequestV1[];
};

const nowIso = () => new Date().toISOString();
const newId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const requestsKey = 'bot_requests_v1';

const readRequests = (): BotRequestsStoreV1 => {
  try {
    const raw = localStorage.getItem(requestsKey);
    if (!raw) return { version: 1, items: [] };
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return { version: 1, items: [] };
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return { version: 1, items: [] };
    return { version: 1, items: parsed.items as BotRequestV1[] };
  } catch {
    return { version: 1, items: [] };
  }
};

const writeRequests = (store: BotRequestsStoreV1) => {
  localStorage.setItem(requestsKey, JSON.stringify(store));
};

const getStakeLabel = (rawAbs: unknown, rawPct: unknown) => {
  const abs = Number(rawAbs);
  if (Number.isFinite(abs) && abs > 0) return `R$ ${abs.toFixed(2)}`;
  const pct = Number(rawPct);
  if (Number.isFinite(pct) && pct > 0) return `${pct.toFixed(2)}% banca`;
  return '—';
};

export default function BotsPage() {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [activeTab, setActiveTab] = useState<'catalog' | 'requests'>('catalog');

  const cfg = useMemo(() => loadApiConfig(), [tick]);
  const botLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};

  const systemBots = useMemo(() => {
    const stakeScalping = getStakeLabel((botLimits as any)?.scalpingTicks?.stakeAbs, (botLimits as any)?.scalpingTicks?.stakePct);
    const stakeOver = getStakeLabel((botLimits as any)?.overGoalsLimit?.stakeAbs, (botLimits as any)?.overGoalsLimit?.stakePct);
    const stakeAh = getStakeLabel((botLimits as any)?.asianHandicap?.stakeAbs, (botLimits as any)?.asianHandicap?.stakePct);
    const stakeCs = getStakeLabel((botLimits as any)?.correctScore?.stakeAbs, (botLimits as any)?.correctScore?.stakePct);
    const favEnabled = Boolean((botLimits as any)?.favoriteRescue?.enabled);
    return [
      {
        key: 'scalpingTicks' as const,
        title: 'Scalping em Ticks',
        desc: 'Scalping no O/U com alerta de gol, travas de entrada e modo late (>= 75’).',
        tags: ['O/U', 'ticks', 'alerta de gol'],
        stake: stakeScalping,
      },
      {
        key: 'overGoalsLimit' as const,
        title: 'Over Gols (Limite)',
        desc: 'Entrada em BACK no Over quando há alerta de gol e saída imediata quando o alerta cessa.',
        tags: ['O/U', 'momentum'],
        stake: stakeOver,
      },
      {
        key: 'asianHandicap' as const,
        title: 'Asian Handicap',
        desc: 'Operação em AH com filtros de confiança e take profit automático por ticks.',
        tags: ['AH', 'ticks'],
        stake: stakeAh,
      },
      {
        key: 'correctScore' as const,
        title: 'Correct Score',
        desc: 'Dutcher (cobertura) em placares configurados com adoção de ordens existentes.',
        tags: ['CS', 'dutching'],
        stake: stakeCs,
      },
      {
        key: 'favoriteRescue' as const,
        title: 'Favorite Rescue',
        desc: 'Scout/Resgate do favorito com travas e regras de segurança.',
        tags: ['Match Odds', 'CS'],
        stake: favEnabled ? 'Ativo' : 'Inativo',
      },
    ] as const;
  }, [botLimits]);

  const requests = useMemo(() => {
    return readRequests().items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [tick]);

  const [reqName, setReqName] = useState('');
  const [reqObjective, setReqObjective] = useState('');
  const [reqMarket, setReqMarket] = useState('Over/Under');
  const [reqBase, setReqBase] = useState<SystemBotKey | 'novo'>('scalpingTicks');
   const [reqSafety, setReqSafety] = useState(
     'Obrigatório: entryLocks persistidos + customerRef estável (<=32 chars), adoção de ordens existentes, stake via modo (% banca ou R$), persistir estado só após placeOrders OK.',
   );

   // Chat state
   const [messages, setMessages] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);
   const [inputValue, setInputValue] = useState('');
   const [loading, setLoading] = useState(false);

   useEffect(() => {
     const onCfg = () => setTick((v) => v + 1);
     window.addEventListener('apiConfigChanged', onCfg);
     return () => window.removeEventListener('apiConfigChanged', onCfg);
   }, []);

   const copy = async (text: string) => {
     try {
       await navigator.clipboard.writeText(text);
       toast.success('Copiado para a área de transferência');
     } catch {
       toast.error('Falha ao copiar');
     }
   };

   const sendMessage = async () => {
     if (!inputValue.trim() || loading) return;

     const userMessage = inputValue;
     setInputValue('');
     setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
     setLoading(true);

     try {
       const config = loadApiConfig();
       if (!config || !config.googleApiKey) {
         throw new Error('Google API key not configured');
       }

       const apiKey = config.googleApiKey;
       const model = config.googleModel || 'gemma-4-26b-a4b-it';

       // Prepare the chat history in the format expected by the Google API
       const history = messages.map(msg => ({
         role: msg.role === 'user' ? 'user' : 'model',
         parts: [{ text: msg.content }]
       }));

       // Add the current user message
       history.push({
         role: 'user',
         parts: [{ text: userMessage }]
       });

       const response = await fetch(
         `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
         {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({
             contents: history,
             generationConfig: {
               temperature: 0.7,
               topK: 40,
               topP: 0.95,
               maxOutputTokens: 1024,
             },
           })
         }
       );

       if (!response.ok) {
         throw new Error(`API error: ${response.status}`);
       }

       const data = await response.json();
       let aiResponse = '';
       if (data.candidates && data.candidates.length > 0) {
         const candidate = data.candidates[0];
         if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
           aiResponse = candidate.content.parts[0].text || '';
         }
       }

       if (!aiResponse) {
         throw new Error('No response from AI');
       }

       setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
     } catch (error: any) {
       console.error('Error chatting with AI:', error);
       toast.error('Falha ao comunicar com a IA: ' + error?.message || 'Erro desconhecido');
     } finally {
       setLoading(false);
     }
   };

  const buildBrief = (r: BotRequestV1) => {
    const base = r.baseBotKey === 'novo' ? 'Novo (do zero)' : r.baseBotKey;
    return [
      'Quero criar um novo robô Betfair para o sistema (Iafutebol).',
      '',
      `Nome: ${r.name}`,
      `Objetivo: ${r.objective}`,
      `Mercado alvo: ${r.market}`,
      `Base/Referência: ${base}`,
      '',
      'Requisitos obrigatórios do sistema:',
      '- Impedir múltiplas entradas com entryLocks persistidos (KV) e customerRef estável (<= 32 chars).',
      '- O robô deve adotar posições existentes (adoptedExisting) antes de tentar novas entradas.',
      '- Estado de “entrada realizada” só pode ser persistido após confirmação de sucesso do placeOrders.',
      '- Stake padrão: um modo único (% banca ou R$) e tipagem consistente no apiConfig + UI.',
      '',
      'Entregáveis mínimos:',
      '- Backend (Edge Function automation-server): endpoint /strategy/<novoBot>/tick com idempotência + locks.',
      '- Frontend: Settings (parâmetros), AutomationPage (tick), Layout (runner global), histórico do dia.',
      '',
      `Notas de segurança/regras extras: ${r.safetyNotes}`,
    ].join('\n');
  };

  const addRequest = () => {
    const name = reqName.trim();
    const objective = reqObjective.trim();
    if (!name || name.length < 3) {
      toast.error('Informe um nome válido para o robô');
      return;
    }
    if (!objective || objective.length < 8) {
      toast.error('Descreva melhor o objetivo do robô');
      return;
    }
    const store = readRequests();
    const now = nowIso();
    const next: BotRequestV1 = {
      version: 1,
      id: newId(),
      createdAt: now,
      updatedAt: now,
      name,
      objective,
      market: String(reqMarket || 'Over/Under'),
      baseBotKey: reqBase,
      safetyNotes: reqSafety.trim(),
    };
    writeRequests({ version: 1, items: [next, ...store.items] });
    setReqName('');
    setReqObjective('');
    setActiveTab('requests');
    setTick((v) => v + 1);
    toast.success('Pedido criado');
  };

  const removeRequest = (id: string) => {
    const store = readRequests();
    writeRequests({ version: 1, items: store.items.filter((x) => x.id !== id) });
    setTick((v) => v + 1);
    toast.success('Removido');
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            <h1 className="text-xl font-semibold">Bots</h1>
            <Badge variant="secondary">Sistema Betfair</Badge>
          </div>
          <div className="text-sm text-gray-600 mt-1">
            Catálogo dos robôs do sistema e criação de pedidos padronizados para adicionar novos robôs com integração completa.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/automation')}>Abrir Automações</Button>
          <Button variant="outline" onClick={() => navigate('/settings')}>
            <SettingsIcon className="h-4 w-4 mr-2" />
            Configurações
          </Button>
        </div>
      </div>

       <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="catalog">Robôs do sistema</TabsTrigger>
          <TabsTrigger value="requests">Pedidos de novos robôs</TabsTrigger>
          <TabsTrigger value="chat">Chat com IA</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog">
          <div className="grid md:grid-cols-2 gap-3">
            {systemBots.map((b) => (
              <Card key={b.key} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-gray-900 truncate">{b.title}</div>
                      <Badge variant="secondary" className="tabular-nums">Stake: {b.stake}</Badge>
                    </div>
                    <div className="text-sm text-gray-600 mt-1">{b.desc}</div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {b.tags.map((t) => (
                        <Badge key={t} variant="outline">{t}</Badge>
                      ))}
                    </div>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => setActiveTab('requests')}>
                        <Wrench className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Gerar pedido baseado neste robô</TooltipContent>
                  </Tooltip>
                </div>
              </Card>
            ))}
          </div>

          <Card className="p-4 mt-4">
            <div className="font-semibold text-gray-900">Padrão de criação (o que um robô precisa ter)</div>
            <div className="text-sm text-gray-600 mt-1">
              Todo robô novo deve seguir idempotência, locks e adoção de ordens existentes para operar com segurança na Betfair.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline">entryLocks (KV)</Badge>
              <Badge variant="outline">customerRef estável (≤ 32)</Badge>
              <Badge variant="outline">adopt existing</Badge>
              <Badge variant="outline">stake mode (% ou R$)</Badge>
              <Badge variant="outline">state pós-sucesso</Badge>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="requests">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="font-semibold text-gray-900">Criar pedido</div>
              <div className="text-sm text-gray-600 mt-1">
                Isso gera um “brief” padrão para você colar no chat quando for pedir um robô novo.
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">Nome do robô</div>
                  <Input value={reqName} onChange={(e) => setReqName(e.target.value)} placeholder="Ex: Under Protegido 1ºT" className="mt-2" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">Objetivo (bem direto)</div>
                  <Textarea value={reqObjective} onChange={(e) => setReqObjective(e.target.value)} placeholder="O que ele faz, quando entra, como sai e o porquê." className="mt-2 min-h-[110px]" />
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">Mercado</div>
                    <Input value={reqMarket} onChange={(e) => setReqMarket(e.target.value)} placeholder="Ex: Over/Under, Match Odds, BTTS, AH..." className="mt-2" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">Base</div>
                    <select
                      className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                      value={reqBase}
                      onChange={(e) => setReqBase(e.target.value as any)}
                    >
                      <option value="scalpingTicks">Scalping em Ticks</option>
                      <option value="overGoalsLimit">Over Gols (Limite)</option>
                      <option value="asianHandicap">Asian Handicap</option>
                      <option value="correctScore">Correct Score</option>
                      <option value="favoriteRescue">Favorite Rescue</option>
                      <option value="novo">Novo (do zero)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">Regras de segurança / observações</div>
                  <Textarea value={reqSafety} onChange={(e) => setReqSafety(e.target.value)} className="mt-2 min-h-[90px]" />
                </div>

                <div className="flex justify-end">
                  <Button onClick={addRequest}>Criar pedido</Button>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="font-semibold text-gray-900">Pedidos salvos</div>
              <div className="text-sm text-gray-600 mt-1">
                Copie o brief e cole no chat quando quiser que o robô seja implementado e integrado ao sistema.
              </div>

              <div className="mt-4 space-y-3">
                {requests.length === 0 ? (
                  <div className="text-sm text-gray-600">Nenhum pedido criado ainda.</div>
                ) : null}
                {requests.map((r) => (
                  <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate">{r.name}</div>
                        <div className="text-[11px] text-gray-600 tabular-nums mt-1">{r.updatedAt}</div>
                        <div className="text-sm text-gray-700 mt-2 line-clamp-3">{r.objective}</div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="secondary">{r.market}</Badge>
                          <Badge variant="outline">{r.baseBotKey === 'novo' ? 'novo' : r.baseBotKey}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={() => copy(buildBrief(r))}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copiar brief</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => removeRequest(r.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Excluir</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>
         <TabsContent value="chat">
           <Card className="p-6 space-y-4">
             <div className="flex items-center gap-3">
               <MessageSquare className="h-5 w-5" />
               <h1 className="text-xl font-semibold">Chat com IA (Gemma 4)</h1>
               {loading && <span className="animate-pulse">Conectando...</span>}
             </div>
             <div className="text-sm text-gray-600">
               Converse com o modelo Gemma 4 do Google para obter ajuda com estratégias, dúvidas técnicas ou sugestões para seus robôs.
             </div>
             
             {/* Chat messages */}
             <div className="h-[400px] overflow-y-auto border rounded px-4 py-3 mb-4 space-y-4 bg-gray-50">
               {messages.length === 0 ? (
                 <div className="text-center py-8 text-gray-500">
                   Comece a conversa enviando uma mensagem abaixo.
                 </div>
               ) : (
                 <>
                   {messages.map((msg, index) => (
                     <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} max-w-[80%] ${msg.role === 'user' ? 'ml-auto' : 'mr-auto'}`}>
                       <div className={`${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-900'} rounded-lg px-4 py-2 max-w-xs break-words`}>
                         {msg.content}
                       </div>
                     </div>
                   ))}
                 </>
               )}
             </div>
             
             {/* Input area */}
             <div className="flex gap-2">
               <textarea
                 value={inputValue}
                 onChange={(e) => setInputValue(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && !e.shiftKey) {
                     e.preventDefault();
                     sendMessage();
                   }
                 }}
                 placeholder="Digite sua mensagem para a IA..."
                 className="flex-1 min-h-[60px] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                 disabled={loading}
               />
               <Button onClick={sendMessage} disabled={loading} className="px-4 py-2">
                 {loading ? 'Enviando...' : 'Enviar'}
               </Button>
             </div>
           </Card>
        </TabsContent>
       </Tabs>
     </div>
   );
 }

