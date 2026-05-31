'use strict';

function shouldForwardLogToUI(level, message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (level === 'error' || level === 'warn') return true;
  if (/^\[\d+\/6\]/.test(text)) return true;
  if (text.includes('Summary:')) return true;
  if (text.includes('ZIP ready') || text.includes('Well Done')) return true;
  if (text.includes('MilFun') && text.includes('Start')) return true;
  return false;
}

module.exports = { shouldForwardLogToUI };
