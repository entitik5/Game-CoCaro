const Room = require("./Room");

class RoomManager {
  constructor() {
    this.rooms = {};
    this.roomCount = 1;
    this.socketToRoom = {};
    this.playerToRoom = {};
    this.stats = {};
    this._cleanupInterval = setInterval(() => this.cleanup(), 30000);
  }

  cleanup() {
    const now = Date.now();
    for (const id in this.rooms) {
      const room = this.rooms[id];
      if (room.started && !room.gameOver) continue;
      const hasReconnecting = room.players.some(p => !p.connected && p.disconnectTimer);
      if (hasReconnecting) continue;
      if (room.players.length === 0 || now - room.lastActive > 120000) {
        for (const p of room.players) delete this.playerToRoom[p.playerId];
        room.destroy();
        delete this.rooms[id];
        console.log("Cleaned room:", id);
      }
    }
  }

  destroy() { clearInterval(this._cleanupInterval); }

  createRoom({ boardSize, winCount, winDirections, maxPlayers, timePerTurn }) {
    const id = "room_" + this.roomCount++;
    const room = new Room(id, { boardSize, winCount, winDirections, maxPlayers, timePerTurn }, this);
    this.rooms[id] = room;
    return room;
  }

  getRoom(id) { return this.rooms[id]; }

  getRoomBySocket(socket) {
    const roomId = this.socketToRoom[socket.id];
    if (!roomId) return null;
    return this.rooms[roomId] || null;
  }

  addPlayerToRoom(socket, room) {
    this.socketToRoom[socket.id] = room.id;
    this.playerToRoom[socket.playerId] = room.id;
    socket.roomId = room.id;
  }

  removePlayer(socket) {
    const roomId = this.socketToRoom[socket.id];
    delete this.socketToRoom[socket.id];
    delete socket.roomId;
    if (!roomId) return;
    const room = this.rooms[roomId];
    if (!room) return;
    room.removePlayer(socket);
    if (room.players.length === 0) {
      room.destroy();
      delete this.rooms[roomId];
      console.log("Deleted empty room:", roomId);
    }
  }

  removePlayerCompletely(playerId) { delete this.playerToRoom[playerId]; }

  getStats(playerId) {
    if (!this.stats[playerId]) this.stats[playerId] = { win: 0, lose: 0, draw: 0 };
    return this.stats[playerId];
  }

  updateStats(playerId, type) {
    if (!["win", "lose", "draw"].includes(type)) return;
    this.getStats(playerId)[type]++;
  }

  getPublicRooms() {
    return Object.values(this.rooms)
      .filter(r => !r.started)
      .map(r => ({
        id: r.id,
        boardSize: r.boardSize,
        winCount: r.winCount,
        winDirections: r.winDirections,
        maxPlayers: r.maxPlayers,
        timePerTurn: r.timePerTurn,
        currentPlayers: r.players.length,
        players: r.getPlayersInfo(),
      }));
  }
}

module.exports = RoomManager;