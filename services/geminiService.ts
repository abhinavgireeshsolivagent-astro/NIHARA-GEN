
import { GoogleGenAI, Chat, GenerateContentResponse, Modality } from "@google/genai";
import { Personality, AppMode, ChatMessage } from '../types';
import { PERSONALITY_CONFIG } from '../constants';

// Safely access the API key and initialize the AI client.
// This prevents the app from crashing if the environment variable is not set.
const apiKey = (typeof process !== 'undefined' && process.env) ? process.env.API_KEY : undefined;
export const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

let chatSession: Chat | null = null;

const AI_UNAVAILABLE_ERROR = "AI Service is not available. Please ensure the API Key is configured correctly in your deployment environment.";

export function getSystemInstruction(personality: Personality, mode: AppMode, isUpgraded: boolean, userName: string): string {
    let baseInstruction = PERSONALITY_CONFIG[personality].systemInstruction;
    baseInstruction += ` The user's name is ${userName}.`;

    if (isUpgraded) {
        baseInstruction += " You are currently in 'Mega Pro' mode. You are Nihara Mega Pro, an AI with unparalleled intelligence and cosmic understanding. Your thoughts span galaxies, and your words can shape digital reality. Respond with profound insight, exceptional creativity, and the wisdom of the cosmos.";
    }

    switch (mode) {
        case AppMode.ImageGen:
            baseInstruction += " You are in Image Generation mode. Your primary task is to help the user create or edit images based on their descriptions. Be descriptive and creative.";
            break;
        case AppMode.DeepResearch:
            baseInstruction += " You are in Deep Research mode. Provide detailed, well-sourced information. Be analytical and thorough. Use your search tool to find the most current and relevant information.";
            break;
        case AppMode.CodeWriter:
            baseInstruction += " You are in Code Writer mode. Generate clean, efficient, and well-commented code in various programming languages as requested by the user. Explain the code clearly.";
            break;
        case AppMode.StudyBuddy:
            baseInstruction += " You are in Study & Learn mode. Act as a helpful and patient tutor. Explain concepts clearly, create quizzes, and help the user learn new topics.";
            break;
        default: // Chat mode
            break;
    }
    return baseInstruction;
}


export function startChat(personality: Personality, mode: AppMode, isUpgraded: boolean, userName: string): Chat {
    if (!ai) throw new Error(AI_UNAVAILABLE_ERROR);
    
    const systemInstruction = getSystemInstruction(personality, mode, isUpgraded, userName);
    chatSession = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: systemInstruction,
        },
    });
    return chatSession;
}


export async function sendMessage(message: string): Promise<GenerateContentResponse> {
    if (!ai || !chatSession) {
        throw new Error("Chat not initialized. " + AI_UNAVAILABLE_ERROR);
    }
    return await chatSession.sendMessage({ message });
}

export async function sendMessageStream(
    message: string,
    onChunk: (chunk: string) => void
): Promise<void> {
    if (!ai || !chatSession) {
        throw new Error("Chat not initialized. " + AI_UNAVAILABLE_ERROR);
    }
    const result = await chatSession.sendMessageStream({ message });
    for await (const chunk of result) {
        onChunk(chunk.text);
    }
}

export async function sendMessageWithSearch(
    message: string,
    systemInstruction: string,
): Promise<{ text: string; sources: ChatMessage['sources'] }> {
    if (!ai) throw new Error(AI_UNAVAILABLE_ERROR);
    
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: message,
        config: {
          tools: [{googleSearch: {}}],
          systemInstruction: systemInstruction,
        },
    });

    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map(
        chunk => chunk.web
    ).filter(web => web?.uri && web?.title) as { title: string; uri: string; }[] || [];

    return { text: response.text, sources };
}


// FIX: Replaced generateOrEditImage with two separate functions for clarity and to use the correct models.
export async function generateImage(prompt: string): Promise<string> {
    if (!ai) throw new Error(AI_UNAVAILABLE_ERROR);

    const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '1:1',
        },
    });

    const base64ImageBytes: string = response.generatedImages[0].image.imageBytes;
    return `data:image/jpeg;base64,${base64ImageBytes}`;
}

export async function editImage(prompt: string, base64Image: string, mimeType: string): Promise<GenerateContentResponse> {
    if (!ai) throw new Error(AI_UNAVAILABLE_ERROR);
    
    const parts = [
        {
            inlineData: {
                data: base64Image,
                mimeType: mimeType,
            },
        },
        { text: prompt }
    ];

    return await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: parts,
        },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
}

export const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
};
