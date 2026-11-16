/**
 * Point d'émission temps réel, indépendant de socket.io : les services y publient sans connaître le serveur
 * de sockets (et fonctionnent sans lui, par exemple pendant les tests).
 *   toUser(userId, nom, données)              → tous les onglets d'un utilisateur (salon « user:<id> »)
 *   toConversation(publicId, nom, données)    → les participants d'une conversation ouverte (salon « conv:<id> »)
 */
let io = null;

export function attach(server) {
  io = server;
}

export function toUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

export function toConversation(publicId, event, payload) {
  if (io) io.to(`conv:${publicId}`).emit(event, payload);
}

/** L'utilisateur a-t-il au moins un onglet connecté ? (présence « En ligne ») */
export async function isOnline(userId) {
  if (!io) return false;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.length > 0;
}
