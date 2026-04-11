import { useState } from 'react';

interface TeamLogoProps {
  teamName: string;
  logoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showName?: boolean;
  className?: string;
}

const sizeClasses = {
  xs: 'w-4 h-4',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
};

const textSizeClasses = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};

export function TeamLogo({
  teamName,
  logoUrl,
  size = 'md',
  showName = true,
  className = '',
}: TeamLogoProps) {
  const [imageError, setImageError] = useState(false);

  // Se não houver logo ou houver erro, mostrar iniciais
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {logoUrl && !imageError ? (
        <img
          src={logoUrl}
          alt={`${teamName} logo`}
          className={`${sizeClasses[size]} object-contain`}
          onError={() => setImageError(true)}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold ${
            size === 'xs' ? 'text-[8px]' : size === 'sm' ? 'text-[10px]' : 'text-xs'
          }`}
        >
          {getInitials(teamName)}
        </div>
      )}
      {showName && (
        <span className={`font-medium ${textSizeClasses[size]}`}>
          {teamName}
        </span>
      )}
    </div>
  );
}
