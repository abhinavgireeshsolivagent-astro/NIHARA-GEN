export enum Personality {
  Nihara = 'Nihara',
  Niru = 'Niru',
  Luna = 'Luna',
}

export enum MessageSender {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

export interface ChatMessage {
  id: string;
  sender: MessageSender;
  text: string;
  image?: string; // base64 image
  isTyping?: boolean;
  sources?: { title: string; uri: string; }[];
}

export enum AppMode {
    Chat = 'Chat',
    ImageGen = 'Image Generation',
    DeepResearch = 'Deep Research',
    CodeWriter = 'Write Code',
    StudyBuddy = 'Study & Learn',
    AstroGuide = 'Astro Guide',
}

export interface VoiceOption {
    id: string;
    name: string;
    gender: 'female' | 'male';
}

export interface ChatHistory {
    id: string;
    messages: ChatMessage[];
    timestamp: number;
    summary: string;
    personality: Personality;
    mode: AppMode;
}