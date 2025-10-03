


import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LiveServerMessage, Modality, Blob } from '@google/genai';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import InputBar from './components/InputBar';
import { OnboardingModal, UpgradeModal, SettingsModal } from './components/Modals';
import { Personality, MessageSender, ChatMessage, AppMode, ChatHistory } from './types';
import { startChat, sendMessageStream, generateImage, editImage, getSystemInstruction, sendMessageWithSearch, getAiClient } from './services/geminiService';
import { SparklesIcon } from './constants';

// Audio Encoding/Decoding utilities
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


function createBlobFromAudio(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}

const LiveTranscriptionOverlay: React.FC<{ transcript: { user: string; assistant: string } }> = ({ transcript }) => (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-10 transcription-overlay">
        <div className="glassmorphic rounded-xl p-4 text-sm text-gray-300 shadow-2xl">
            {transcript.user && <p><span className="font-bold text-white">You:</span> {transcript.user}</p>}
            {transcript.assistant && <p className="mt-1"><span className="font-bold text-purple-300">Nihara:</span> {transcript.assistant}</p>}
        </div>
    </div>
);


const App: React.FC = () => {
    const [userName, setUserName] = useState<string>('');
    const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
    const [isUpgraded, setIsUpgraded] = useState<boolean>(false);
    const [currentPersonality, setCurrentPersonality] = useState<Personality>(Personality.Nihara);
    const [currentMode, setCurrentMode] = useState<AppMode>(AppMode.Chat);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);
    const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
    
    // History State
    const [history, setHistory] = useState<ChatHistory[]>([]);
    const currentChatIdRef = useRef<string | null>(null);

    // Live Mode State
    const [isLive, setIsLive] = useState<boolean>(false);
    const [liveSession, setLiveSession] = useState<any>(null);
    const [liveTranscript, setLiveTranscript] = useState({ user: '', assistant: '' });
    const liveTranscriptRef = useRef({ user: '', assistant: '' });
    const [voiceId, setVoiceId] = useState<string>('Zephyr');
    const [language, setLanguage] = useState<string>('English');
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const nextStartTimeRef = useRef<number>(0);

    useEffect(() => {
        const storedName = localStorage.getItem('nihara-username');
        if (storedName) {
            setUserName(storedName);
        } else {
            setShowOnboarding(true);
        }
        const storedHistory = localStorage.getItem('nihara-history');
        if (storedHistory) {
            setHistory(JSON.parse(storedHistory));
        }
    }, []);

    useEffect(() => {
        if(history.length > 0) {
             localStorage.setItem('nihara-history', JSON.stringify(history));
        }
    }, [history]);
    
    const handleNameSave = (name: string) => {
        setUserName(name);
        localStorage.setItem('nihara-username', name);
        setShowOnboarding(false);
    };
    
    const startNewChat = useCallback(() => {
        if (userName && currentMode !== AppMode.DeepResearch) {
             startChat(currentPersonality, currentMode, isUpgraded, userName);
        }
    }, [currentPersonality, currentMode, isUpgraded, userName]);

    const saveCurrentChat = useCallback(() => {
        if (messages.length > 1) { // Only save non-empty chats
            const summary = messages.find(m => m.sender === MessageSender.User)?.text.substring(0, 40) + '...' || 'New Chat';
            const newHistoryItem: ChatHistory = {
                id: currentChatIdRef.current || Date.now().toString(),
                messages,
                timestamp: Date.now(),
                summary,
                personality: currentPersonality,
                mode: currentMode,
            };
            setHistory(prev => {
                const existing = prev.find(h => h.id === newHistoryItem.id);
                if (existing) {
                    return prev.map(h => h.id === newHistoryItem.id ? newHistoryItem : h);
                }
                return [...prev, newHistoryItem];
            });
        }
    }, [messages, currentPersonality, currentMode]);
    
    useEffect(() => {
        saveCurrentChat();
        setMessages([]);
        currentChatIdRef.current = Date.now().toString();
        try {
            startNewChat();
        } catch (e) {
            // This error is now handled globally by the UI, but we can log it.
            console.error("Failed to start new chat session:", e);
        }
    }, [currentPersonality, currentMode, isUpgraded, userName]);


    const handleLoadChat = (id: string) => {
        const chatToLoad = history.find(h => h.id === id);
        if (chatToLoad) {
            saveCurrentChat(); // Save the current chat before loading another
            
            setMessages(chatToLoad.messages);
            setCurrentPersonality(chatToLoad.personality);
            setCurrentMode(chatToLoad.mode);
            currentChatIdRef.current = id;
            // The useEffect for personality/mode change will handle re-initializing the chat service
        }
    };


    const handleSendMessage = async (text: string, file?: File) => {
        setIsLoading(true);
        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            sender: MessageSender.User,
            text,
        };
        setMessages((prev) => [...prev, userMessage]);

        const assistantMessageId = (Date.now() + 1).toString();
        const assistantTypingMessage: ChatMessage = {
            id: assistantMessageId,
            sender: MessageSender.Assistant,
            text: '',
            isTyping: true,
        };
        setMessages((prev) => [...prev, assistantTypingMessage]);
        
        try {
            if (currentMode === AppMode.DeepResearch) {
                const systemInstruction = getSystemInstruction(currentPersonality, currentMode, isUpgraded, userName);
                const { text: responseText, sources } = await sendMessageWithSearch(text, systemInstruction);
                setMessages((prev) => prev.map(m => m.id === assistantMessageId ? { ...m, text: responseText, sources: sources, isTyping: false } : m));
            } else if (currentMode === AppMode.ImageGen && (file || text.toLowerCase().includes("generate") || text.toLowerCase().includes("create"))) {
                const base64Image = file ? (await fileToDataUrl(file)).split(',')[1] : undefined;
                const mimeType = file ? file.type : undefined;
                
                if (file && base64Image && mimeType) { // Editing
                    const response = await editImage(text, base64Image, mimeType);
                    let responseText = '';
                    let responseImage = '';

                    for (const part of response.candidates[0].content.parts) {
                        if (part.text) {
                            responseText += part.text;
                        } else if (part.inlineData) {
                            responseImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        }
                    }
                    setMessages((prev) => prev.map(m => m.id === assistantMessageId ? { ...m, text: responseText, image: responseImage, isTyping: false } : m));
                } else { // Generation
                    const imageUrl = await generateImage(text);
                    setMessages((prev) => prev.map(m => m.id === assistantMessageId ? { ...m, text: 'Here is the image you requested:', image: imageUrl, isTyping: false } : m));
                }
            } else {
                 await sendMessageStream(text, (chunk) => {
                    setMessages((prev) =>
                        prev.map((msg) =>
                            msg.id === assistantMessageId
                                ? { ...msg, text: msg.text + chunk, isTyping: false }
                                : msg
                        )
                    );
                });
            }
        } catch(e) {
             const errorMessage = e instanceof Error ? e.message : "Sorry, I encountered an error.";
             setMessages((prev) => prev.map(m => m.id === assistantMessageId ? { ...m, text: errorMessage, isTyping: false } : m));
             console.error(e);
        } finally {
             setIsLoading(false);
        }
    };
    
    const fileToDataUrl = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };
    
    const handleToggleLiveMode = async () => {
        if(isLive) {
            liveSession?.close();
            setLiveSession(null);
            setIsLive(false);
        } else {
            setIsLive(true);
            setLiveTranscript({ user: '', assistant: '' });
            liveTranscriptRef.current = { user: '', assistant: '' };
            try {
                if (!outputAudioContextRef.current) {
                    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                }
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                
                const sessionPromise = getAiClient().live.connect({
                    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                    callbacks: {
                        onopen: () => {
                            const source = inputAudioContext.createMediaStreamSource(stream);
                            const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                                const pcmBlob = createBlobFromAudio(inputData);
                                sessionPromise.then((session) => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            };
                            source.connect(scriptProcessor);
                            scriptProcessor.connect(inputAudioContext.destination);
                        },
                        onmessage: async (message: LiveServerMessage) => {
                            // Handle audio
                            const base64EncodedAudioString =
                                message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                            if (base64EncodedAudioString && outputAudioContextRef.current) {
                                const ctx = outputAudioContextRef.current;
                                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                                const audioBuffer = await decodeAudioData(decode(base64EncodedAudioString), ctx, 24000, 1);
                                const sourceNode = ctx.createBufferSource();
                                sourceNode.buffer = audioBuffer;
                                sourceNode.connect(ctx.destination);
                                sourceNode.addEventListener('ended', () => { audioSourcesRef.current.delete(sourceNode); });
                                sourceNode.start(nextStartTimeRef.current);
                                nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
                                audioSourcesRef.current.add(sourceNode);
                            }
                            if (message.serverContent?.interrupted) {
                                for (const source of audioSourcesRef.current.values()) { source.stop(); }
                                audioSourcesRef.current.clear();
                                nextStartTimeRef.current = 0;
                            }

                            // Handle transcription
                            if (message.serverContent?.inputTranscription) {
                                liveTranscriptRef.current.user += message.serverContent.inputTranscription.text;
                            }
                             if (message.serverContent?.outputTranscription) {
                                liveTranscriptRef.current.assistant += message.serverContent.outputTranscription.text;
                            }
                            setLiveTranscript({ ...liveTranscriptRef.current });
                            
                            if (message.serverContent?.turnComplete) {
                                const fullUserInput = liveTranscriptRef.current.user;
                                const fullAssistantOutput = liveTranscriptRef.current.assistant;
                                
                                if (fullUserInput.trim()) {
                                    setMessages(prev => [...prev, { id: Date.now().toString(), sender: MessageSender.User, text: fullUserInput.trim() }]);
                                }
                                if (fullAssistantOutput.trim()) {
                                    setMessages(prev => [...prev, { id: (Date.now()+1).toString(), sender: MessageSender.Assistant, text: fullAssistantOutput.trim() }]);
                                }
                                
                                liveTranscriptRef.current = { user: '', assistant: '' };
                                setLiveTranscript({ user: '', assistant: '' });
                            }
                        },
                        onerror: (e: ErrorEvent) => {
                            console.error('Live session error:', e);
                            setIsLive(false);
                        },
                        onclose: () => {
                           setIsLive(false);
                           console.log('Live session closed');
                        },
                    },
                    config: {
                        responseModalities: [Modality.AUDIO],
                        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } },
                        systemInstruction: getSystemInstruction(currentPersonality, currentMode, isUpgraded, userName),
                        inputAudioTranscription: {},
                        outputAudioTranscription: {},
                    },
                });
                setLiveSession(await sessionPromise);
            } catch (error) {
                console.error("Failed to start live mode:", error);
                setIsLive(false);
                alert("Could not access microphone. Please check permissions.");
            }
        }
    };

    return (
        <div id="root" className={`h-screen w-screen text-white font-sans overflow-hidden flex ${isUpgraded ? 'mega-pro' : ''}`}>
            <Sidebar
                currentPersonality={currentPersonality}
                onPersonalityChange={setCurrentPersonality}
                currentMode={currentMode}
                onModeChange={setCurrentMode}
                onSettingsClick={() => setShowSettingsModal(true)}
                isUpgraded={isUpgraded}
                history={history}
                onLoadChat={handleLoadChat}
            />
            <main className="flex-1 flex flex-col relative">
                 <div className="flex-shrink-0 h-20 flex items-center justify-center">
                    {!isUpgraded && (
                        <button
                            onClick={() => setShowUpgradeModal(true)}
                            className="text-gray-400 font-medium text-xs py-1.5 px-3 rounded-full hover:bg-white/10 hover:text-white transition-colors flex items-center gap-1.5"
                        >
                            <SparklesIcon className="text-yellow-400 w-4 h-4" />
                            <span>Upgrade to Mega Pro</span>
                        </button>
                    )}
                </div>
                <ChatView messages={messages} personality={currentPersonality} userName={userName} mode={currentMode} isUpgraded={isUpgraded} />
                {isLive && <LiveTranscriptionOverlay transcript={liveTranscript} />}
                <InputBar onSendMessage={handleSendMessage} isLoading={isLoading} isLive={isLive} onToggleLive={handleToggleLiveMode} />
            </main>
            <OnboardingModal show={showOnboarding} onSave={handleNameSave} />
            <UpgradeModal 
                show={showUpgradeModal} 
                onClose={() => setShowUpgradeModal(false)}
                onUpgrade={() => {
                    setIsUpgraded(true);
                }}
            />
            <SettingsModal
                show={showSettingsModal}
                onClose={() => setShowSettingsModal(false)}
                onSave={(v, l) => {setVoiceId(v); setLanguage(l);}}
                currentVoice={voiceId}
                currentLanguage={language}
            />
        </div>
    );
};

export default App;
