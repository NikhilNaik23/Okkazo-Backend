let io = null;

const setIO = (serverIO) => {
  io = serverIO;
};

const emitToConversation = (conversationId, event, payload) => {
  if (!io) return;
  io.to(String(conversationId)).emit(event, payload);
};

module.exports = { setIO, emitToConversation };
