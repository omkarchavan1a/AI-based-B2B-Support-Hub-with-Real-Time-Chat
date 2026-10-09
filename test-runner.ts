/**
 * Comprehensive Step-by-Step Test Runner for B2B Support Hub.
 * Validates all endpoints, flows, security rules, data layers, and edge cases.
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

interface TestResult {
  step: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details?: any;
  error?: string;
}

const results: TestResult[] = [];

async function runStep(
  stepNumber: string,
  testName: string,
  fn: () => Promise<any>
): Promise<any> {
  const start = Date.now();
  try {
    const res = await fn();
    const durationMs = Date.now() - start;
    results.push({
      step: stepNumber,
      name: testName,
      passed: true,
      durationMs,
      details: typeof res === 'object' ? JSON.stringify(res).slice(0, 80) : String(res),
    });
    console.log(`  ✓ [${stepNumber}] ${testName} (${durationMs}ms)`);
    return res;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({
      step: stepNumber,
      name: testName,
      passed: false,
      durationMs,
      error: err.message || String(err),
    });
    console.error(`  ✗ [${stepNumber}] ${testName} (${durationMs}ms) - ERROR: ${err.message}`);
    return null;
  }
}

async function request(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, data: json };
}

async function main() {
  console.log(`\n============================================================`);
  console.log(`🚀 Starting Comprehensive B2B Support Hub Test Suite`);
  console.log(`🎯 Target URL: ${BASE_URL}`);
  console.log(`============================================================\n`);

  let authToken = '';
  let currentOrgId = 'org_stellar';
  let createdConvId = '';
  let createdCustomerId = '';
  let createdArticleId = '';
  let copilotLogId = '';

  // -------------------------------------------------------------------------
  // SUITE 1: System Health & Diagnostics
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 1: System Health & Diagnostics] ---`);

  await runStep('1.1', 'Health Check endpoint (/api/health)', async () => {
    const res = await request('/api/health');
    if (!res.ok || res.data.status !== 'ok') {
      throw new Error(`Expected status 200 with status "ok", got ${res.status}`);
    }
    if (typeof res.data.hasGeminiKey !== 'boolean') {
      throw new Error(`Missing hasGeminiKey in health response`);
    }
    return `Status: ${res.data.status}, Gemini Key: ${res.data.hasGeminiKey}`;
  });

  await runStep('1.2', 'Database Status endpoint (/api/db-status)', async () => {
    const res = await request('/api/db-status');
    if (!res.ok || res.data.status !== 'ok') {
      throw new Error(`Expected 200 ok, got ${res.status}`);
    }
    const c = res.data.counts;
    if (!c || typeof c.organizations !== 'number' || typeof c.users !== 'number') {
      throw new Error(`Malformed counts in db-status`);
    }
    return `Entities: ${c.users} users, ${c.conversations} convs, ${c.messages} msgs`;
  });

  // -------------------------------------------------------------------------
  // SUITE 2: Authentication & Security
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 2: Authentication & Security] ---`);

  await runStep('2.1', 'Login with valid credentials', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'stellar-admin@b2bhub.ai',
        password: 'P@ssword123!',
      }),
    });
    if (!res.ok || !res.data.token || !res.data.user) {
      throw new Error(`Login failed: ${JSON.stringify(res.data)}`);
    }
    authToken = res.data.token;
    currentOrgId = res.data.org?.id || 'org_stellar';
    return `Token generated for ${res.data.user.email} (Org: ${currentOrgId})`;
  });

  await runStep('2.2', 'Reject login with invalid password', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'stellar-admin@b2bhub.ai',
        password: 'WrongPassword!',
      }),
    });
    if (res.status !== 401) {
      throw new Error(`Expected 401 Unauthorized, got status ${res.status}`);
    }
    return 'Correctly rejected with 401';
  });

  await runStep('2.3', 'Session validation (/api/auth/me) with valid token', async () => {
    const res = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || !res.data.user) {
      throw new Error(`Session verify failed with status ${res.status}`);
    }
    return `Verified user: ${res.data.user.name} (${res.data.user.role})`;
  });

  await runStep('2.4', 'Reject session validation without token', async () => {
    const res = await request('/api/auth/me');
    if (res.status !== 401) {
      throw new Error(`Expected 401 Unauthorized for missing token, got ${res.status}`);
    }
    return 'Correctly protected with 401';
  });

  const testEmail = `test_${Date.now()}@enterprise.com`;
  await runStep('2.5', 'Register new organization and owner account', async () => {
    const res = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Alex Test',
        email: testEmail,
        password: 'TestPassword123!',
        companyName: 'Test Enterprise Corp',
      }),
    });
    if (!res.ok || !res.data.token || !res.data.user) {
      throw new Error(`Signup failed: ${JSON.stringify(res.data)}`);
    }
    return `Signed up user: ${res.data.user.name} for ${res.data.org?.name}`;
  });

  await runStep('2.6', 'Reject registration with duplicate email', async () => {
    const res = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Alex Duplicate',
        email: testEmail,
        password: 'TestPassword123!',
        companyName: 'Test Duplicate Corp',
      }),
    });
    if (res.status !== 409) {
      throw new Error(`Expected 409 Conflict for duplicate email, got ${res.status}`);
    }
    return 'Correctly rejected duplicate email with 409';
  });

  // -------------------------------------------------------------------------
  // SUITE 3: Agents & Multi-User Operations
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 3: Agents & Multi-User Operations] ---`);

  await runStep('3.1', 'List organization agents (/api/users)', async () => {
    const res = await request('/api/users', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
      throw new Error(`Failed to list agents: ${JSON.stringify(res.data)}`);
    }
    return `Found ${res.data.length} agents: ${res.data.map((u: any) => u.name).join(', ')}`;
  });

  await runStep('3.2', 'Update agent presence status (/api/users/status)', async () => {
    const res = await request('/api/users/status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status: 'busy' }),
    });
    if (!res.ok || res.data.status !== 'busy') {
      throw new Error(`Failed to update status to busy: ${JSON.stringify(res.data)}`);
    }
    // Revert to online
    await request('/api/users/status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status: 'online' }),
    });
    return 'Presence toggled to busy and back to online';
  });

  // -------------------------------------------------------------------------
  // SUITE 4: Ticket & Conversation Lifecycle Management
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 4: Ticket & Conversation Lifecycle Management] ---`);

  await runStep('4.1', 'List all conversations for organization (/api/conversations)', async () => {
    const res = await request(`/api/conversations?orgId=${currentOrgId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || !Array.isArray(res.data)) {
      throw new Error(`Failed to list conversations: ${JSON.stringify(res.data)}`);
    }
    return `Loaded ${res.data.length} active tickets`;
  });

  await runStep('4.2', 'Create new support ticket (/api/conversations)', async () => {
    createdCustomerId = 'cust_alice';
    const res = await request('/api/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        orgId: currentOrgId,
        customerId: createdCustomerId,
        priority: 'high',
        channel: 'widget',
        problemDescription: 'Automated test suite ticket for API gateway verification.',
        tags: ['testing', 'automation'],
      }),
    });
    if (!res.ok || !res.data.id) {
      throw new Error(`Failed to create ticket: ${JSON.stringify(res.data)}`);
    }
    createdConvId = res.data.id;
    return `Ticket created: ${createdConvId} (Ticket token: ${res.data.ticket ? 'present' : 'none'})`;
  });

  await runStep('4.3', 'Retrieve single conversation by ID (/api/conversations/:id)', async () => {
    const res = await request(`/api/conversations/${createdConvId}`);
    if (!res.ok || res.data.id !== createdConvId) {
      throw new Error(`Failed to get conversation: ${JSON.stringify(res.data)}`);
    }
    return `Retrieved ticket ${res.data.id} with priority ${res.data.priority}`;
  });

  await runStep('4.4', 'Update ticket status (/api/conversations/:id)', async () => {
    const res = await request(`/api/conversations/${createdConvId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status: 'pending' }),
    });
    if (!res.ok || res.data.status !== 'pending') {
      throw new Error(`Status update failed: ${JSON.stringify(res.data)}`);
    }
    return `Updated status to ${res.data.status}`;
  });

  await runStep('4.5', 'Update ticket priority and tags', async () => {
    const res = await request(`/api/conversations/${createdConvId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        priority: 'urgent',
        tags: ['testing', 'urgent', 'verified'],
      }),
    });
    if (!res.ok || res.data.priority !== 'urgent' || res.data.tags.length !== 3) {
      throw new Error(`Priority update failed: ${JSON.stringify(res.data)}`);
    }
    return `Updated priority to ${res.data.priority}, tags: ${res.data.tags.join(', ')}`;
  });

  await runStep('4.6', 'Claim / assign ticket to active agent', async () => {
    const res = await request(`/api/conversations/${createdConvId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ assignedAgentId: 'usr_sarah' }),
    });
    if (!res.ok || res.data.assignedAgentId !== 'usr_sarah') {
      throw new Error(`Claim assignment failed: ${JSON.stringify(res.data)}`);
    }
    return `Assigned to usr_sarah successfully`;
  });

  // -------------------------------------------------------------------------
  // SUITE 5: Real-Time Messaging & Typing Indicators
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 5: Real-Time Messaging & Typing Indicators] ---`);

  await runStep('5.1', 'Send agent message to ticket', async () => {
    const res = await request(`/api/conversations/${createdConvId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        content: 'Hello! I am investigating your automated test case now.',
        senderType: 'agent',
        senderId: 'usr_sarah',
        senderName: 'Sarah Connor',
      }),
    });
    if (!res.ok || !res.data.id || res.data.content !== 'Hello! I am investigating your automated test case now.') {
      throw new Error(`Failed to post message: ${JSON.stringify(res.data)}`);
    }
    return `Message sent: ${res.data.id}`;
  });

  await runStep('5.2', 'Send customer reply to ticket', async () => {
    const res = await request(`/api/conversations/${createdConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: 'Thank you Sarah, what is the API burst limit for Tier 2 plans?',
        senderType: 'customer',
        senderId: createdCustomerId,
        senderName: 'Alice Smith',
      }),
    });
    if (!res.ok || !res.data.id) {
      throw new Error(`Failed to post customer message: ${JSON.stringify(res.data)}`);
    }
    return `Customer reply posted: ${res.data.id}`;
  });

  await runStep('5.3', 'Retrieve messages history for ticket', async () => {
    const res = await request(`/api/conversations/${createdConvId}/messages`);
    if (!res.ok || !Array.isArray(res.data) || res.data.length < 2) {
      throw new Error(`Expected at least 2 messages, got ${res.data?.length}`);
    }
    return `Found ${res.data.length} messages in conversation thread`;
  });

  await runStep('5.4', 'Dispatch typing status indicator (/api/conversations/:id/typing)', async () => {
    const res = await request(`/api/conversations/${createdConvId}/typing`, {
      method: 'POST',
      body: JSON.stringify({ isTyping: true, senderType: 'agent' }),
    });
    if (!res.ok || res.data.success !== true) {
      throw new Error(`Typing dispatch failed: ${JSON.stringify(res.data)}`);
    }
    return 'Typing event emitted successfully';
  });

  // -------------------------------------------------------------------------
  // SUITE 6: AI Support Copilot & Knowledge Base RAG
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 6: AI Support Copilot & Knowledge Base RAG] ---`);

  await runStep('6.1', 'Generate AI Copilot response grounded in KB (/api/copilot/generate)', async () => {
    const res = await request('/api/copilot/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ conversationId: createdConvId }),
    });
    if (!res.ok || !res.data.suggestedText) {
      throw new Error(`Copilot generation failed: ${JSON.stringify(res.data)}`);
    }
    copilotLogId = res.data.id;
    return `AI draft generated: "${res.data.suggestedText.slice(0, 60)}..." (Log: ${copilotLogId})`;
  });

  await runStep('6.2', 'Fetch latest copilot suggestion (/api/copilot/latest)', async () => {
    const res = await request(`/api/copilot/latest?conversationId=${createdConvId}`);
    if (!res.ok || !res.data || !res.data.suggestedText) {
      throw new Error(`Copilot fetch failed: ${JSON.stringify(res.data)}`);
    }
    return `Latest suggestion verified: Log ID ${res.data.id}`;
  });

  await runStep('6.3', 'Record copilot feedback telemetry (/api/copilot/feedback)', async () => {
    const res = await request('/api/copilot/feedback', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        logId: copilotLogId,
        wasUsed: true,
        agentEdited: false,
      }),
    });
    if (!res.ok || res.data.success !== true) {
      throw new Error(`Feedback submission failed: ${JSON.stringify(res.data)}`);
    }
    return 'Feedback recorded (wasUsed: true)';
  });

  await runStep('6.4', 'Generate conversation summary and sentiment (/api/conversations/:id/ai-summarize)', async () => {
    const res = await request(`/api/conversations/${createdConvId}/ai-summarize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || !res.data.summary) {
      throw new Error(`AI summarize failed: ${JSON.stringify(res.data)}`);
    }
    return `Summary: "${res.data.summary.slice(0, 50)}...", Sentiment: ${res.data.sentiment}`;
  });

  // -------------------------------------------------------------------------
  // SUITE 7: Knowledge Base Operations & Search
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 7: Knowledge Base Operations & Search] ---`);

  await runStep('7.1', 'List all Knowledge Base articles (/api/kb)', async () => {
    const res = await request(`/api/kb?orgId=${currentOrgId}`);
    if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
      throw new Error(`Failed to list KB articles: ${JSON.stringify(res.data)}`);
    }
    return `Found ${res.data.length} articles`;
  });

  await runStep('7.2', 'Search Knowledge Base articles by keyword (/api/kb/search)', async () => {
    const res = await request(`/api/kb/search?q=webhook&orgId=${currentOrgId}`);
    if (!res.ok || !Array.isArray(res.data)) {
      throw new Error(`KB search failed: ${JSON.stringify(res.data)}`);
    }
    return `Found ${res.data.length} articles matching "webhook"`;
  });

  await runStep('7.3', 'Create new Knowledge Base article (/api/kb)', async () => {
    const res = await request('/api/kb', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        title: 'Automated Testing Guide & Endpoints',
        category: 'Technical',
        content: 'This document explains the automated test cases and endpoint schemas for the B2B support hub.',
      }),
    });
    if (!res.ok || !res.data.id) {
      throw new Error(`Failed to create KB article: ${JSON.stringify(res.data)}`);
    }
    createdArticleId = res.data.id;
    return `Article created: ${createdArticleId} ("${res.data.title}")`;
  });

  await runStep('7.4', 'Update Knowledge Base article (/api/kb/:id)', async () => {
    const res = await request(`/api/kb/${createdArticleId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        title: 'Automated Testing Guide & Endpoints (Updated)',
      }),
    });
    if (!res.ok || res.data.title !== 'Automated Testing Guide & Endpoints (Updated)') {
      throw new Error(`Failed to update KB article: ${JSON.stringify(res.data)}`);
    }
    return `Updated article title successfully`;
  });

  await runStep('7.5', 'Delete temporary Knowledge Base article (/api/kb/:id)', async () => {
    const res = await request(`/api/kb/${createdArticleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || res.data.success !== true) {
      throw new Error(`Failed to delete KB article: ${JSON.stringify(res.data)}`);
    }
    return `Article deleted successfully`;
  });

  // -------------------------------------------------------------------------
  // SUITE 8: Customer CRM Management
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 8: Customer CRM Management] ---`);

  await runStep('8.1', 'List customers (/api/customers)', async () => {
    const res = await request(`/api/customers?orgId=${currentOrgId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
      throw new Error(`Failed to list customers: ${JSON.stringify(res.data)}`);
    }
    return `Found ${res.data.length} registered customer accounts`;
  });

  await runStep('8.2', 'Fetch customer profile (/api/customers/:id)', async () => {
    const res = await request(`/api/customers/cust_alice`);
    if (!res.ok || res.data.id !== 'cust_alice') {
      throw new Error(`Failed to get customer: ${JSON.stringify(res.data)}`);
    }
    return `Customer: ${res.data.name} from ${res.data.companyName}`;
  });

  await runStep('8.3', 'Update customer notes and phone (/api/customers/:id)', async () => {
    const res = await request(`/api/customers/cust_alice`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        notes: 'Verified enterprise account with updated telemetry priority.',
        phone: '+1 (555) 999-8888',
      }),
    });
    if (!res.ok || res.data.phone !== '+1 (555) 999-8888') {
      throw new Error(`Failed to update customer: ${JSON.stringify(res.data)}`);
    }
    return `Customer notes and phone updated`;
  });

  // -------------------------------------------------------------------------
  // SUITE 9: Analytics & Performance Metrics
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 9: Analytics & Performance Metrics] ---`);

  await runStep('9.1', 'Fetch analytics dashboard metrics (/api/analytics)', async () => {
    const res = await request(`/api/analytics?orgId=${currentOrgId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || typeof res.data.totalTickets !== 'number') {
      throw new Error(`Failed to fetch analytics: ${JSON.stringify(res.data)}`);
    }
    const a = res.data;
    return `Total Tickets: ${a.totalTickets}, Open: ${a.openTickets}, CSAT: ${a.averageCsat}, Helpful: ${a.helpfulPercentage}%`;
  });

  // -------------------------------------------------------------------------
  // SUITE 10: Settings, SLAs & Cleanup
  // -------------------------------------------------------------------------
  console.log(`\n--- [Suite 10: Settings, SLAs & Cleanup] ---`);

  await runStep('10.1', 'Fetch support organization settings (/api/settings)', async () => {
    const res = await request(`/api/settings?orgId=${currentOrgId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || !res.data.slaConfig) {
      throw new Error(`Failed to get settings: ${JSON.stringify(res.data)}`);
    }
    return `SLA config: Urgent=${res.data.slaConfig.urgent}m, High=${res.data.slaConfig.high}m`;
  });

  await runStep('10.2', 'Update SLA thresholds (/api/settings)', async () => {
    const res = await request('/api/settings', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        slaConfig: { low: 1440, medium: 480, high: 90, urgent: 45 },
      }),
    });
    if (!res.ok || res.data.slaConfig?.urgent !== 45) {
      throw new Error(`SLA update failed: ${JSON.stringify(res.data)}`);
    }
    return `Updated urgent SLA to 45 minutes`;
  });

  await runStep('10.3', 'Delete temporary test ticket (/api/conversations/:id)', async () => {
    const res = await request(`/api/conversations/${createdConvId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok || res.data.success !== true) {
      throw new Error(`Failed to delete conversation: ${JSON.stringify(res.data)}`);
    }
    return `Temporary test conversation ${createdConvId} cleaned up`;
  });

  // -------------------------------------------------------------------------
  // Summary Report
  // -------------------------------------------------------------------------
  console.log(`\n============================================================`);
  console.log(`📊 Test Execution Summary Report`);
  console.log(`============================================================`);

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log(`Total Steps Tested:  ${total}`);
  console.log(`Passed:              ${passed} (✓)`);
  console.log(`Failed:              ${failed} (✗)`);
  console.log(`Total Time:          ${totalDuration}ms`);
  console.log(`Success Rate:        ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log(`\n❌ Failed Tests:`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - [${r.step}] ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log(`\n🎉 All test cases passed with zero bugs or errors!`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
