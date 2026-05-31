// config.js - 配置文件
const fs = require('fs');
const path = require('path');

// 内置默认值（客户可通过 milfun.config.json 覆盖）
const DEFAULTS = {
  CAN_OBFUSCATION: true,
  CAN_IMAGE_SWITCH: true,
  CAN_AUDIO_SWITCH: true,
};

// 混淆体积上限
const OBFUSCATION_PREFER_RATIO = 1.5;
const OBFUSCATION_MAX_RATIO = 1.8;

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

// 三档混淆 preset（体积优先 → 效果加强 → 保底）
const OBFUSCATION_PRESETS = [
  {
    ...OBFUSCATION_BASE,
    controlFlowFlatteningThreshold: 0.35,
    stringArrayThreshold: 0.55,
    maxRatio: OBFUSCATION_PREFER_RATIO,
    label: 'tier1',
  },
  {
    ...OBFUSCATION_BASE,
    controlFlowFlatteningThreshold: 0.45,
    stringArrayThreshold: 0.65,
    maxRatio: OBFUSCATION_MAX_RATIO,
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

// 兼容旧引用
const OBFUSCATION_CONFIG = OBFUSCATION_BASE;

// 文件扩展名
const FILE_EXTENSIONS = {
  NATIVE: ['.png', '.jpeg', '.jpg', '.mp3', '.wav', '.aac', '.ogg', '.m4a', '.atlas', '.plist', '.bin'],
  IMAGE: ['.png', '.jpeg', '.jpg'],
  AUDIO: ['.mp3', '.wav', '.aac', '.ogg', '.m4a'],
  TEXT: ['.js', '.ts', '.json', '.html', '.css', '.xml', '.txt', '.md'],
  TOTAL: ['.png', '.jpeg', '.jpg', '.mp3', '.wav', '.aac', '.ogg', '.m4a', '.atlas', '.plist', '.bin'],
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

let _featureFlags = null;

function refreshFeatureFlags() {
  const loaded = readUserConfigFile();
  _featureFlags = {
    CAN_OBFUSCATION: pickBool(loaded?.data || {}, 'canObfuscation', 'CAN_OBFUSCATION', DEFAULTS.CAN_OBFUSCATION),
    CAN_IMAGE_SWITCH: pickBool(loaded?.data || {}, 'canImageSwitch', 'CAN_IMAGE_SWITCH', DEFAULTS.CAN_IMAGE_SWITCH),
    CAN_AUDIO_SWITCH: pickBool(loaded?.data || {}, 'canAudioSwitch', 'CAN_AUDIO_SWITCH', DEFAULTS.CAN_AUDIO_SWITCH),
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
  _featureFlags = {
    CAN_OBFUSCATION: pickBool(overrides, 'canObfuscation', 'CAN_OBFUSCATION', DEFAULTS.CAN_OBFUSCATION),
    CAN_IMAGE_SWITCH: pickBool(overrides, 'canImageSwitch', 'CAN_IMAGE_SWITCH', DEFAULTS.CAN_IMAGE_SWITCH),
    CAN_AUDIO_SWITCH: pickBool(overrides, 'canAudioSwitch', 'CAN_AUDIO_SWITCH', DEFAULTS.CAN_AUDIO_SWITCH),
    configPath: getWritableConfigPath(),
  };
  return _featureFlags;
}

function saveFeatureFlags(flags) {
  const data = {
    canObfuscation: pickBool(flags, 'canObfuscation', 'CAN_OBFUSCATION', DEFAULTS.CAN_OBFUSCATION),
    canImageSwitch: pickBool(flags, 'canImageSwitch', 'CAN_IMAGE_SWITCH', DEFAULTS.CAN_IMAGE_SWITCH),
    canAudioSwitch: pickBool(flags, 'canAudioSwitch', 'CAN_AUDIO_SWITCH', DEFAULTS.CAN_AUDIO_SWITCH),
  };
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
    configPath: flags.configPath || getWritableConfigPath(),
  };
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
  // 兼容旧代码直接解构（等于默认值，运行时请用 getFeatureFlags）
  CAN_OBFUSCATION: DEFAULTS.CAN_OBFUSCATION,
  CAN_IMAGE_SWITCH: DEFAULTS.CAN_IMAGE_SWITCH,
  CAN_AUDIO_SWITCH: DEFAULTS.CAN_AUDIO_SWITCH,
};
