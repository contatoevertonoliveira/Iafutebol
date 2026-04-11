import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Star, TrendingUp, Zap } from 'lucide-react';
import { Badge } from './ui/badge';

interface PremiumMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeCrest: string;
  awayCrest: string;
  league: string;
  time: string;
  aiConfidence: number;
  prediction: string;
  odds: number;
  potentialReturn: number;
  isPremium: boolean;
  tags: string[];
}

interface PremiumCarouselProps {
  matches: PremiumMatch[];
  onMatchClick: (matchId: string) => void;
}

export function PremiumCarousel({ matches, onMatchClick }: PremiumCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  useEffect(() => {
    if (!isAutoPlaying || matches.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % matches.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [isAutoPlaying, matches.length]);

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev + 1) % matches.length);
    setIsAutoPlaying(false);
  };

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length);
    setIsAutoPlaying(false);
  };

  if (matches.length === 0) {
    return null;
  }

  const currentMatch = matches[currentIndex];

  return (
    <div className="relative bg-gradient-to-br from-yellow-400 via-orange-500 to-red-500 rounded-2xl overflow-hidden shadow-2xl mb-8">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }} />
      </div>

      {/* Content */}
      <div className="relative p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 backdrop-blur rounded-lg">
              <Star className="w-6 h-6 text-yellow-200 fill-yellow-200" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Jogo Premium do Dia</h2>
              <p className="text-white/80 text-sm">Alta probabilidade de retorno</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {matches.map((_, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCurrentIndex(idx);
                  setIsAutoPlaying(false);
                }}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === currentIndex 
                    ? 'bg-white w-6' 
                    : 'bg-white/40 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Match Display */}
        <div className="grid md:grid-cols-2 gap-8 items-center">
          {/* Teams */}
          <div className="space-y-6">
            {/* Home Team */}
            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-4 border border-white/20">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white rounded-lg p-2 flex items-center justify-center">
                  {currentMatch.homeCrest ? (
                    <img src={currentMatch.homeCrest} alt={currentMatch.homeTeam} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-2xl">🏆</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-white font-bold text-xl">{currentMatch.homeTeam}</div>
                  <div className="text-white/70 text-sm">{currentMatch.league}</div>
                </div>
              </div>
            </div>

            <div className="text-center">
              <div className="text-white/80 text-lg mb-2">VS</div>
              <div className="text-white font-semibold">{currentMatch.time}</div>
            </div>

            {/* Away Team */}
            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-4 border border-white/20">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white rounded-lg p-2 flex items-center justify-center">
                  {currentMatch.awayCrest ? (
                    <img src={currentMatch.awayCrest} alt={currentMatch.awayTeam} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-2xl">🏆</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-white font-bold text-xl">{currentMatch.awayTeam}</div>
                  <div className="text-white/70 text-sm">{currentMatch.league}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Prediction Details */}
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
            <div className="space-y-4">
              {/* AI Confidence */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white/80 text-sm">Confiança da IA</span>
                  <span className="text-white font-bold text-2xl">{currentMatch.aiConfidence}%</span>
                </div>
                <div className="w-full bg-white/20 rounded-full h-3">
                  <div
                    className="bg-green-400 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${currentMatch.aiConfidence}%` }}
                  />
                </div>
              </div>

              {/* Prediction */}
              <div className="bg-white/10 rounded-lg p-4 border border-white/20">
                <div className="text-white/70 text-sm mb-1">Previsão Principal</div>
                <div className="text-white font-bold text-2xl mb-2">{currentMatch.prediction}</div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-white/20 text-white border-white/30">
                    Odds: {currentMatch.odds.toFixed(2)}
                  </Badge>
                  <Badge className="bg-green-500/30 text-white border-green-400/50">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    Retorno: {currentMatch.potentialReturn}%
                  </Badge>
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-2">
                {currentMatch.tags.map((tag, idx) => (
                  <Badge key={idx} className="bg-white/20 text-white border-white/30 text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>

              {/* CTA */}
              <button
                onClick={() => onMatchClick(currentMatch.id)}
                className="w-full bg-white hover:bg-white/90 text-orange-600 font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Zap className="w-5 h-5" />
                Ver Análise Completa
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Arrows */}
        <button
          onClick={prevSlide}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/20 hover:bg-white/30 backdrop-blur rounded-full transition-colors"
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <button
          onClick={nextSlide}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/20 hover:bg-white/30 backdrop-blur rounded-full transition-colors"
        >
          <ChevronRight className="w-6 h-6 text-white" />
        </button>
      </div>
    </div>
  );
}
