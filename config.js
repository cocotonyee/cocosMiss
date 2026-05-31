// config.js - 配置文件
const fs = require('fs');
const path = require('path');

// 内置默认值（客户可通过 milfun.config.json 覆盖）
const OBFUSCATION_TIER_GAP = 0.3;

const DEFAULTS = {
  CAN_OBFUSCATION: true,
  CAN_IMAGE_SWITCH: true,
  CAN_AUDIO_SWITCH: true,
  OBFUSCATION_PREFER_RATIO: 1.5,
  OBFUSCATION_MAX_RATIO: 1.8,
  OBFUSCATION_TIER_GAP,
  IMAGE_COLOR_INTENSITY: 5,
};

// 内置默认（兼容旧导出）
const OBFUSCATION_PREFER_RATIO = DEFAULTS.OBFUSCATION_PREFER_RATIO;
const OBFUSCATION_MAX_RATIO = DEFAULTS.OBFUSCATION_MAX_RATIO;

// 目录配置
const DIR_CONFIG = {
  SOURCE_DIR: path.join(__dirname, 'src'),
  PROCESSED_DIR: path.join(__dirname, 'src_processed'),
  SUBPACKAGE_DIR: 'subpackages',
  ASSETS_DIR: 'assets',
};

// 白名单 - 不混淆的 JavaScript 文件
const WHITELIST_CONFIG = [
  'engine',
  'adapter',
  'physics',
  '@babel',
  'cocos',
  'cocos-js',
  'bundle',
  'polyfills.bundle',
  'system.bundle',
  'web-adapter',
];

// 混淆基础配置
const OBFUSCATION_BASE = {
  compact: true,
  controlFlowFlattening: true,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayEncoding: [],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: 'variable',
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  ccSignalString: 'paloma',
};

// 三档混淆 preset 模板（maxRatio 运行时由 getObfuscationPresets 注入）
function buildObfuscationPresets(preferRatio, maxRatio) {
  return [
    {
      ...OBFUSCATION_BASE,
      controlFlowFlatteningThreshold: 0.35,
      stringArrayThreshold: 0.55,
      maxRatio: preferRatio,
      label: 'tier1',
    },
    {
      ...OBFUSCATION_BASE,
      controlFlowFlatteningThreshold: 0.45,
      stringArrayThreshold: 0.65,
      maxRatio: maxRatio,
      label: 'tier2',
    },
    {
      ...OBFUSCATION_BASE,
      controlFlowFlatteningThreshold: 0.2,
      stringArrayThreshold: 0.4,
      maxRatio: Infinity,
      label: 'tier3',
    },
  ];
}

function buildLightObfuscationPreset(maxRatio = Infinity) {
  return {
    ...OBFUSCATION_BASE,
    controlFlowFlattening: false,
    stringArrayThreshold: 0.4,
    maxRatio,
    label: 'large-light',
  };
}

const OBFUSCATION_LARGE_FILE_BYTES = 1024 * 1024;
const OBFUSCATION_HUGE_FILE_BYTES = 2 * 1024 * 1024;

// 兼容旧引用
const OBFUSCATION_PRESETS = buildObfuscationPresets(OBFUSCATION_PREFER_RATIO, OBFUSCATION_MAX_RATIO);

// 兼容旧引用
const OBFUSCATION_CONFIG = OBFUSCATION_BASE;

// 文件扩展名
const FILE_EXTENSIONS = {
  NATIVE: ['.png', '.jpeg', '.jpg', '.mp3', '.wav', '.aac', '.ogg', '.m4a', '.atlas', '.plist', '.bin', '.ttf', '.font'],
  IMAGE: ['.png', '.jpeg', '.jpg'],
  AUDIO: ['.mp3', '.wav', '.aac', '.ogg', '.m4a'],
  TEXT: ['.js', '.ts', '.json', '.html', '.css', '.xml', '.txt', '.md', '.atlas', '.plist', '.map'],
  TOTAL: ['.png', '.jpeg', '.jpg', '.mp3', '.wav', '.aac', '.ogg', '.m4a', '.atlas', '.plist', '.bin', '.ttf', '.font'],
};

const USER_CONFIG_NAME = 'milfun.config.json';

function resolveUserConfigPaths() {
  return [
    process.env.MILFUN_USER_CONFIG,
    process.env.MILFUN_EXE_DIR ? path.join(process.env.MILFUN_EXE_DIR, USER_CONFIG_NAME) : null,
    process.env.MILFUN_WORKSPACE ? path.join(process.env.MILFUN_WORKSPACE, USER_CONFIG_NAME) : null,
    path.join(process.cwd(), USER_CONFIG_NAME),
  ].filter(Boolean);
}

function getWritableConfigPath() {
  if (process.env.MILFUN_WORKSPACE) return path.join(process.env.MILFUN_WORKSPACE, USER_CONFIG_NAME);
  if (process.env.MILFUN_EXE_DIR) return path.join(process.env.MILFUN_EXE_DIR, USER_CONFIG_NAME);
  return path.join(process.cwd(), USER_CONFIG_NAME);
}

function readUserConfigFile() {
  for (const configPath of resolveUserConfigPaths()) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      return { configPath, data: JSON.parse(raw) };
    } catch (err) {
      console.warn(`[Config] ${configPath} 无效: ${err.message}`);
    }
  }
  return null;
}

function pickBool(data, camelKey, upperKey, fallback) {
  if (data[camelKey] !== undefined) return Boolean(data[camelKey]);
  if (data[upperKey] !== undefined) return Boolean(data[upperKey]);
  return fallback;
}

function pickInt(data, camelKey, upperKey, fallback, min, max) {
  const raw = data[camelKey] ?? data[upperKey];
  let n = Math.round(Number(raw));
  if (!Number.isFinite(n)) n = fallback;
  return Math.min(max, Math.max(min, n));
}

function buildImageColorRanges(intensity) {
  const level = pickInt({ v: intensity }, 'v', 'v', DEFAULTS.IMAGE_COLOR_INTENSITY, 1, 10);
  const factor = level / 5;
  return {
    intensity: level,
    hueMax: Math.max(1, Math.round(12 * factor)),
    brightPct: Math.max(1, Math.round(8 * factor)),
    satPct: Math.max(1, Math.round(14 * factor)),
  };
}

function pickRatio(data, camelKey, upperKey, fallback) {
  const raw = data[camelKey] ?? data[upperKey];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 5);
}

function deriveTierRatios(maxRatio) {
  const max = pickRatio({ v: maxRatio }, 'v', 'v', DEFAULTS.OBFUSCATION_MAX_RATIO);
  const prefer = Math.max(1, Math.round((max - DEFAULTS.OBFUSCATION_TIER_GAP) * 10) / 10);
  return { preferRatio: Math.min(prefer, max), maxRatio: max };
}

function normalizeRatios(prefer, max) {
  const maxRatio = pickRatio({ v: max }, 'v', 'v', DEFAULTS.OBFUSCATION_MAX_RATIO);
  if (prefer === undefined || prefer === null || prefer === '') {
    return deriveTierRatios(maxRatio);
  }
  let preferRatio = Number(prefer);
  let normalizedMax = Number(maxRatio);
  if (!Number.isFinite(preferRatio) || preferRatio < 1) preferRatio = DEFAULTS.OBFUSCATION_PREFER_RATIO;
  if (!Number.isFinite(normalizedMax) || normalizedMax < 1) normalizedMax = DEFAULTS.OBFUSCATION_MAX_RATIO;
  preferRatio = Math.min(preferRatio, 5);
  normalizedMax = Math.min(normalizedMax, 5);
  if (normalizedMax < preferRatio) normalizedMax = preferRatio;
  return { preferRatio, maxRatio: normalizedMax };
}

function readConfigDataOrEmpty() {
  const loaded = readUserConfigFile();
  return loaded?.data && typeof loaded.data === 'object' ? { ...loaded.data } : {};
}

let _featureFlags = null;

function refreshFeatureFlags() {
  const loaded = readUserConfigFile();
  const data = loaded?.data || {};
  const { preferRatio, maxRatio } = normalizeRatios(
    pickRatio(data, 'obfuscationPreferRatio', 'OBFUSCATION_PREFER_RATIO', DEFAULTS.OBFUSCATION_PREFER_RATIO),
    pickRatio(data, 'obfuscationMaxRatio', 'OBFUSCATION_MAX_RATIO', DEFAULTS.OBFUSCATION_MAX_RATIO),
  );
  _featureFlags = {
    CAN_OBFUSCATION: pickBool(data, 'canObfuscation', 'CAN_OBFUSCATION', DEFAULTS.CAN_OBFUSCATION),
    CAN_IMAGE_SWITCH: pickBool(data, 'canImageSwitch', 'CAN_IMAGE_SWITCH', DEFAULTS.CAN_IMAGE_SWITCH),
    CAN_AUDIO_SWITCH: pickBool(data, 'canAudioSwitch', 'CAN_AUDIO_SWITCH', DEFAULTS.CAN_AUDIO_SWITCH),
    IMAGE_COLOR_INTENSITY: pickInt(
      data,
      'imageColorIntensity',
      'IMAGE_COLOR_INTENSITY',
      DEFAULTS.IMAGE_COLOR_INTENSITY,
      1,
      10,
    ),
    OBFUSCATION_PREFER_RATIO: preferRatio,
    OBFUSCATION_MAX_RATIO: maxRatio,
    configPath: loaded?.configPath || null,
  };
  return _featureFlags;
}

function getFeatureFlags() {
  if (!_featureFlags) refreshFeatureFlags();
  return _featureFlags;
}

function applyFeatureFlags(overrides) {
  if (!overrides) return refreshFeatureFlags();
  const { preferRatio, maxRatio } = normalizeRatios(
    overrides.obfuscationPreferRatio ?? overrides.OBFUSCATION_PREFER_RATIO,
    overrides.obfuscationMaxRatio ?? overrides.OBFUSCATION_MAX_RATIO,
  );
  _featureFlags = {
    CAN_OBFUSCATION: pickBool(overrides, 'canObfuscation', 'CAN_OBFUSCATION', DEFAULTS.CAN_OBFUSCATION),
    CAN_IMAGE_SWITCH: pickBool(overrides, 'canImageSwitch', 'CAN_IMAGE_SWITCH', DEFAULTS.CAN_IMAGE_SWITCH),
    CAN_AUDIO_SWITCH: pickBool(overrides, 'canAudioSwitch', 'CAN_AUDIO_SWITCH', DEFAULTS.CAN_AUDIO_SWITCH),
    IMAGE_COLOR_INTENSITY: pickInt(
      overrides,
      'imageColorIntensity',
      'IMAGE_COLOR_INTENSITY',
      DEFAULTS.IMAGE_COLOR_INTENSITY,
      1,
      10,
    ),
    OBFUSCATION_PREFER_RATIO: preferRatio,
    OBFUSCATION_MAX_RATIO: maxRatio,
    configPath: getWritableConfigPath(),
  };
  return _featureFlags;
}

function saveFeatureFlags(flags) {
  const maxInput = flags.obfuscationMaxRatio ?? flags.OBFUSCATION_MAX_RATIO;
  const preferInput = flags.obfuscationPreferRatio ?? flags.OBFUSCATION_PREFER_RATIO;
  const { preferRatio, maxRatio } = preferInput === undefined || preferInput === null
    ? deriveTierRatios(maxInput)
    : normalizeRatios(preferInput, maxInput);
  const data = readConfigDataOrEmpty();
  data.canObfuscation = pickBool(flags, 'canObfuscation', 'CAN_OBFUSCATION', DEFAULTS.CAN_OBFUSCATION);
  data.canImageSwitch = pickBool(flags, 'canImageSwitch', 'CAN_IMAGE_SWITCH', DEFAULTS.CAN_IMAGE_SWITCH);
  data.canAudioSwitch = pickBool(flags, 'canAudioSwitch', 'CAN_AUDIO_SWITCH', DEFAULTS.CAN_AUDIO_SWITCH);
  data.imageColorIntensity = pickInt(
    flags,
    'imageColorIntensity',
    'IMAGE_COLOR_INTENSITY',
    DEFAULTS.IMAGE_COLOR_INTENSITY,
    1,
    10,
  );
  data.obfuscationPreferRatio = preferRatio;
  data.obfuscationMaxRatio = maxRatio;
  const configPath = getWritableConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return refreshFeatureFlags();
}

function getFeatureConfigForUi() {
  const flags = refreshFeatureFlags();
  return {
    canObfuscation: flags.CAN_OBFUSCATION,
    canImageSwitch: flags.CAN_IMAGE_SWITCH,
    canAudioSwitch: flags.CAN_AUDIO_SWITCH,
    imageColorIntensity: flags.IMAGE_COLOR_INTENSITY,
    imageColorRanges: buildImageColorRanges(flags.IMAGE_COLOR_INTENSITY),
    obfuscationMaxRatio: flags.OBFUSCATION_MAX_RATIO,
    obfuscationPreferRatio: flags.OBFUSCATION_PREFER_RATIO,
    obfuscationTierGap: DEFAULTS.OBFUSCATION_TIER_GAP,
    configPath: flags.configPath || getWritableConfigPath(),
  };
}

function getObfuscationPresets() {
  const flags = getFeatureFlags();
  return buildObfuscationPresets(flags.OBFUSCATION_PREFER_RATIO, flags.OBFUSCATION_MAX_RATIO);
}

refreshFeatureFlags();

module.exports = {
  DIR_CONFIG,
  FILE_EXTENSIONS,
  OBFUSCATION_CONFIG,
  OBFUSCATION_PRESETS,
  OBFUSCATION_PREFER_RATIO,
  OBFUSCATION_MAX_RATIO,
  WHITELIST_CONFIG,
  DEFAULTS,
  USER_CONFIG_NAME,
  getFeatureFlags,
  refreshFeatureFlags,
  applyFeatureFlags,
  saveFeatureFlags,
  getFeatureConfigForUi,
  getWritableConfigPath,
  getObfuscationPresets,
  buildObfuscationPresets,
  buildLightObfuscationPreset,
  buildImageColorRanges,
  deriveTierRatios,
  OBFUSCATION_TIER_GAP: DEFAULTS.OBFUSCATION_TIER_GAP,
  OBFUSCATION_LARGE_FILE_BYTES,
  OBFUSCATION_HUGE_FILE_BYTES,
  // 兼容旧代码直接解构（等于默认值，运行时请用 getFeatureFlags）
  CAN_OBFUSCATION: DEFAULTS.CAN_OBFUSCATION,
  CAN_IMAGE_SWITCH: DEFAULTS.CAN_IMAGE_SWITCH,
  CAN_AUDIO_SWITCH: DEFAULTS.CAN_AUDIO_SWITCH,
};
