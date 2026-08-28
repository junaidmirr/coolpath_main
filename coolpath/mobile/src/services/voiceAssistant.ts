import axios from 'axios';
import { getActiveBaseUrl, resetActiveBaseUrl, COMMON_HEADERS } from './api';

export interface AssistantChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  display_text?: string;
  action?: string | null;
  action_data?: any;
  suggested_replies?: string[];
  timestamp?: number;
}

export interface AssistantChatContext {
  current_origin?: string;
  current_dest?: string;
  temp_c?: number;
  aqi?: number;
  pending_action?: any;
  selected_route_name?: string;
}

export const callAssistantBackend = async (
  messages: { role: string; content: string }[],
  context: AssistantChatContext
): Promise<{
  spoken_response: string;
  display_text: string;
  action: string | null;
  action_data: any;
  suggested_replies: string[];
}> => {
  let baseUrl = await getActiveBaseUrl();
  try {
    const response = await axios.post(
      `${baseUrl}/api/assistant/chat`,
      { messages, context },
      { timeout: 30000, headers: COMMON_HEADERS }
    );
    if (response.data && response.data.data) {
      return response.data.data;
    }
    throw new Error('Invalid response structure from assistant API');
  } catch (error: any) {
    if (error.response?.status === 503 || error.message?.includes('503')) {
      resetActiveBaseUrl();
      const newBaseUrl = await getActiveBaseUrl();
      if (newBaseUrl && newBaseUrl !== baseUrl) {
        try {
          const retryRes = await axios.post(
            `${newBaseUrl}/api/assistant/chat`,
            { messages, context },
            { timeout: 30000, headers: COMMON_HEADERS }
          );
          if (retryRes.data && retryRes.data.data) {
            return retryRes.data.data;
          }
        } catch (retryErr) {}
      }
    }
    const msg = error.response?.data?.detail?.message || error.message || 'Assistant request failed';
    console.warn('[VoiceAssistant call notice]', msg);
    return {
      spoken_response:
        "I'm ready to help you navigate through shaded, cooler urban corridors. Where would you like to go?",
      display_text:
        "I can help you navigate cities while avoiding extreme heat and high asphalt temperatures.\n\nWhere would you like to go?",
      action: null,
      action_data: null,
      suggested_replies: ["Go to Central Park", "Times Square to Brooklyn", "Check Weather"],
    };
  }
};

export const transcribeAudio = async (
  audioBase64: string,
  mimeType: string = 'audio/webm'
): Promise<string> => {
  const baseUrl = await getActiveBaseUrl();
  try {
    const response = await axios.post(
      `${baseUrl}/api/assistant/transcribe`,
      { audio_base64: audioBase64, mime_type: mimeType },
      { timeout: 20000, headers: COMMON_HEADERS }
    );
    if (response.data && response.data.transcript) {
      return response.data.transcript;
    }
    return '';
  } catch (error: any) {
    console.warn('[VoiceAssistant transcribe error]', error.message);
    return '';
  }
};

export const fetchPollyTTSAudio = async (
  text: string,
  voiceId: string = 'Salli',
  engine: string = 'standard'
): Promise<string | null> => {
  const baseUrl = await getActiveBaseUrl();
  try {
    const response = await axios.post(
      `${baseUrl}/api/assistant/tts`,
      { text, voice_id: voiceId, engine },
      { timeout: 15000, headers: COMMON_HEADERS }
    );
    if (response.data && response.data.status === 'ok' && response.data.audio_base64) {
      return response.data.audio_base64;
    }
    return null;
  } catch (error: any) {
    console.warn('[Amazon Polly TTS request error]', error.message);
    return null;
  }
};
