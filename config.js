// config.js - 配置文件
const path = require('path');

// 总开关    true 开 ， false  关
const CAN_OBFUSCATION = true;   // JS 混淆开关
const CAN_IMAGE_SWITCH = true;  // 图片无损重哈希（改变文件 hash，视觉不变）
const CAN_AUDIO_SWITCH = true;  // 音频处理开关

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
  // 兼容旧 TOTAL
  TOTAL: ['.png', '.jpeg', '.jpg', '.mp3', '.wav', '.aac', '.ogg', '.m4a', '.atlas', '.plist', '.bin'],
};

module.exports = {
  DIR_CONFIG,
  FILE_EXTENSIONS,
  OBFUSCATION_CONFIG,
  OBFUSCATION_PRESETS,
  OBFUSCATION_PREFER_RATIO,
  OBFUSCATION_MAX_RATIO,
  CAN_OBFUSCATION,
  WHITELIST_CONFIG,
  CAN_IMAGE_SWITCH,
  CAN_AUDIO_SWITCH,
};
