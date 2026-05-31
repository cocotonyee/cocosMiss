"use strict";
require("./mm-2");
require('adapter-min.js');
__globalAdapter.init();
require('cocos/cocos2d-js-min.js');
require('physics-min.js');
__globalAdapter.adaptEngine();
require('./ccRequire');
require('./src/settings');
// Introduce Cocos Service here
require('./main'); // TODO: move to common

// Adjust devicePixelRatio
cc.view._maxPixelRatio = 4;
if (cc.sys.platform !== cc.sys.BYTEDANCE_GAME_SUB) {
  // Release Image objects after uploaded gl texture
  cc.macro.CLEANUP_IMAGE_CACHE = true;
}
window.boot();