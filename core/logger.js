'use strict';

// Logger don gian: in ra console + phat event de UI (Electron) lang nghe.
const { EventEmitter } = require('events');

const emitter = new EventEmitter();

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emit(level, scope, msg) {
  const line = `[${ts()}] [${level}] [${scope}] ${msg}`;
  // eslint-disable-next-line no-console
  console.log(line);
  emitter.emit('log', { level, scope, msg, line, time: Date.now() });
}

function makeLogger(scope) {
  return {
    info: (m) => emit('INFO', scope, m),
    warn: (m) => emit('WARN', scope, m),
    error: (m) => emit('ERROR', scope, m),
  };
}

module.exports = { makeLogger, logEmitter: emitter };
