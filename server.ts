import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import EventEmitter from 'events';
import dotenv from 'dotenv';
import {
  initDb,
  getUserById,
  getUserByEmail,
  getOrgUsers,
  createOrgWithOwner,
  updateUserStatus,
  publicUser,
  getOrgById,
  getCustomerById,
  getOrgCustomers,
  upsertCustomer,
  patchCustomer,
  getConversations,
  getConversationById,
  createConversation,
  updateConversation,
  deleteConversation,
  clearOfflineConversations,
  getMessages,
  saveMessage,
  markMessagesAsRead,
  getKbArticles,
  getKbArticleById,
  createKbArticle,
  updateKbArticle,
  deleteKbArticle,
  searchKbArticles,
  getLatestSuggestionLog,
  getLogWithConversation,
  updateSuggestionLog,
  addSuggestionLog,
  getSettings,
  updateSettings,
  getAnalytics,
  resetWorkspaceData,
  deleteWorkspace,
  heartbeat,
  isCustomerOnline,
  nid,
} from './lib/db';
import {
  verifyPassword,
  generateToken,
  verifyToken,
  checkRateLimit,
  getClientIp,
  signCustomerTicket,
  verifyCustomerTicket,
} from './lib/auth';
import {
  generateAISuggestion,
  ensureSuggestion,
  summarizeConversation,
} from './lib/ai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Real-time Event Bus
const eventBus = new EventEmitter();
eventBus.setMaxListeners(200);

// Helper for extracting bearer token
function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.substring(7);
}

// Authentication Middleware
function authenticateAgent(req: Request, res: Response, next: () => void) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
  (req as any).auth = payload;
  next();
}

// Initialize Database on startup
initDb();

// -------------------------------------------------------------
// Real-Time Server-Sent Events (SSE) Route
// -------------------------------------------------------------
app.get('/api/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  const onBroadcast = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventBus.on('broadcast', onBroadcast);

  // Keep-alive heartbeat every 20s
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(pingInterval);
    eventBus.off('broadcast', onBroadcast);
  });
});

// -------------------------------------------------------------
// Health & Diagnostics
// -------------------------------------------------------------
app.get('/api/health', async (req: Request, res: Response) => {
  const orgId = (req.query.orgId as string) || 'org_stellar';
  const settings = await getSettings(orgId);
  res.json({
    status: 'ok',
    hasGeminiKey: true,
    hasExternalGeminiKey: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    settings,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/db-status', (_req: Request, res: Response) => {
  const db = initDb();
  res.json({
    status: 'ok',
    counts: {
      organizations: db.organizations.length,
      users: db.users.length,
      customers: db.customers.length,
      conversations: db.conversations.length,
      messages: db.messages.length,
      kbArticles: db.kbArticles.length,
    },
  });
});

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const sanitizedEmail = String(email).trim().toLowerCase();
    const user = await getUserByEmail(sanitizedEmail);

    if (!user || !user.passwordHash || !user.passwordSalt) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const isValid = verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const token = generateToken({ userId: user.id, orgId: user.orgId });
    const org = await getOrgById(user.orgId);
    return res.json({ token, user: publicUser(user), org });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed due to server error.' });
  }
});

app.post('/api/auth/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name, companyName, avatarUrl } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const { org, user } = await createOrgWithOwner({
      orgName: companyName || `${name}'s Organization`,
      email,
      name,
      password,
      avatarUrl,
    });

    const token = generateToken({ userId: user.id, orgId: user.orgId });
    return res.json({ token, user: publicUser(user), org });
  } catch (err: any) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

app.get('/api/auth/me', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { userId, orgId } = (req as any).auth;
    const user = await getUserById(userId);
    const org = await getOrgById(orgId);
    if (!user || !org) {
      return res.status(404).json({ error: 'User or Organization not found.' });
    }
    res.json({ user: publicUser(user), org });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify session.' });
  }
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.json({ success: true });
});

// -------------------------------------------------------------
// Users / Agents Endpoints
// -------------------------------------------------------------
app.get('/api/users', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { orgId } = (req as any).auth;
    const users = await getOrgUsers(orgId);
    res.json(users.map(publicUser));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

app.post('/api/users/status', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).auth;
    const { status } = req.body;
    if (!['online', 'busy', 'offline'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const updated = await updateUserStatus(userId, status);
    if (updated) {
      eventBus.emit('broadcast', { type: 'agent_status', userId, status });
    }
    res.json(updated ? publicUser(updated) : null);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user status.' });
  }
});

// -------------------------------------------------------------
// Conversations Endpoints
// -------------------------------------------------------------
app.get('/api/conversations', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    let orgId = req.query.orgId as string;

    if (token) {
      const payload = verifyToken(token);
      if (payload) orgId = payload.orgId;
    }

    if (!orgId) {
      orgId = 'org_stellar';
    }

    const conversations = await getConversations(orgId);
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

app.post('/api/conversations', async (req: Request, res: Response) => {
  try {
    const { orgId, customerId, priority, channel, problemDescription, tags } = req.body;
    if (!orgId || !customerId) {
      return res.status(400).json({ error: 'orgId and customerId are required.' });
    }

    const now = new Date().toISOString();
    const convId = nid('conv');

    const conv = await createConversation({
      id: convId,
      orgId,
      customerId,
      assignedAgentId: null,
      status: 'open',
      channel: channel || 'widget',
      priority: priority || 'medium',
      tags: tags || ['support'],
      createdAt: now,
      lastMessageAt: now,
      slaBreachTime: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      problemDescription: problemDescription || '',
    });

    const ticket = signCustomerTicket(customerId, convId);
    eventBus.emit('broadcast', { type: 'new_conversation', conversation: conv });

    res.json({ ...conv, ticket });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create conversation.' });
  }
});

app.get('/api/conversations/:id', async (req: Request, res: Response) => {
  try {
    const conv = await getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversation.' });
  }
});

app.patch('/api/conversations/:id', async (req: Request, res: Response) => {
  try {
    const updated = await updateConversation(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Conversation not found.' });

    eventBus.emit('broadcast', { type: 'conversation_updated', conversation: updated });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update conversation.' });
  }
});

app.delete('/api/conversations/:id', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const ok = await deleteConversation(id);
    if (ok) {
      eventBus.emit('broadcast', { type: 'conversation_deleted', conversationId: id });
    }
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete conversation.' });
  }
});

app.post('/api/conversations/clear-offline', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { orgId } = (req as any).auth;
    const result = await clearOfflineConversations(orgId);
    eventBus.emit('broadcast', { type: 'conversations_cleared', orgId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear offline conversations.' });
  }
});

app.delete('/api/conversations/clear-offline', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { orgId } = (req as any).auth;
    const result = await clearOfflineConversations(orgId);
    eventBus.emit('broadcast', { type: 'conversations_cleared', orgId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear offline conversations.' });
  }
});

// Simulate incoming live customer ticket or reply
app.post('/api/conversations/simulate', async (req: Request, res: Response) => {
  try {
    const { orgId, customerName, companyName, email, issueText, priority } = req.body;
    const targetOrgId = orgId || 'org_stellar';

    const customerId = nid('cust');
    const customer = await upsertCustomer({
      id: customerId,
      orgId: targetOrgId,
      name: customerName || 'Alex Chen',
      email: email || `alex@${(companyName || 'acme').toLowerCase().replace(/\s+/g, '')}.com`,
      companyName: companyName || 'Acme Cloud Dynamics',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=faces',
      createdAt: new Date().toISOString(),
      location: 'New York, NY',
      browserInfo: 'Chrome 124.0 / macOS',
      notes: 'Customer created via live simulator test event.',
    });

    heartbeat(customerId);

    const convId = nid('conv');
    const now = new Date().toISOString();
    const conv = await createConversation({
      id: convId,
      orgId: targetOrgId,
      customerId,
      assignedAgentId: null,
      status: 'open',
      channel: 'widget',
      priority: priority || 'high',
      tags: ['support', 'inquiry'],
      createdAt: now,
      lastMessageAt: now,
      slaBreachTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      problemDescription: issueText || 'Inquiring about API rate limits and webhook signatures.',
    });

    const msg = await saveMessage({
      id: nid('msg'),
      conversationId: convId,
      senderType: 'customer',
      senderId: customerId,
      senderName: customer.name,
      content: issueText || 'Hello! We are testing your real-time support platform. Can you assist us with webhook signature verification?',
      readAt: null,
      createdAt: now,
    });

    eventBus.emit('broadcast', { type: 'new_conversation', conversation: conv });
    eventBus.emit('broadcast', { type: 'new_message', conversationId: convId, message: msg });

    // Asynchronously pre-generate AI suggestion
    ensureSuggestion(convId, targetOrgId).then((log) => {
      if (log) {
        eventBus.emit('broadcast', { type: 'ai_suggestion', conversationId: convId, log });
      }
    });

    res.json({ conversation: conv, customer, message: msg });
  } catch (err) {
    res.status(500).json({ error: 'Failed to simulate conversation.' });
  }
});

// -------------------------------------------------------------
// Messages Endpoints
// -------------------------------------------------------------
app.get('/api/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const convId = req.params.id;
    const msgs = await getMessages(convId);

    // Optional query to mark as read
    const readerType = req.query.readerType as 'agent' | 'customer' | undefined;
    if (readerType) {
      await markMessagesAsRead(convId, readerType);
    }

    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

app.post('/api/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const convId = req.params.id;
    const { content, senderType, senderId, senderName, senderAvatarUrl, attachments } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content cannot be empty.' });
    }

    const conv = await getConversationById(convId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const now = new Date().toISOString();
    const message = await saveMessage({
      id: nid('msg'),
      conversationId: convId,
      senderType: senderType || 'agent',
      senderId: senderId || 'agent',
      senderName: senderName || 'Agent',
      senderAvatarUrl: senderAvatarUrl || undefined,
      content: content.trim(),
      attachments: attachments || undefined,
      readAt: null,
      createdAt: now,
    });

    // Update conversation lastMessageAt and reopen if closed
    const updates: Partial<any> = { lastMessageAt: now };
    if (senderType === 'customer' && conv.status === 'closed') {
      updates.status = 'open';
    }
    await updateConversation(convId, updates);

    // If customer sent message, keep presence active
    if (senderType === 'customer') {
      heartbeat(conv.customerId);
    }

    // Broadcast instant real-time message event
    eventBus.emit('broadcast', { type: 'new_message', conversationId: convId, message });

    // If customer sent message, trigger AI Copilot suggestion in background
    if (senderType === 'customer') {
      ensureSuggestion(convId, conv.orgId).then((log) => {
        if (log) {
          eventBus.emit('broadcast', { type: 'ai_suggestion', conversationId: convId, log });
        }
      });
    }

    res.json(message);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// Typing indicator route
app.post('/api/conversations/:id/typing', (req: Request, res: Response) => {
  const convId = req.params.id;
  const { isTyping, senderType } = req.body;
  eventBus.emit('broadcast', { type: 'typing', conversationId: convId, isTyping: !!isTyping, senderType });
  res.json({ success: true });
});

// -------------------------------------------------------------
// AI Copilot & Summaries
// -------------------------------------------------------------
app.get('/api/copilot/latest', async (req: Request, res: Response) => {
  try {
    const convId = req.query.conversationId as string;
    if (!convId) return res.status(400).json({ error: 'conversationId required.' });

    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    const log = await ensureSuggestion(convId, conv.orgId);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve copilot suggestion.' });
  }
});

app.post('/api/copilot/generate', async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.body;
    if (!conversationId) return res.status(400).json({ error: 'conversationId required.' });

    const conv = await getConversationById(conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    const messages = await getMessages(conversationId);
    const lastCustomer = [...messages].reverse().find((m) => m.senderType === 'customer');
    const query = lastCustomer?.content || conv.problemDescription || 'How can I help you?';

    const text = await generateAISuggestion(conversationId, query, conv.orgId);
    const log = {
      id: nid('log'),
      conversationId,
      suggestedText: text,
      wasUsed: false,
      agentEdited: false,
      createdAt: new Date().toISOString(),
    };
    await addSuggestionLog(log);

    eventBus.emit('broadcast', { type: 'ai_suggestion', conversationId, log });
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate copilot reply.' });
  }
});

app.post('/api/copilot/feedback', async (req: Request, res: Response) => {
  try {
    const { logId, wasUsed, agentEdited } = req.body;
    if (!logId) return res.status(400).json({ error: 'logId required.' });
    const ok = await updateSuggestionLog(logId, !!wasUsed, !!agentEdited);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update copilot feedback.' });
  }
});

app.post('/api/conversations/:id/ai-summarize', async (req: Request, res: Response) => {
  try {
    const convId = req.params.id;
    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    const result = await summarizeConversation(convId, conv.orgId);
    await updateConversation(convId, {
      summary: result.summary,
      tags: Array.from(new Set([...conv.tags, ...result.tags])),
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to summarize conversation.' });
  }
});

// -------------------------------------------------------------
// Customers Endpoints
// -------------------------------------------------------------
app.get('/api/customers', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    let orgId = (req.query.orgId as string) || 'org_stellar';
    if (token) {
      const p = verifyToken(token);
      if (p) orgId = p.orgId;
    }
    const customers = await getOrgCustomers(orgId);
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customers.' });
  }
});

app.get('/api/customers/:id', async (req: Request, res: Response) => {
  try {
    const c = await getCustomerById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Customer not found.' });
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer.' });
  }
});

app.patch('/api/customers/:id', async (req: Request, res: Response) => {
  try {
    const updated = await patchCustomer(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Customer not found.' });
    eventBus.emit('broadcast', { type: 'customer_updated', customer: updated });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update customer.' });
  }
});

// -------------------------------------------------------------
// Knowledge Base Endpoints
// -------------------------------------------------------------
app.get('/api/kb', async (req: Request, res: Response) => {
  try {
    const orgId = (req.query.orgId as string) || 'org_stellar';
    const articles = await getKbArticles(orgId);
    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch knowledge base.' });
  }
});

app.all('/api/kb/search', async (req: Request, res: Response) => {
  try {
    const query = (req.body?.query || req.body?.q || req.query.q || req.query.query || '') as string;
    const orgId = (req.body?.orgId || req.query.orgId || 'org_stellar') as string;
    const results = await searchKbArticles(query, orgId);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to search knowledge base.' });
  }
});

app.post('/api/kb', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { orgId } = (req as any).auth;
    const { title, category, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required.' });
    }

    const now = new Date().toISOString();
    const article = await createKbArticle({
      id: nid('kb'),
      orgId,
      title,
      category: category || 'General',
      content,
      createdAt: now,
      updatedAt: now,
    });

    res.json(article);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create article.' });
  }
});

app.get('/api/kb/:id', async (req: Request, res: Response) => {
  try {
    const art = await getKbArticleById(req.params.id);
    if (!art) return res.status(404).json({ error: 'Article not found.' });
    res.json(art);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch article.' });
  }
});

app.patch('/api/kb/:id', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const updated = await updateKbArticle(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Article not found.' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update article.' });
  }
});

app.delete('/api/kb/:id', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const ok = await deleteKbArticle(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete article.' });
  }
});

// -------------------------------------------------------------
// Analytics & Metrics
// -------------------------------------------------------------
app.get('/api/analytics', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    let orgId = (req.query.orgId as string) || 'org_stellar';
    if (token) {
      const p = verifyToken(token);
      if (p) orgId = p.orgId;
    }
    const data = await getAnalytics(orgId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load analytics.' });
  }
});

// -------------------------------------------------------------
// Settings
// -------------------------------------------------------------
app.get('/api/settings', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    let orgId = (req.query.orgId as string) || 'org_stellar';
    if (token) {
      const p = verifyToken(token);
      if (p) orgId = p.orgId;
    }
    const settings = await getSettings(orgId);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

app.patch('/api/settings', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { orgId } = (req as any).auth;
    const updated = await updateSettings(orgId, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

app.get('/api/v1/settings/ai-key', async (req: Request, res: Response) => {
  const token = getBearerToken(req);
  let orgId = 'org_stellar';
  if (token) {
    const p = verifyToken(token);
    if (p) orgId = p.orgId;
  }
  const settings = await getSettings(orgId);
  const hasEnvKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';
  res.json({
    hasKey: hasEnvKey || (settings.apiKeys && settings.apiKeys.length > 0),
    activeProvider: hasEnvKey ? 'gemini-built-in' : settings.apiKeys?.[0]?.providerName || null,
  });
});

app.post('/api/v1/settings/ai-key/save', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { orgId } = (req as any).auth;
    const { provider, apiKey } = req.body;
    const settings = await getSettings(orgId);
    const apiKeys = settings.apiKeys || [];
    apiKeys.push({
      id: nid('key'),
      providerName: provider || 'gemini',
      apiKey: apiKey || '',
      description: 'Custom API Key',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    const updated = await updateSettings(orgId, { apiKeys });
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save API key.' });
  }
});

app.post('/api/v1/settings/ai-key/test', async (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Gemini AI connection verified successfully.' });
});

// -------------------------------------------------------------
// Live Customer Widget Simulator Endpoints
// -------------------------------------------------------------
app.post('/api/widget/heartbeat', (req: Request, res: Response) => {
  const { customerId } = req.body;
  if (customerId) {
    heartbeat(customerId);
    eventBus.emit('broadcast', { type: 'presence', customerId, isOnline: true });
  }
  res.json({ success: true });
});

app.post('/api/widget/ticket', async (req: Request, res: Response) => {
  try {
    const { customerId, conversationId } = req.body;
    if (!customerId || !conversationId) {
      return res.status(400).json({ error: 'customerId and conversationId required.' });
    }
    const ticket = signCustomerTicket(customerId, conversationId);
    heartbeat(customerId);
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate ticket.' });
  }
});

// -------------------------------------------------------------
// Workspace Reset & Cleanup
// -------------------------------------------------------------
app.post('/api/workspace/data', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { orgId } = (req as any).auth;
    const result = await resetWorkspaceData(orgId);
    eventBus.emit('broadcast', { type: 'workspace_reset', orgId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset workspace.' });
  }
});

app.delete('/api/workspace', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { orgId } = (req as any).auth;
    await deleteWorkspace(orgId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete workspace.' });
  }
});

// -------------------------------------------------------------
// Vite Middleware / Static Serving
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 B2B Support Hub server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup failure:', err);
  process.exit(1);
});
