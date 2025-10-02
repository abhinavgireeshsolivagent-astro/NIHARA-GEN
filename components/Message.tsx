import React from 'react';
import { ChatMessage, MessageSender, Personality } from '../types';
import { PERSONALITY_CONFIG } from '../constants';

interface MessageProps {
  message: ChatMessage;
  isUpgraded: boolean;
  personality: Personality;
}

const TypingIndicator = () => (
    <div className="flex items-center space-x-1 p-2">
        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
    </div>
);

const UserAvatar = () => (
  <div className="w-10 h-10 rounded-full shadow-md flex-shrink-0 bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center font-bold text-white">
    U
  </div>
);

const AssistantAvatar: React.FC<{ personality: Personality }> = ({ personality }) => {
    const config = PERSONALITY_CONFIG[personality];
    return (
        <div className={`w-10 h-10 rounded-full shadow-md flex-shrink-0 bg-gradient-to-br ${config.color} flex items-center justify-center font-bold text-white text-xl`}>
            {config.name[0]}
        </div>
    );
};

const Message: React.FC<MessageProps> = ({ message, isUpgraded, personality }) => {
  const isUser = message.sender === MessageSender.User;

  const containerClasses = isUser ? 'flex-row-reverse' : 'flex-row';
  const animationClass = isUser ? 'animate-message-in-right' : 'animate-message-in-left';
  const bubbleClasses = isUser
    ? 'bg-gradient-to-br from-purple-600 to-indigo-700 text-white rounded-br-none'
    : 'bg-gray-700/80 text-gray-200 rounded-bl-none';
  
  const megaProBubbleWrapper = !isUser && isUpgraded ? 'mega-pro-glow p-0.5 rounded-2xl' : '';

  return (
    <div className={`flex items-start gap-3 my-4 ${containerClasses} ${animationClass}`}>
      {isUser ? <UserAvatar /> : <AssistantAvatar personality={personality} />}
      <div className={`max-w-xl shadow-lg rounded-2xl ${megaProBubbleWrapper}`}>
        <div className={`p-4 rounded-[14px] ${bubbleClasses}`}>
          {message.isTyping ? <TypingIndicator /> : <p className="whitespace-pre-wrap">{message.text}</p>}
          {message.image && (
              <div className="mt-3">
                  <img src={message.image} alt="Generated content" className="rounded-lg max-w-sm" />
              </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Message;
