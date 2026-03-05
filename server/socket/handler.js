export const registerSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    socket.on('join_race', ({ raceId } = {}) => {
      if (!raceId) {
        return;
      }
      socket.join(`race:${raceId}`);
    });

    socket.on('leave_race', ({ raceId } = {}) => {
      if (!raceId) {
        return;
      }
      socket.leave(`race:${raceId}`);
    });
  });
};

export const emitRaceEvent = (io, raceId, eventName, payload) => {
  io.to(`race:${raceId}`).emit(eventName, payload);
};
