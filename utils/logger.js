'use strict';

function createLogger(options) {
  const settings = Object.assign({ level: 'info' }, options);
  const levels = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
  };

  function shouldLog(level) {
    return levels[level] >= levels[settings.level];
  }

  function format(level, message) {
    return `[ai-context] ${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  }

  return {
    debug(message) {
      if (shouldLog('debug')) {
        console.debug(format('debug', message));
      }
    },
    info(message) {
      if (shouldLog('info')) {
        console.log(format('info', message));
      }
    },
    warn(message) {
      if (shouldLog('warn')) {
        console.warn(format('warn', message));
      }
    },
    error(message) {
      if (shouldLog('error')) {
        console.error(format('error', message));
      }
    }
  };
}

module.exports = {
  createLogger
};
