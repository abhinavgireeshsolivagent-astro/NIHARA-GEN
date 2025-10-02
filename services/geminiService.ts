import { GoogleGenAI, Chat, GenerateContentResponse, Modality } from "@google/genai";
import { Personality, AppMode } from '../types';
import { PERSONALITY_CONFIG } from '../constants';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
let chatSession: Chat | null = null;

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
            baseInstruction += " You are in Deep Research mode. Provide detailed, well-sourced information. Be analytical and thorough.";
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
    if (!chatSession) {
        throw new Error("Chat not initialized. Call startChat first.");
    }
    return await chatSession.sendMessage({ message });
}

export async function sendMessageStream(
    message: string,
    onChunk: (chunk: string) => void
): Promise<void> {
    if (!chatSession) {
        throw new Error("Chat not initialized. Call startChat first.");
    }
    const result = await chatSession.sendMessageStream({ message });
    for await (const chunk of result) {
        onChunk(chunk.text);
    }
}


// FIX: Replaced generateOrEditImage with two separate functions for clarity and to use the correct models.
export async function generateImage(prompt: string): Promise<string> {
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
        model: 'gemini-2.5-flash-image-preview',
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