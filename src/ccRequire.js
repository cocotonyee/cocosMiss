let moduleMap = {
'assets/internal/index.js' () { return require('assets/internal/index.js') },
'assets/audio/index.js' () { return require('assets/audio/index.js') },
'assets/common/index.js' () { return require('assets/common/index.js') },
'assets/excel/index.js' () { return require('assets/excel/index.js') },
'assets/game/index.js' () { return require('assets/game/index.js') },
'assets/home/index.js' () { return require('assets/home/index.js') },
'assets/resources/index.js' () { return require('assets/resources/index.js') },
'assets/main/index.js' () { return require('assets/main/index.js') },
// tail
};

window.__cocos_require__ = function (moduleName) {
    let func = moduleMap[moduleName];
    if (!func) {
        throw new Error(`cannot find module ${moduleName}`);
    }
    return func();
};