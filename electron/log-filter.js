'use strict';

const VERBOSE = process.env.MILFUN_VERBOSE === '1' || process.env.MILFUN_VERBOSE === 'true';

/** UI 不展示的 info 日志（逐条资源/混淆细节） */
const SUPPRESS_INFO = [
  /^Processing: /,
  /^Processing import-only: /,
  /^Migrated JSON: /,
  /^Migrated companion native: /,
  /^Skipping non-UUID file: /,
  /^No JSON files found for UUID: /,
  /^No companion native for UUID: /,
  /^  ↳ image /,
  /^Image done \(/,
  /^Image size /,
  /^Audio compressed: /,
  /^Audio copied /,
  /^Fallback copy: /,
  /^Removed empty directory: /,
  /^Skip obfuscation /,
  /^Obfuscated /,
  /^  still obfuscating /,
  /^Skip entryui: /,
  /^Skip \w+: missing native$/,
  /^\[Replace\].*file\(s\),.*cmds/,
  /^\[Obfuscator\] worker pool size=/,
  /^Skip obfuscation \(whitelist\)/,
  /^Skip obfuscation \(too small\)/,
];

function shouldForwardLogToUI(level, message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (VERBOSE) return true;
  if (level === 'error') return true;
  if (level === 'warn') return !/^Fallback copy:/.test(text);
  if (level !== 'info') return true;
  return !SUPPRESS_INFO.some((re) => re.test(text));
}

module.exports = { shouldForwardLogToUI };
