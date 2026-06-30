import { io } from 'socket.io-client'
import { API_BASE, setSocketId } from './api.js'

// One shared Socket.IO connection for the whole app. It authenticates with the
// same session cookie the REST API uses (withCredentials), so no token plumbing
// is needed — the backend reads socket.request.session on the handshake.
//
// Empty API_BASE means same-origin (prod behind nginx); io('') connects to the
// page origin. In dev API_BASE points at the API host, so we connect there.
export const socket = io(API_BASE || undefined, {
  withCredentials: true,
  autoConnect: true,
})

// Keep api.js in sync with the live socket id so it can stamp REST requests for
// echo-suppression. Cleared on disconnect so a stale id never rides a request.
socket.on('connect', () => setSocketId(socket.id))
socket.on('disconnect', () => setSocketId(null))

// Join/leave a board's room. The board view calls these as the user enters and
// leaves a board, so events only flow for the board currently on screen.
export function joinBoard(boardId) {
  if (boardId == null) return
  const emit = () => socket.emit('board:join', boardId)
  // If we connect (or reconnect) later, re-join automatically.
  socket.on('connect', emit)
  if (socket.connected) emit()
  return () => socket.off('connect', emit)
}

export function leaveBoard(boardId) {
  if (boardId == null) return
  if (socket.connected) socket.emit('board:leave', boardId)
}
