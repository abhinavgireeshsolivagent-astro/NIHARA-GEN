import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LiveServerMessage, Modality, Blob, FunctionDeclaration, Type } from '@google/genai';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import InputBar from './components/InputBar';
import DiaryView from './components/DiaryView';
import ImageGenView from './components/ImageGenView';
import LiveView from './components/LiveView';
import { OnboardingModal, UpgradeModal, SettingsModal } from './components/Modals';
import { Personality, MessageSender, ChatMessage, AppMode, ChatHistory, DiaryEntry, GeneratedImage } from './types';
import { startChat, sendMessageStream, generateImage, editImage, getSystemInstruction, sendMessageWithSearch, getAiClient, analyzeSentiment, extractMemory } from './services/geminiService';
import { SparklesIcon, MenuIcon } from './constants';

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

// Function Declarations for Live Mode Voice Commands
const changePersonalityDeclaration: FunctionDeclaration = {
    name: 'changePersonality',
    description: "Changes the AI's personality.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            personality: {
                type: Type.STRING,
                description: 'The personality to switch to.',
                enum: Object.values(Personality),
            },
        },
        required: ['personality'],
    },
};

const changeModeDeclaration: FunctionDeclaration = {
    name: 'changeMode',
    description: "Changes the AI's operational mode.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            mode: {
                type: Type.STRING,
                description: 'The mode to switch to.',
                enum: Object.values(AppMode).filter(m => m !== AppMode.AIDiary),
            },
        },
        required: ['mode'],
    },
};

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
    
    // Responsive State
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
    
    // History State
    const [history, setHistory] = useState<ChatHistory[]>([]);
    const currentChatIdRef = useRef<string | null>(null);

    // Live Mode State
    const [isLive, setIsLive] = useState<boolean>(false);
    const [liveStatus, setLiveStatus] = useState<'listening' | 'speaking' | 'thinking' | 'idle'>('idle');
    const [liveActionStatus, setLiveActionStatus] = useState<string | null>(null);
    const liveSessionPromiseRef = useRef<Promise<any> | null>(null);
    const [liveTranscript, setLiveTranscript] = useState({ user: '', assistant: '' });
    const liveTranscriptRef = useRef({ user: '', assistant: '' });
    const [voiceId, setVoiceId] = useState<string>('Zephyr');
    const [language, setLanguage] = useState<string>('English');
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const nextStartTimeRef = useRef<number>(0);
    const [micLevel, setMicLevel] = useState(0);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    // New Features State
    const [bondLevel, setBondLevel] = useState<number>(0);
    const [mood, setMood] = useState<string>('Neutral');
    const [memories, setMemories] = useState<string[]>([]);
    const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);
    const [diaryPin, setDiaryPin] = useState<string | null>(null);
    const [isDiaryLocked, setIsDiaryLocked] = useState<boolean>(true);
    const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);

    // Load from localStorage on mount
    useEffect(() => {
        const storedName = localStorage.getItem('nihara-username');
        if (storedName) setUserName(storedName); else setShowOnboarding(true);

        const storedHistory = localStorage.getItem('nihara-history');
        if (storedHistory) setHistory(JSON.parse(storedHistory));

        const storedBond = localStorage.getItem('nihara-bond');
        if (storedBond) setBondLevel(JSON.parse(storedBond));

        const storedMemories = localStorage.getItem('nihara-memories');
        if (storedMemories) setMemories(JSON.parse(storedMemories));

        const storedDiaryEntries = localStorage.getItem('nihara-diary-entries');
        if (storedDiaryEntries) setDiaryEntries(JSON.parse(storedDiaryEntries));

        const storedPin = localStorage.getItem('nihara-diary-pin');
        if (storedPin) setDiaryPin(storedPin);
    }, []);
    
    // Save to localStorage on change
    useEffect(() => { localStorage.setItem('nihara-history', JSON.stringify(history)); }, [history]);
    useEffect(() => { localStorage.setItem('nihara-bond', JSON.stringify(bondLevel)); }, [bondLevel]);
    useEffect(() => { localStorage.setItem('nihara-memories', JSON.stringify(memories)); }, [memories]);
    useEffect(() => { localStorage.setItem('nihara-diary-entries', JSON.stringify(diaryEntries)); }, [diaryEntries]);
    useEffect(() => { if(diaryPin) localStorage.setItem('nihara-diary-pin', diaryPin); }, [diaryPin]);

    // Derive mood from bondLevel
    useEffect(() => {
        if (bondLevel > 5) setMood('Joyful');
        else if (bondLevel > 0) setMood('Content');
        else if (bondLevel < -5) setMood('Concerned');
        else if (bondLevel < 0) setMood('Pensive');
        else setMood('Neutral');
    }, [bondLevel]);
    
    useEffect(() => { if (currentMode !== AppMode.ImageGen) { setGeneratedImages([]); } }, [currentMode]);

    const handleNameSave = (name: string) => {
        setUserName(name);
        localStorage.setItem('nihara-username', name);
        setShowOnboarding(false);
    };
    
    const startNewChat = useCallback(() => {
        if (userName) {
            const randomMemories = [...memories].sort(() => 0.5 - Math.random()).slice(0, 3);
            startChat(currentPersonality, currentMode, isUpgraded, userName, bondLevel, randomMemories, mood);
        }
    }, [currentPersonality, currentMode, isUpgraded, userName, bondLevel, memories, mood]);

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
            if (![AppMode.AIDiary, AppMode.ImageGen].includes(currentMode)) {
                startNewChat();
            }
        } catch (e) { console.error("Failed to start new chat session:", e); }
    }, [currentPersonality, currentMode, isUpgraded, userName, bondLevel, memories, mood]);


    const handleLoadChat = (id: string) => {
        const chatToLoad = history.find(h => h.id === id);
        if (chatToLoad) {
            saveCurrentChat(); 
            setMessages(chatToLoad.messages);
            setCurrentPersonality(chatToLoad.personality);
            setCurrentMode(chatToLoad.mode);
            currentChatIdRef.current = id;
        }
    };

    const processAiInteraction = async (userText: string, assistantText: string) => {
        const sentiment = await analyzeSentiment(userText);
        if (sentiment === 'positive') setBondLevel(b => b + 1);
        if (sentiment === 'negative') setBondLevel(b => Math.max(0, b - 1));

        const memory = await extractMemory(userText, assistantText);
        if (memory) {
            setMemories(m => [...m, memory].slice(-20)); // Keep last 20 memories
        }
    };

    const handleSendMessage = async (text: string, file?: File) => {
        setIsLoading(true);
        const userMessage: ChatMessage = { id: Date.now().toString(), sender: MessageSender.User, text };
        setMessages((prev) => [...prev, userMessage]);

        const assistantMessageId = (Date.now() + 1).toString();
        const assistantTypingMessage: ChatMessage = { id: assistantMessageId, sender: MessageSender.Assistant, text: '', isTyping: true };
        setMessages((prev) => [...prev, assistantTypingMessage]);
        
        try {
            let assistantResponseText = '';
            if (currentMode === AppMode.DeepResearch) {
                const randomMemories = [...memories].sort(() => 0.5 - Math.random()).slice(0, 3);
                const systemInstruction = getSystemInstruction(currentPersonality, currentMode, isUpgraded, userName, bondLevel, randomMemories, mood);
                const { text: responseText, sources } = await sendMessageWithSearch(text, systemInstruction);
                assistantResponseText = responseText;
                setMessages((prev) => prev.map(m => m.id === assistantMessageId ? { ...m, text: responseText, sources: sources, isTyping: false } : m));
            } else {
                 assistantResponseText = await sendMessageStream(text, (chunk) => {
                    setMessages((prev) =>
                        prev.map((msg) =>
                            msg.id === assistantMessageId
                                ? { ...msg, text: msg.text + chunk, isTyping: false }
                                : msg
                        )
                    );
                });
            }

            if (assistantResponseText) {
                processAiInteraction(text, assistantResponseText);
            }
        } catch(e) {
             const errorMessage = e instanceof Error ? e.message : "Sorry, I encountered an error.";
             setMessages((prev) => prev.map(m => m.id === assistantMessageId ? { ...m, text: errorMessage, isTyping: false } : m));
             console.error(e);
        } finally {
             setIsLoading(false);
        }
    };

    const handleGenerateImage = async (prompt: string, aspectRatio: string) => {
        setIsLoading(true);
        try {
            const imageUrl = await generateImage(prompt, aspectRatio);
            const newImage: GeneratedImage = { id: Date.now().toString(), src: imageUrl, prompt, aspectRatio, };
            setGeneratedImages(prev => [...prev, newImage]);
        } catch (e) { console.error("Image generation failed:", e); } 
        finally { setIsLoading(false); }
    };
    
    const handleToggleLiveMode = async () => {
        if (isLive) {
            if (liveSessionPromiseRef.current) {
                liveSessionPromiseRef.current.then(session => session.close());
                liveSessionPromiseRef.current = null;
            }
            setIsLive(false);
            setLiveStatus('idle');
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            return;
        }

        setIsLive(true);
        setLiveStatus('listening');

        if (!outputAudioContextRef.current) {
            // FIX: Use `(window as any).webkitAudioContext` for Safari compatibility.
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        
        const systemInstruction = getSystemInstruction(currentPersonality, AppMode.Chat, isUpgraded, userName, bondLevel, memories, mood);

        const sessionPromise = getAiClient().live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: async () => {
                    // FIX: Use `(window as any).webkitAudioContext` for Safari compatibility.
                    const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const source = inputAudioContext.createMediaStreamSource(stream);
                    const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                    
                    analyserRef.current = inputAudioContext.createAnalyser();
                    analyserRef.current.fftSize = 256;
                    const bufferLength = analyserRef.current.frequencyBinCount;
                    const dataArray = new Uint8Array(bufferLength);

                    const draw = () => {
                        animationFrameRef.current = requestAnimationFrame(draw);
                        if (!analyserRef.current) return;
                        analyserRef.current.getByteFrequencyData(dataArray);
                        const avg = dataArray.reduce((acc, val) => acc + val, 0) / bufferLength;
                        setMicLevel(avg / 128);
                    };
                    draw();

                    scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlobFromAudio(inputData);
                        liveSessionPromiseRef.current?.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                    };
                    source.connect(analyserRef.current);
                    analyserRef.current.connect(scriptProcessor);
                    scriptProcessor.connect(inputAudioContext.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    // Interruption
                    if (message.serverContent?.interrupted) {
                        setLiveStatus('listening');
                        audioSourcesRef.current.forEach(source => source.stop());
                        audioSourcesRef.current.clear();
                        nextStartTimeRef.current = 0;
                    }

                    // Function Calling
                    if (message.toolCall) {
                        const session = await liveSessionPromiseRef.current;
                        for (const fc of message.toolCall.functionCalls) {
                            let result = "ok", actionMessage = "";
                            if (fc.name === 'changePersonality') {
                                const newP = fc.args.personality as Personality;
                                if (Object.values(Personality).includes(newP)) {
                                    setCurrentPersonality(newP);
                                    actionMessage = `Personality set to ${newP}.`;
                                }
                            } else if (fc.name === 'changeMode') {
                                const newM = fc.args.mode as AppMode;
                                if (Object.values(AppMode).includes(newM)) {
                                    setCurrentMode(newM);
                                    actionMessage = `Mode changed to ${newM}.`;
                                }
                            }
                            if(actionMessage) {
                                setLiveActionStatus(actionMessage);
                                setTimeout(() => setLiveActionStatus(null), 3000);
                            }
                            session.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result } } });
                        }
                    }

                    // Transcription & Audio Output
                    const outputTranscription = message.serverContent?.outputTranscription?.text;
                    const inputTranscription = message.serverContent?.inputTranscription?.text;
                    if (outputTranscription) liveTranscriptRef.current.assistant += outputTranscription;
                    if (inputTranscription) liveTranscriptRef.current.user += inputTranscription;

                    if (message.serverContent?.turnComplete) {
                        setLiveTranscript(prev => ({...prev, user: liveTranscriptRef.current.user, assistant: liveTranscriptRef.current.assistant}));
                        liveTranscriptRef.current = { user: '', assistant: '' };
                        if (audioSourcesRef.current.size === 0) setLiveStatus('listening');
                    } else {
                         setLiveTranscript({ ...liveTranscriptRef.current });
                    }

                    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (audioData && outputAudioContextRef.current) {
                        setLiveStatus('speaking');
                        const ctx = outputAudioContextRef.current;
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                        const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
                        const source = ctx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(ctx.destination);
                        source.addEventListener('ended', () => {
                            audioSourcesRef.current.delete(source);
                            if (audioSourcesRef.current.size === 0) {
                                setLiveStatus('listening');
                            }
                        });
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        audioSourcesRef.current.add(source);
                    }
                },
                onerror: (e: ErrorEvent) => { console.error('Live session error:', e); setLiveStatus('idle'); },
                onclose: (e: CloseEvent) => { setLiveStatus('idle'); },
            },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } },
                systemInstruction,
                outputAudioTranscription: {},
                inputAudioTranscription: {},
                tools: [{ functionDeclarations: [changePersonalityDeclaration, changeModeDeclaration] }],
            },
        });
        liveSessionPromiseRef.current = sessionPromise;
    };


    // --- DIARY HANDLERS ---
    const handleAddDiaryEntry = (content: string) => { const newEntry: DiaryEntry = { id: Date.now().toString(), timestamp: Date.now(), content }; setDiaryEntries(prev => [...prev, newEntry]); };
    const handleSetDiaryPin = (pin: string) => { setDiaryPin(pin); setIsDiaryLocked(false); };
    const handleUnlockDiary = (pin: string): boolean => { if (pin === diaryPin) { setIsDiaryLocked(false); return true; } return false; };


    const renderMainView = () => {
        if (isLive) {
            return <LiveView transcript={liveTranscript} personality={currentPersonality} isUpgraded={isUpgraded} onToggleLive={handleToggleLiveMode} micLevel={micLevel} status={liveStatus} actionStatus={liveActionStatus} />;
        }
        switch(currentMode) {
            case AppMode.AIDiary:
                return <DiaryView entries={diaryEntries} onAddEntry={handleAddDiaryEntry} onSetPin={handleSetDiaryPin} onUnlock={handleUnlockDiary} isLocked={isDiaryLocked} setIsLocked={setIsDiaryLocked} pinIsSet={!!diaryPin} />;
            case AppMode.ImageGen:
                return <ImageGenView onGenerate={handleGenerateImage} isLoading={isLoading} images={generatedImages} />;
            default:
                return (
                    <>
                        <ChatView messages={messages} personality={currentPersonality} userName={userName} mode={currentMode} isUpgraded={isUpgraded} />
                        <InputBar onSendMessage={handleSendMessage} isLoading={isLoading} isLive={isLive} onToggleLive={handleToggleLiveMode} />
                    </>
                );
        }
    }

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
                isSidebarOpen={isSidebarOpen}
                setIsSidebarOpen={setIsSidebarOpen}
                bondLevel={bondLevel}
            />
            <main className="flex-1 flex flex-col relative">
                 <div className="flex-shrink-0 h-20 flex items-center justify-between px-6 md:justify-center">
                    <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 -ml-2 text-gray-300 hover:text-white">
                        <MenuIcon />
                    </button>
                    <div className="flex items-center">
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
                    <div className="w-6 md:hidden" /> {/* Spacer for mobile to center the upgrade button */}
                </div>
                {renderMainView()}
            </main>
            <OnboardingModal show={showOnboarding} onSave={handleNameSave} />
            <UpgradeModal 
                show={showUpgradeModal} 
                onClose={() => setShowUpgradeModal(false)}
                onUpgrade={() => { setIsUpgraded(true); }}
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
