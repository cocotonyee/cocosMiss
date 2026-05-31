'use strict';

function shouldForwardLogToUI(_level, message) {
  return String(message || '').trim().length > 0;
}

module.exports = { shouldForwardLogToUI };
