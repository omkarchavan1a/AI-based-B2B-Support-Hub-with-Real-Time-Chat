/**
 * Ultra-fast in-memory + JSON persisted store for B2B Support Hub.
 * Zero external DB latency, sub-millisecond execution, thread-safe debounce sync.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  Organization,
  User,
  Customer,
  Conversation,
  Message,
  KBArticle,
  AISuggestionLog,
  SupportSettings,
} from '../src/types';
import { hashPassword } from './auth';

export interface DatabaseSchema {
  organizations: Organization[];
  users: User[];
  customers: Customer[];
  conversations: Conversation[];
  messages: Message[];
  kbArticles: KBArticle[];
  aiSuggestionsLogs: AISuggestionLog[];
  settings: SupportSettings[];
}

const DB_FILE = path.join(process.cwd(), 'data', 'db.json');
let inMemoryDb: DatabaseSchema | null = null;
let saveTimer: NodeJS.Timeout | null = null;

// Customer presence tracker (in-memory)
const customerPresence = new Map<string, number>();

export function nid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function heartbeat(customerId: string): void {
  customerPresence.set(customerId, Date.now());
}

export function isCustomerOnline(customerId: string): boolean {
  const last = customerPresence.get(customerId);
  if (!last) return false;
  return Date.now() - last < 45000; // 45s heartbeat window
}

export function dropPresence(customerIds: string[]): void {
  for (const id of customerIds) {
    customerPresence.delete(id);
  }
}

// Initial default seed dataset if file doesn't exist
function getInitialSeedData(): DatabaseSchema {
  const now = new Date().toISOString();
  const { hash, salt } = hashPassword('P@ssword123!');

  return {
    organizations: [
      { id: 'org_stellar', name: 'Stellar B2B Cloud', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'org_horizon', name: 'Horizon Commerce', createdAt: '2026-01-15T00:00:00.000Z' },
    ],
    users: [
      {
        id: 'usr_sarah',
        orgId: 'org_stellar',
        role: 'owner',
        email: 'stellar-admin@b2bhub.ai',
        name: 'Sarah Connor',
        avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&h=150&fit=crop&crop=faces',
        status: 'online',
        passwordHash: hash,
        passwordSalt: salt,
      },
      {
        id: 'usr_john',
        orgId: 'org_stellar',
        role: 'agent',
        email: 'stellar-john@b2bhub.ai',
        name: 'John Doe',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=faces',
        status: 'online',
        passwordHash: hash,
        passwordSalt: salt,
      },
      {
        id: 'usr_omkar',
        orgId: 'org_stellar',
        role: 'agent',
        email: 'omkar@b2bhub.ai',
        name: 'Omkar Chavan',
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=faces',
        status: 'online',
        passwordHash: hash,
        passwordSalt: salt,
      },
    ],
    customers: [
      {
        id: 'cust_alice',
        orgId: 'org_stellar',
        email: 'alice@tesla.com',
        name: 'Alice Smith',
        companyName: 'Tesla Energy',
        avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=faces',
        createdAt: '2026-02-01T08:00:00.000Z',
        phone: '+1 (555) 234-5678',
        location: 'Austin, TX',
        browserInfo: 'Chrome 122.0 / macOS Sonoma',
        notes: 'Enterprise Tier customer. Fast-track SLA required for battery telemetry endpoints.',
      },
      {
        id: 'cust_bob',
        orgId: 'org_stellar',
        email: 'bob@stripe.com',
        name: 'Bob Miller',
        companyName: 'Stripe Billing',
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=faces',
        createdAt: '2026-02-05T09:30:00.000Z',
        phone: '+1 (555) 876-5432',
        location: 'San Francisco, CA',
        browserInfo: 'Safari 17.4 / macOS Ventura',
        notes: 'Integration partner. Testing webhook retry policies and signature headers.',
      },
      {
        id: 'cust_charlie',
        orgId: 'org_stellar',
        email: 'charlie@netflix.com',
        name: 'Charlie Brown',
        companyName: 'Netflix Stream Ops',
        avatarUrl: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&h=150&fit=crop&crop=faces',
        createdAt: '2026-02-10T11:15:00.000Z',
        phone: '+1 (555) 432-1098',
        location: 'Los Gatos, CA',
        browserInfo: 'Edge 121.0 / Windows 11',
        notes: 'VIP client. Inquiring about custom domain SSL propagation and Edge CDN caching.',
      },
    ],
    conversations: [
      {
        id: 'conv_1',
        orgId: 'org_stellar',
        customerId: 'cust_alice',
        assignedAgentId: 'usr_sarah',
        status: 'open',
        channel: 'widget',
        priority: 'urgent',
        tags: ['telemetry', 'rate-limit', 'enterprise'],
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        lastMessageAt: new Date(Date.now() - 600000).toISOString(),
        slaBreachTime: new Date(Date.now() + 1800000).toISOString(),
        problemDescription: 'API 429 rate limit errors when pushing high frequency telemetry batch streams.',
      },
      {
        id: 'conv_2',
        orgId: 'org_stellar',
        customerId: 'cust_bob',
        assignedAgentId: 'usr_john',
        status: 'open',
        channel: 'widget',
        priority: 'high',
        tags: ['webhooks', 'security', 'integration'],
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        lastMessageAt: new Date(Date.now() - 1200000).toISOString(),
        slaBreachTime: new Date(Date.now() + 5400000).toISOString(),
        problemDescription: 'Need clarification on X-Stellar-Signature HMAC SHA256 header verification algorithm.',
      },
      {
        id: 'conv_3',
        orgId: 'org_stellar',
        customerId: 'cust_charlie',
        assignedAgentId: 'usr_omkar',
        status: 'closed',
        channel: 'widget',
        priority: 'medium',
        tags: ['dns', 'ssl', 'cname'],
        createdAt: '2026-02-12T10:00:00.000Z',
        lastMessageAt: '2026-02-12T11:30:00.000Z',
        csatScore: 5,
        summary: 'Customer wanted to configure custom subdomain SSL. Agent guided them to point CNAME record to ingress.stellarb2b.com. Let\'s Encrypt certificate auto-renewed successfully.',
        problemDescription: 'Custom domain CNAME mapping configuration.',
        resolutionNotes: 'CNAME propagation confirmed, SSL cert active.',
      },
    ],
    messages: [
      {
        id: 'msg_1_1',
        conversationId: 'conv_1',
        senderType: 'customer',
        senderId: 'cust_alice',
        senderName: 'Alice Smith',
        content: 'Hi Sarah, our production vehicle ingestion workers are suddenly hitting 429 Rate Limit Exceeded on `/api/v2/telemetry`. We upgraded to Tier-3 yesterday—can you please verify our quota?',
        readAt: new Date(Date.now() - 3000000).toISOString(),
        createdAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'msg_1_2',
        conversationId: 'conv_1',
        senderType: 'agent',
        senderId: 'usr_sarah',
        senderName: 'Sarah Connor',
        content: 'Hello Alice! Looking into this immediately. Let me inspect the gateway tier allocation in our cluster.',
        readAt: new Date(Date.now() - 2500000).toISOString(),
        createdAt: new Date(Date.now() - 2800000).toISOString(),
      },
      {
        id: 'msg_1_3',
        conversationId: 'conv_1',
        senderType: 'customer',
        senderId: 'cust_alice',
        senderName: 'Alice Smith',
        content: 'Thank you! We have queued up about 40,000 metrics per second so an emergency override or burst ceiling would be fantastic.',
        readAt: null,
        createdAt: new Date(Date.now() - 600000).toISOString(),
      },
      {
        id: 'msg_2_1',
        conversationId: 'conv_2',
        senderType: 'customer',
        senderId: 'cust_bob',
        senderName: 'Bob Miller',
        content: 'Hey team, we are implementing your webhook receiver. What exact payload format and header should our servers verify for payment events?',
        readAt: new Date(Date.now() - 5000000).toISOString(),
        createdAt: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: 'msg_2_2',
        conversationId: 'conv_2',
        senderType: 'agent',
        senderId: 'usr_john',
        senderName: 'John Doe',
        content: 'Hey Bob! We sign all outbound POST webhooks with HMAC-SHA256 in the `X-Stellar-Signature` header. The payload schema for `payment.succeeded` is documented in our technical guide.',
        readAt: new Date(Date.now() - 4000000).toISOString(),
        createdAt: new Date(Date.now() - 4500000).toISOString(),
      },
      {
        id: 'msg_2_3',
        conversationId: 'conv_2',
        senderType: 'customer',
        senderId: 'cust_bob',
        senderName: 'Bob Miller',
        content: 'Awesome, does the signature include the timestamp or raw body bytes? Can you provide a Node.js verification snippet?',
        readAt: null,
        createdAt: new Date(Date.now() - 1200000).toISOString(),
      },
    ],
    kbArticles: [
      {
        id: 'kb_1',
        orgId: 'org_stellar',
        title: 'API Rate Limits & Burst Capacity (Tier 1-4)',
        category: 'Technical',
        content: `### API Rate Limiting Architecture

All Stellar API endpoints enforce token-bucket rate limiting based on your subscribed plan tier:

- **Tier 1 (Starter)**: 1,000 requests/minute, burst up to 1,500.
- **Tier 2 (Growth)**: 10,000 requests/minute, burst up to 15,000.
- **Tier 3 (Enterprise)**: 100,000 requests/minute, burst up to 150,000.
- **Tier 4 (Hyperscale)**: Custom dedicated ingress, unlimited burst.

#### Response Headers:
- \`X-RateLimit-Limit\`: Total requests allowed per minute window.
- \`X-RateLimit-Remaining\`: Remaining requests in current window.
- \`X-RateLimit-Reset\`: Epoch timestamp in seconds when quota replenishes.

If you encounter HTTP \`429 Too Many Requests\`, backoff exponentially and contact support to provision a burst quota override.`,
        createdAt: '2026-01-10T00:00:00.000Z',
        updatedAt: '2026-01-10T00:00:00.000Z',
      },
      {
        id: 'kb_2',
        orgId: 'org_stellar',
        title: 'API Webhook Event Payloads & Cryptographic Signatures',
        category: 'Technical',
        content: `### Webhook Delivery & Verification

All webhook payloads are delivered via HTTPS POST with JSON content.

#### Event Schema Example (\`payment.succeeded\`):
\`\`\`json
{
  "event": "payment.succeeded",
  "created": 1783456000,
  "data": {
    "amount": 25000,
    "currency": "usd",
    "customer": "cust_bob",
    "invoiceId": "inv_908123"
  }
}
\`\`\`

#### Verification Algorithm:
Each request contains a Header \`X-Stellar-Signature\` which is a HMAC-SHA256 signature calculated over the raw request body UTF-8 bytes using your webhook secret key.

\`\`\`javascript
const hmac = crypto.createHmac('sha256', webhookSecret);
const calculated = hmac.update(rawBody).digest('hex');
const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(calculated));
\`\`\``,
        createdAt: '2026-01-15T00:00:00.000Z',
        updatedAt: '2026-01-15T00:00:00.000Z',
      },
      {
        id: 'kb_3',
        orgId: 'org_stellar',
        title: 'Custom Subdomain & Automated SSL Provisioning',
        category: 'Technical',
        content: `### Custom White-Label Ingress Domains

To host your support hub or portal on a branded subdomain such as \`support.yourcompany.com\`:

1. Navigate to **Settings > Domains** in your dashboard.
2. Enter your desired fully qualified domain name.
3. Configure a DNS **CNAME record** pointing your subdomain to \`ingress.stellarb2b.com\`.
4. Our edge proxy automatically provisions an SNI Let's Encrypt TLS certificate within 10-15 minutes of DNS propagation.`,
        createdAt: '2026-01-20T00:00:00.000Z',
        updatedAt: '2026-01-20T00:00:00.000Z',
      },
      {
        id: 'kb_4',
        orgId: 'org_stellar',
        title: 'SLA Escalation Matrix & Priority Definitions',
        category: 'Billing',
        content: `### Enterprise Service Level Agreement (SLA) Matrix

Our support system monitors response and resolution timers automatically:

- **Urgent (P1)**: Production outage, data loss, or blocking customer disruption. Initial response SLA: **60 minutes**.
- **High (P2)**: Critical feature impairment with no acceptable workaround. Initial response SLA: **120 minutes**.
- **Medium (P3)**: Non-critical bugs, configuration queries, or general integration questions. Initial response SLA: **8 hours**.
- **Low (P4)**: Feature requests, minor styling, or general documentation review. Initial response SLA: **24 hours**.`,
        createdAt: '2026-01-25T00:00:00.000Z',
        updatedAt: '2026-01-25T00:00:00.000Z',
      },
    ],
    aiSuggestionsLogs: [],
    settings: [
      {
        orgId: 'org_stellar',
        slaConfig: { low: 1440, medium: 480, high: 120, urgent: 60 },
        businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'UTC' },
        routingRule: 'round-robin',
        apiKeys: [],
      },
      {
        orgId: 'org_horizon',
        slaConfig: { low: 1440, medium: 480, high: 120, urgent: 60 },
        businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'UTC' },
        routingRule: 'round-robin',
        apiKeys: [],
      },
    ],
  };
}

// Load DB into memory
export function initDb(): DatabaseSchema {
  if (inMemoryDb) return inMemoryDb;

  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Validate schema presence
      if (parsed.organizations && parsed.users && parsed.conversations) {
        // Ensure all users have matching hash for P@ssword123!
        const { hash, salt } = hashPassword('P@ssword123!');
        for (const u of parsed.users) {
          if (!u.passwordHash) {
            u.passwordHash = hash;
            u.passwordSalt = salt;
          }
        }
        inMemoryDb = {
          organizations: parsed.organizations || [],
          users: parsed.users || [],
          customers: parsed.customers || [],
          conversations: parsed.conversations || [],
          messages: parsed.messages || [],
          kbArticles: parsed.kbArticles || parsed.kb_articles || [],
          aiSuggestionsLogs: parsed.aiSuggestionsLogs || parsed.ai_suggestions_logs || [],
          settings: parsed.settings || [],
        };
        return inMemoryDb;
      }
    }
  } catch (err) {
    console.error('Error loading db.json, generating default seed:', err);
  }

  inMemoryDb = getInitialSeedData();
  saveDbSync();
  return inMemoryDb;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDbSync();
  }, 200);
}

function saveDbSync(): void {
  if (!inMemoryDb) return;
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(inMemoryDb, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to sync db to disk:', err);
  }
}

// --- Organizations ---
export async function getOrgById(id: string): Promise<Organization | null> {
  const db = initDb();
  return db.organizations.find((o) => o.id === id) || null;
}

// --- Users ---
export function publicUser(user: User): Omit<User, 'passwordHash' | 'passwordSalt'> {
  const { passwordHash: _h, passwordSalt: _s, ...rest } = user;
  return rest;
}

export async function getUserById(id: string): Promise<User | null> {
  const db = initDb();
  return db.users.find((u) => u.id === id) || null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = initDb();
  const normalized = email.trim().toLowerCase();
  return db.users.find((u) => u.email.trim().toLowerCase() === normalized) || null;
}

export async function getOrgUsers(orgId: string): Promise<User[]> {
  const db = initDb();
  return db.users.filter((u) => u.orgId === orgId);
}

export async function createOrgWithOwner(args: {
  orgName: string;
  email: string;
  name: string;
  password: string;
  avatarUrl?: string;
}): Promise<{ org: Organization; user: User }> {
  const db = initDb();
  const orgId = nid('org');
  const userId = nid('usr');
  const now = new Date().toISOString();

  const org: Organization = {
    id: orgId,
    name: args.orgName,
    createdAt: now,
  };

  const { hash, salt } = hashPassword(args.password);
  const user: User = {
    id: userId,
    orgId,
    role: 'owner',
    email: args.email.trim().toLowerCase(),
    name: args.name,
    avatarUrl: args.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=faces',
    status: 'online',
    passwordHash: hash,
    passwordSalt: salt,
  };

  const defaultSettings: SupportSettings = {
    orgId,
    slaConfig: { low: 1440, medium: 480, high: 120, urgent: 60 },
    businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'UTC' },
    routingRule: 'round-robin',
    apiKeys: [],
  };

  db.organizations.push(org);
  db.users.push(user);
  db.settings.push(defaultSettings);
  scheduleSave();

  return { org, user };
}

export async function updateUserStatus(userId: string, status: 'online' | 'offline' | 'busy'): Promise<User | null> {
  const db = initDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return null;
  user.status = status;
  scheduleSave();
  return user;
}

// --- Customers ---
export async function getCustomerById(id: string): Promise<Customer | null> {
  const db = initDb();
  const c = db.customers.find((cust) => cust.id === id);
  if (!c) return null;
  return { ...c, isOnline: isCustomerOnline(c.id) };
}

export async function getOrgCustomers(orgId: string): Promise<Customer[]> {
  const db = initDb();
  return db.customers
    .filter((c) => c.orgId === orgId)
    .map((c) => ({ ...c, isOnline: isCustomerOnline(c.id) }));
}

export async function upsertCustomer(data: Customer): Promise<Customer> {
  const db = initDb();
  const idx = db.customers.findIndex((c) => c.id === data.id);
  if (idx >= 0) {
    db.customers[idx] = { ...db.customers[idx], ...data };
  } else {
    db.customers.push(data);
  }
  scheduleSave();
  return data;
}

export async function patchCustomer(id: string, updates: Partial<Customer>): Promise<Customer | null> {
  const db = initDb();
  const cust = db.customers.find((c) => c.id === id);
  if (!cust) return null;
  Object.assign(cust, updates);
  scheduleSave();
  return cust;
}

// --- Conversations ---
export async function getConversations(orgId: string): Promise<Conversation[]> {
  const db = initDb();
  return db.conversations
    .filter((c) => c.orgId === orgId)
    .map((c) => ({ ...c, isCustomerOnline: isCustomerOnline(c.customerId) }))
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
}

export async function getConversationById(id: string): Promise<Conversation | null> {
  const db = initDb();
  const conv = db.conversations.find((c) => c.id === id);
  if (!conv) return null;
  return { ...conv, isCustomerOnline: isCustomerOnline(conv.customerId) };
}

export async function createConversation(c: Conversation): Promise<Conversation> {
  const db = initDb();
  db.conversations.unshift(c);
  scheduleSave();
  return c;
}

export async function updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | null> {
  const db = initDb();
  const conv = db.conversations.find((c) => c.id === id);
  if (!conv) return null;
  Object.assign(conv, updates);
  scheduleSave();
  return conv;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const db = initDb();
  const initialLength = db.conversations.length;
  db.conversations = db.conversations.filter((c) => c.id !== id);
  db.messages = db.messages.filter((m) => m.conversationId !== id);
  db.aiSuggestionsLogs = db.aiSuggestionsLogs.filter((l) => l.conversationId !== id);
  scheduleSave();
  return db.conversations.length < initialLength;
}

export async function clearOfflineConversations(orgId: string): Promise<{ ids: string[]; deletedCustomerIds: string[] }> {
  const db = initDb();
  const convs = db.conversations.filter((c) => c.orgId === orgId);
  const toDelete: string[] = [];

  for (const c of convs) {
    if (!isCustomerOnline(c.customerId)) {
      toDelete.push(c.id);
    }
  }

  const presetIds = new Set(['cust_alice', 'cust_bob', 'cust_charlie']);
  const deletedCustomerIds: string[] = [];

  for (const id of toDelete) {
    const conv = db.conversations.find((c) => c.id === id);
    if (conv) {
      db.conversations = db.conversations.filter((c) => c.id !== id);
      db.messages = db.messages.filter((m) => m.conversationId !== id);
      db.aiSuggestionsLogs = db.aiSuggestionsLogs.filter((l) => l.conversationId !== id);

      if (!presetIds.has(conv.customerId)) {
        const stillInUse = db.conversations.some((c) => c.customerId === conv.customerId);
        if (!stillInUse) {
          db.customers = db.customers.filter((c) => c.id !== conv.customerId);
          deletedCustomerIds.push(conv.customerId);
        }
      }
    }
  }

  dropPresence(deletedCustomerIds);
  scheduleSave();
  return { ids: toDelete, deletedCustomerIds };
}

// --- Messages ---
export async function getMessages(conversationId: string): Promise<Message[]> {
  const db = initDb();
  return db.messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function saveMessage(m: Message): Promise<Message> {
  const db = initDb();
  db.messages.push(m);

  // Update conversation lastMessageAt
  const conv = db.conversations.find((c) => c.id === m.conversationId);
  if (conv) {
    conv.lastMessageAt = m.createdAt;
  }

  scheduleSave();
  return m;
}

export async function markMessagesAsRead(conversationId: string, readerType: 'agent' | 'customer'): Promise<void> {
  const db = initDb();
  const now = new Date().toISOString();
  let updated = false;

  for (const msg of db.messages) {
    if (msg.conversationId === conversationId && !msg.readAt) {
      if ((readerType === 'agent' && msg.senderType === 'customer') ||
          (readerType === 'customer' && msg.senderType === 'agent')) {
        msg.readAt = now;
        updated = true;
      }
    }
  }

  if (updated) scheduleSave();
}

// --- Knowledge Base ---
export async function getKbArticles(orgId: string): Promise<KBArticle[]> {
  const db = initDb();
  return db.kbArticles.filter((a) => a.orgId === orgId);
}

export async function getKbArticleById(id: string): Promise<KBArticle | null> {
  const db = initDb();
  return db.kbArticles.find((a) => a.id === id) || null;
}

export async function createKbArticle(article: KBArticle): Promise<KBArticle> {
  const db = initDb();
  db.kbArticles.push(article);
  scheduleSave();
  return article;
}

export async function updateKbArticle(id: string, updates: Partial<KBArticle>): Promise<KBArticle | null> {
  const db = initDb();
  const art = db.kbArticles.find((a) => a.id === id);
  if (!art) return null;
  Object.assign(art, { ...updates, updatedAt: new Date().toISOString() });
  scheduleSave();
  return art;
}

export async function deleteKbArticle(id: string): Promise<boolean> {
  const db = initDb();
  const len = db.kbArticles.length;
  db.kbArticles = db.kbArticles.filter((a) => a.id !== id);
  scheduleSave();
  return db.kbArticles.length < len;
}

export async function saveKbEmbedding(id: string, embedding: number[]): Promise<void> {
  const db = initDb();
  const art = db.kbArticles.find((a) => a.id === id);
  if (art) {
    art.embedding = embedding;
    scheduleSave();
  }
}

export async function searchKbArticles(query: string, orgId: string): Promise<KBArticle[]> {
  const db = initDb();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return db.kbArticles.filter((a) => a.orgId === orgId);

  return db.kbArticles
    .filter((a) => a.orgId === orgId)
    .map((a) => {
      let score = 0;
      const titleLower = a.title.toLowerCase();
      const contentLower = a.content.toLowerCase();
      const catLower = a.category.toLowerCase();

      for (const t of terms) {
        if (titleLower.includes(t)) score += 10;
        if (catLower.includes(t)) score += 5;
        if (contentLower.includes(t)) score += 2;
      }
      return { article: a, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.article);
}

// --- AI Suggestions & Copilot Logs ---
export async function addSuggestionLog(log: AISuggestionLog): Promise<void> {
  const db = initDb();
  db.aiSuggestionsLogs.push(log);
  scheduleSave();
}

export async function getLatestSuggestionLog(conversationId: string): Promise<AISuggestionLog | null> {
  const db = initDb();
  const logs = db.aiSuggestionsLogs
    .filter((l) => l.conversationId === conversationId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return logs[0] || null;
}

export async function getLogWithConversation(id: string): Promise<{ log: AISuggestionLog; conv: Conversation | null }> {
  const db = initDb();
  const log = db.aiSuggestionsLogs.find((l) => l.id === id);
  if (!log) throw new Error('not_found');
  const conv = db.conversations.find((c) => c.id === log.conversationId) || null;
  return { log, conv };
}

export async function updateSuggestionLog(id: string, wasUsed: boolean, agentEdited: boolean): Promise<boolean> {
  const db = initDb();
  const log = db.aiSuggestionsLogs.find((l) => l.id === id);
  if (!log) return false;
  log.wasUsed = wasUsed;
  log.agentEdited = agentEdited;
  scheduleSave();
  return true;
}

// --- Settings ---
export async function getSettings(orgId: string): Promise<SupportSettings> {
  const db = initDb();
  let s = db.settings.find((item) => item.orgId === orgId);
  if (!s) {
    s = {
      orgId,
      slaConfig: { low: 1440, medium: 480, high: 120, urgent: 60 },
      businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'UTC' },
      routingRule: 'round-robin',
      apiKeys: [],
    };
    db.settings.push(s);
    scheduleSave();
  }
  return s;
}

export async function updateSettings(orgId: string, updates: Partial<SupportSettings>): Promise<SupportSettings> {
  const db = initDb();
  let s = db.settings.find((item) => item.orgId === orgId);
  if (!s) {
    s = {
      orgId,
      slaConfig: { low: 1440, medium: 480, high: 120, urgent: 60 },
      businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'UTC' },
      routingRule: 'round-robin',
      apiKeys: [],
    };
    db.settings.push(s);
  }
  Object.assign(s, updates, { orgId });
  scheduleSave();
  return s;
}

// --- Analytics ---
export async function getAnalytics(orgId: string) {
  const db = initDb();
  const convs = db.conversations.filter((c) => c.orgId === orgId);
  const totalTickets = convs.length;
  const openTickets = convs.filter((c) => c.status === 'open').length;
  const pendingTickets = convs.filter((c) => c.status === 'pending').length;
  const closedTickets = convs.filter((c) => c.status === 'closed').length;

  const ratings = convs.filter((c) => c.csatScore !== undefined).map((c) => c.csatScore!);
  const averageCsat = ratings.length > 0 ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)) : 5.0;

  const now = new Date();
  const slaBreached = convs.filter((c) => {
    if (c.status === 'closed') return false;
    return c.slaBreachTime && new Date(c.slaBreachTime) < now;
  }).length;

  const logs = db.aiSuggestionsLogs.filter((l) => {
    const c = db.conversations.find((conv) => conv.id === l.conversationId);
    return c && c.orgId === orgId;
  });

  const helpfulPercentage = logs.length > 0
    ? Math.round((logs.filter((l) => l.wasUsed).length / logs.length) * 100)
    : 88;

  // Breakdown by agents
  const agents = db.users.filter((u) => u.orgId === orgId && (u.role === 'agent' || u.role === 'owner'));
  const agentStats = agents.map((agent) => {
    const agentConvs = convs.filter((c) => c.assignedAgentId === agent.id);
    const resolved = agentConvs.filter((c) => c.status === 'closed').length;
    const scores = agentConvs.filter((c) => c.csatScore !== undefined).map((c) => c.csatScore!);
    const csat = scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : 4.9;
    return {
      agentId: agent.id,
      name: agent.name,
      avatarUrl: agent.avatarUrl,
      role: agent.role,
      assignedCount: agentConvs.length,
      resolvedCount: resolved,
      csatScore: csat,
    };
  });

  return {
    totalTickets,
    openTickets,
    pendingTickets,
    closedTickets,
    averageCsat,
    slaBreached,
    helpfulPercentage,
    agentStats,
    ticketVolumeTrends: [
      { name: 'Mon', tickets: Math.max(2, Math.floor(totalTickets * 0.4)) },
      { name: 'Tue', tickets: Math.max(3, Math.floor(totalTickets * 0.6)) },
      { name: 'Wed', tickets: Math.max(4, Math.floor(totalTickets * 0.8)) },
      { name: 'Thu', tickets: Math.max(3, Math.floor(totalTickets * 0.7)) },
      { name: 'Fri', tickets: Math.max(5, Math.floor(totalTickets * 0.9)) },
      { name: 'Sat', tickets: 2 },
      { name: 'Sun', tickets: totalTickets },
    ],
  };
}

// --- Workspace Operations ---
export async function resetWorkspaceData(orgId: string): Promise<{ conversations: number; customers: number }> {
  const seed = getInitialSeedData();
  const db = initDb();

  // Reset to clean seed for this org
  db.conversations = seed.conversations.filter((c) => c.orgId === orgId);
  db.messages = seed.messages;
  db.customers = seed.customers.filter((c) => c.orgId === orgId);
  db.aiSuggestionsLogs = [];

  scheduleSave();
  return { conversations: db.conversations.length, customers: db.customers.length };
}

export async function deleteWorkspace(orgId: string): Promise<void> {
  const db = initDb();
  db.conversations = db.conversations.filter((c) => c.orgId !== orgId);
  db.messages = db.messages.filter((m) => {
    const c = db.conversations.find((conv) => conv.id === m.conversationId);
    return !!c;
  });
  db.customers = db.customers.filter((c) => c.orgId !== orgId);
  db.kbArticles = db.kbArticles.filter((a) => a.orgId !== orgId);
  db.settings = db.settings.filter((s) => s.orgId !== orgId);
  db.users = db.users.filter((u) => u.orgId !== orgId);
  db.organizations = db.organizations.filter((o) => o.id !== orgId);
  scheduleSave();
}
