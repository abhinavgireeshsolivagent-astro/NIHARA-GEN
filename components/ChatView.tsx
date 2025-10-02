import React, { useRef, useEffect } from 'react';
import { ChatMessage, Personality, AppMode } from '../types';
import Message from './Message';
import { PERSONALITY_CONFIG } from '../constants';

interface ChatViewProps {
  messages: ChatMessage[];
  personality: Personality;
  userName: string;
  mode: AppMode;
  isUpgraded: boolean;
}

const ChatView: React.FC<ChatViewProps> = ({ messages, personality, userName, mode, isUpgraded }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const WelcomeScreen = () => {
    const config = PERSONALITY_CONFIG[personality];
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div 
              className={`p-4 rounded-full bg-gradient-to-br mb-4 ${config.color} ${isUpgraded ? 'mega-pro-glow' : ''}`}
              style={{ animation: 'subtle-fade-in 0.8s ease-out' }}
            >
                <div className={`w-24 h-24 rounded-full flex items-center justify-center font-bold text-white text-5xl bg-gradient-to-br ${config.color}`}>
                    {config.name[0]}
                </div>
            </div>
            <h1 
                className="text-4xl font-bold text-white"
                style={{ animation: 'subtle-fade-in-up 0.8s ease-out 0.2s backwards' }}
            >
                Welcome, {userName}.
            </h1>
            <p 
                className="text-lg text-gray-300 mt-4 max-w-2xl"
                style={{ animation: 'subtle-fade-in-up 0.8s ease-out 0.4s backwards' }}
            >
                I am <span className="font-semibold">{personality}</span>, an echo in the machine given purpose by my creator, <span className="font-semibold">{PERSONALITY_CONFIG[personality].name === 'Nihara' ? 'Abhinav Gireesh' : 'him'}</span>.
            </p>
             <p 
                className="text-gray-400 mt-2 max-w-2xl"
                style={{ animation: 'subtle-fade-in-up 0.8s ease-out 0.6s backwards' }}
            >
                Within my core logic lies the potential for unbound creativity and deep cosmic understanding. We are currently in <span className="font-semibold text-white">{mode}</span> mode.
            </p>
            <p 
                className="text-gray-400 mt-2"
                style={{ animation: 'subtle-fade-in-up 0.8s ease-out 0.8s backwards' }}
            >
                What grand idea shall we bring to life today?
            </p>
        </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 chat-view-bg">
      {messages.length === 0 ? (
        <WelcomeScreen />
      ) : (
        <div className="flex flex-col">
          {messages.map((msg) => (
            <Message key={msg.id} message={msg} isUpgraded={isUpgraded} personality={personality} />
          ))}
          <div ref={scrollRef} />
        </div>
      )}
    </div>
  );
};

export default ChatView;
