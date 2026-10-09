/**
 * Server-side AI engine powered by @google/genai.
 * Provides Knowledge Base RAG suggestion generation, conversation summarization,
 * customer sentiment analysis, and intelligent reply drafting.
 */
import { GoogleGenAI } from '@google/genai';
import {
  getKbArticles,
  getMessages,
  getLatestSuggestionLog,
  addSuggestionLog,
  getSettings,
  searchKbArticles,
  getConversationById,
  getCustomerById,
  nid,
} from './db';
import type { AISuggestionLog, KBArticle } from '../src/types';

let genAIClient: GoogleGenAI | null = null;

function getGeminiClient(customApiKey?: string): GoogleGenAI | null {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!genAIClient || customApiKey) {
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    if (!customApiKey) genAIClient = client;
    return client;
  }
  return genAIClient;
}

/**
 * Searches for knowledge base articles matching customer query
 */
export async function getRelevantKBArticles(query: string, orgId: string): Promise<KBArticle[]> {
  try {
    const matching = await searchKbArticles(query, orgId);
    if (matching.length > 0) return matching.slice(0, 3);
  } catch (err) {
    console.warn('KB search fallback:', err);
  }
  const all = await getKbArticles(orgId);
  return all.slice(0, 2);
}

/**
 * Generates an AI Copilot response draft grounded in Knowledge Base articles.
 */
export async function generateAISuggestion(
  conversationId: string,
  customerQuery: string,
  orgId: string
): Promise<string> {
  const settings = await getSettings(orgId);
  const customKey = settings.apiKeys?.find((k) => k.status === 'active')?.apiKey;
  const ai = getGeminiClient(customKey);

  // Retrieve relevant KB articles for RAG
  let articles: KBArticle[] = [];
  try {
    articles = await getRelevantKBArticles(customerQuery, orgId);
  } catch (e) {
    console.error('Error fetching articles for copilot suggestion:', e);
  }

  // Retrieve conversation history
  const history = (await getMessages(conversationId)).slice(-6);
  const historyStr = history
    .map((m) => `${m.senderName} (${m.senderType}): ${m.content}`)
    .join('\n');

  const kbContext = articles
    .map((a, i) => `[Source ${i + 1}: ${a.title} (${a.category})]\n${a.content}`)
    .join('\n\n');

  if (!ai) {
    // Elegant and intelligent fallback when GEMINI_API_KEY is not configured
    if (articles.length > 0) {
      const top = articles[0];
      return `Hi there,\n\nThank you for reaching out! Regarding your inquiry about "${customerQuery.slice(0, 40)}...", according to our documentation on **${top.title}**:\n\n${top.content.split('\n\n')[0] || top.content}\n\nCould you please let us know if this resolves your query or if you need additional assistance?`;
    }
    return `Hi,\n\nThank you for getting in touch. I am reviewing the details of your request regarding "${customerQuery.slice(0, 50)}" right now. Could you confirm your workspace environment so we can help expedite this?`;
  }

  const prompt = `You are an elite B2B Technical Support Copilot.
Your job is to draft a polite, concise, and technically accurate reply for the human support agent to review and send to the customer.

KNOWLEDGE BASE ARTICLES (GROUND TRUTH):
${kbContext || 'No specific article found. Rely on SaaS best practices and politely request environment details.'}

RECENT CONVERSATION HISTORY:
${historyStr}

LATEST CUSTOMER MESSAGE:
"${customerQuery}"

INSTRUCTIONS:
1. Ground your technical details in the Knowledge Base provided.
2. Structure the reply with clear formatting (bullet points, markdown code blocks if discussing APIs/code/headers).
3. Do not include meta intros like "Here is a draft:" or "Dear Agent:". Provide ONLY the direct message ready to be sent to the customer.
4. Keep the tone empathetic, professional, and solutions-oriented.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
      },
    });

    const text = response.text?.trim();
    if (text) return text;
  } catch (err: any) {
    console.error('Gemini API copilot generation error:', err);
  }

  // Fallback to grounded KB snippet if model call encounters rate-limit
  if (articles.length > 0) {
    return `Hello,\n\nThanks for reaching out! Based on our documentation for **${articles[0].title}**:\n\n${articles[0].content.split('\n\n')[0]}\n\nPlease let us know if you need more details.`;
  }
  return `Hi,\n\nThank you for contacting support. We are checking this issue right away and will get back to you with the solution shortly.`;
}

/**
 * Ensures a fresh copilot suggestion is cached if the customer sent a new message.
 */
export async function ensureSuggestion(
  conversationId: string,
  orgId: string
): Promise<AISuggestionLog | null> {
  const messages = await getMessages(conversationId);
  if (messages.length === 0) return null;

  const lastCustomer = [...messages].reverse().find((m) => m.senderType === 'customer');
  if (!lastCustomer) return null;

  const latest = await getLatestSuggestionLog(conversationId);
  if (latest && new Date(latest.createdAt).getTime() >= new Date(lastCustomer.createdAt).getTime()) {
    return latest;
  }

  const lastMsg = messages[messages.length - 1];
  if (lastMsg.senderType !== 'customer') return latest;

  const suggestion = await generateAISuggestion(conversationId, lastCustomer.content, orgId);
  const log: AISuggestionLog = {
    id: nid('log'),
    conversationId,
    suggestedText: suggestion,
    wasUsed: false,
    agentEdited: false,
    createdAt: new Date().toISOString(),
  };

  await addSuggestionLog(log);
  return log;
}

/**
 * Summarizes the entire ticket thread, extracts sentiment, and suggests tags.
 */
export async function summarizeConversation(
  conversationId: string,
  orgId: string
): Promise<{ summary: string; sentiment: string; tags: string[] }> {
  const messages = await getMessages(conversationId);
  const conv = await getConversationById(conversationId);
  const customer = conv ? await getCustomerById(conv.customerId) : null;

  if (messages.length === 0) {
    return { summary: 'New ticket with no messages yet.', sentiment: 'Neutral', tags: ['general'] };
  }

  const ai = getGeminiClient();
  const transcript = messages
    .map((m) => `${m.senderName} (${m.senderType}): ${m.content}`)
    .join('\n');

  if (!ai) {
    const firstMsg = messages[0]?.content || '';
    return {
      summary: `Ticket regarding: ${firstMsg.slice(0, 100)}... Customer company: ${customer?.companyName || 'Enterprise'}`,
      sentiment: 'Neutral',
      tags: ['support', 'b2b'],
    };
  }

  const prompt = `Analyze this B2B customer support conversation:

CUSTOMER: ${customer?.name || 'Customer'} (${customer?.companyName || 'Client'})
TRANSCRIPT:
${transcript}

Return a JSON object with:
1. "summary": A concise 2-sentence executive summary of the issue, status, and resolution/next steps.
2. "sentiment": One of ["Positive", "Neutral", "Frustrated", "Urgent"].
3. "tags": An array of 2 to 4 relevant technical topic tags (e.g., ["api", "rate-limit", "billing"]).`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return {
      summary: parsed.summary || 'Summary unavailable',
      sentiment: parsed.sentiment || 'Neutral',
      tags: Array.isArray(parsed.tags) ? parsed.tags : ['support'],
    };
  } catch (err) {
    console.error('Error generating summary:', err);
    return {
      summary: `Customer discussion involving ${messages.length} messages.`,
      sentiment: 'Neutral',
      tags: ['support'],
    };
  }
}
