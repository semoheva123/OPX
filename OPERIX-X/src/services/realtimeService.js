const clients = new Map();
let nextClientId = 1;

function addClient({ response, userId, scope, role }) {
  const client = { id: nextClientId++, response, userId: String(userId), scope, role };
  clients.set(client.id, client);
  response.on('close', () => clients.delete(client.id));
  return client;
}

function removeClient(client) {
  if (client) clients.delete(client.id);
}

function send(client, event, data) {
  if (client.response.writableEnded) return false;
  try {
    client.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (error) {
    removeClient(client);
    return false;
  }
}

function emit(event, data = {}, audience = {}) {
  for (const client of clients.values()) {
    const matchesUser = audience.userId && client.userId === String(audience.userId);
    const matchesScope = audience.scope && client.scope === audience.scope;
    const matchesRole = audience.role && client.role === audience.role;
    if (!audience.userId && !audience.scope && !audience.role || matchesUser || matchesScope || matchesRole) send(client, event, data);
  }
}

function heartbeat() {
  for (const client of clients.values()) send(client, 'heartbeat', { timestamp: new Date().toISOString() });
}

setInterval(heartbeat, 25000).unref();

module.exports = { addClient, removeClient, emit };
