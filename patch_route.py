import json

file_path = "b:/Backup/own-manifest/app/api/admin/moderation-bot/route.ts"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Insert tool schemas
schemas_str = """
  {
    type: 'function',
    function: {
      name: 'listGameRequests',
      description: 'Fetch pending game requests.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'approveGameRequest',
      description: 'Mark a game request as fulfilled.',
      parameters: {
        type: 'object',
        properties: { requestId: { type: 'string' } },
        required: ['requestId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rejectGameRequest',
      description: 'Deny a game request.',
      parameters: {
        type: 'object',
        properties: { requestId: { type: 'string' }, reason: { type: 'string' } },
        required: ['requestId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'adjustUserCoins',
      description: 'Add or remove coins from a user.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' }, amount: { type: 'number', description: 'Positive or negative integer' } },
        required: ['userId', 'amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'createIncident',
      description: 'Create a system incident.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, severity: { type: 'string', enum: ['minor', 'major', 'maintenance', 'resolved'] } },
        required: ['title', 'severity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'createSystemNotification',
      description: 'Publish a banner alert.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, message: { type: 'string' }, description: { type: 'string' }, type: { type: 'string', enum: ['warning', 'error'] } },
        required: ['message', 'type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'overrideTrialTest',
      description: 'Override trial test status.',
      parameters: {
        type: 'object',
        properties: { testId: { type: 'string' }, status: { type: 'string', enum: ['OVERRIDE_PASS', 'OVERRIDE_FAIL'] }, notes: { type: 'string' } },
        required: ['testId', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listUserApiKeys',
      description: 'List active API keys for a user.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'revokeApiKey',
      description: 'Disable/revoke a specific API key.',
      parameters: {
        type: 'object',
        properties: { keyId: { type: 'string' } },
        required: ['keyId']
      }
    }
  },
"""

target_tools_end = """  {
    type: 'function',
    function: {
      name: 'getSystemStatus',"""

content = content.replace(target_tools_end, schemas_str + target_tools_end, 1)


# 2. Insert tool functions
functions_str = """
async function listGameRequests() {
  return await (prisma as any).gameRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { user: { select: { username: true } } }
  });
}

async function approveGameRequest(requestId: string, performerId?: string, performerIp?: string) {
  const req = await (prisma as any).gameRequest.update({
    where: { id: requestId },
    data: { status: 'FULFILLED' }
  });
  if (performerId) await createAuditLog(performerId, 'APPROVE_GAME_REQUEST', requestId, `Approved request ${req.name}`, performerIp);
  return { success: true, request: req };
}

async function rejectGameRequest(requestId: string, reason?: string, performerId?: string, performerIp?: string) {
  const req = await (prisma as any).gameRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED' }
  });
  if (performerId) await createAuditLog(performerId, 'REJECT_GAME_REQUEST', requestId, `Rejected request ${req.name}. Reason: ${reason}`, performerIp);
  return { success: true, request: req };
}

async function adjustUserCoins(userId: string, amount: number, performerId?: string, performerIp?: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { coins: { increment: amount } },
    select: { id: true, username: true, coins: true }
  });
  if (performerId) await createAuditLog(performerId, 'ADJUST_COINS', userId, `Adjusted coins by ${amount}. New balance: ${user.coins}`, performerIp);
  return { success: true, user };
}

async function createIncident(title: string, severity: string, performerId?: string, performerIp?: string) {
  const incident = await (prisma as any).incident.create({
    data: { title, severity }
  });
  if (performerId) await createAuditLog(performerId, 'CREATE_INCIDENT', incident.id, `Created incident: ${title}`, performerIp);
  return { success: true, incident };
}

async function createSystemNotification(title: string, message: string, description: string, type: string, performerId?: string, performerIp?: string) {
  const notif = await (prisma as any).systemNotification.create({
    data: { title, message, description, type, active: true }
  });
  if (performerId) await createAuditLog(performerId, 'CREATE_SYSTEM_NOTIFICATION', notif.id, `Created notification: ${title}`, performerIp);
  return { success: true, notification: notif };
}

async function overrideTrialTest(testId: string, status: string, notes?: string, performerId?: string, performerIp?: string) {
  const test = await (prisma as any).trialTest.update({
    where: { id: testId },
    data: { status, adminNotes: notes, adminId: performerId, gradedAt: new Date() }
  });
  if (performerId) await createAuditLog(performerId, 'OVERRIDE_TRIAL_TEST', testId, `Set test to ${status}. Notes: ${notes}`, performerIp);
  return { success: true, test };
}

async function listUserApiKeys(userId: string) {
  return await (prisma as any).apiKey.findMany({
    where: { userId },
    select: { id: true, name: true, enabled: true, rateLimit: true, createdAt: true, lastUsed: true }
  });
}

async function revokeApiKey(keyId: string, performerId?: string, performerIp?: string) {
  const key = await (prisma as any).apiKey.update({
    where: { id: keyId },
    data: { enabled: false, adminDisable: true }
  });
  if (performerId) await createAuditLog(performerId, 'REVOKE_API_KEY', keyId, `Revoked API key: ${key.name}`, performerIp);
  return { success: true, key };
}

"""

target_funcs_end = "export async function GET(request: NextRequest) {"
content = content.replace(target_funcs_end, functions_str + target_funcs_end, 1)


# 3. Insert tool handles
handles_str = """
            } else if (name === 'listGameRequests') {
              toolResult = await listGameRequests();
            } else if (name === 'approveGameRequest') {
              if (typeof args.requestId !== 'string') throw new Error('requestId must be a string');
              toolResult = await approveGameRequest(args.requestId, caller.id, performerIp);
            } else if (name === 'rejectGameRequest') {
              if (typeof args.requestId !== 'string') throw new Error('requestId must be a string');
              toolResult = await rejectGameRequest(args.requestId, args.reason, caller.id, performerIp);
            } else if (name === 'adjustUserCoins') {
              if (typeof args.userId !== 'string') throw new Error('userId must be a string');
              if (typeof args.amount !== 'number') throw new Error('amount must be a number');
              toolResult = await adjustUserCoins(args.userId, args.amount, caller.id, performerIp);
            } else if (name === 'createIncident') {
              if (typeof args.title !== 'string') throw new Error('title must be a string');
              if (typeof args.severity !== 'string') throw new Error('severity must be a string');
              toolResult = await createIncident(args.title, args.severity, caller.id, performerIp);
            } else if (name === 'createSystemNotification') {
              if (typeof args.message !== 'string') throw new Error('message must be a string');
              toolResult = await createSystemNotification(args.title, args.message, args.description, args.type, caller.id, performerIp);
            } else if (name === 'overrideTrialTest') {
              if (typeof args.testId !== 'string') throw new Error('testId must be a string');
              if (typeof args.status !== 'string') throw new Error('status must be a string');
              toolResult = await overrideTrialTest(args.testId, args.status, args.notes, caller.id, performerIp);
            } else if (name === 'listUserApiKeys') {
              if (typeof args.userId !== 'string') throw new Error('userId must be a string');
              toolResult = await listUserApiKeys(args.userId);
            } else if (name === 'revokeApiKey') {
              if (typeof args.keyId !== 'string') throw new Error('keyId must be a string');
              toolResult = await revokeApiKey(args.keyId, caller.id, performerIp);
"""

target_handles_end = "} else if (name === 'getSystemStatus') {"
content = content.replace(target_handles_end, handles_str + target_handles_end, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patching complete.")
