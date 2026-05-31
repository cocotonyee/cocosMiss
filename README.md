# MilFun — Cocos 小游戏后处理工具

图形界面 + 命令行，处理 Cocos 构建产物并输出 ZIP。

## 开发调试

```bash
npm install
npm run electron:dev    # 图形界面（明文 app.js）
npm start               # 命令行模式
```

开发模式下，首次打开 Electron 若缺少 `node_modules` 会自动执行 `npm install`。

---

## 发布安装包（字节码保护）

```bash
npm install
npm run build:release        # macOS → dist/MilFun-x.x.x.dmg
npm run build:release:win    # Windows → dist/MilFun Setup x.x.x.exe
```

**流程：** 强混淆 `app.js` → Electron 字节码 `app.jsc` → 打安装包

| 安装包内含 | 不含 |
|-----------|------|
| `app.jsc` + `loader-core.js` + `public.key` | 明文 `app.js`、`license.js`、私钥 |

> Windows 安装包请在 **Windows 环境**打包（字节码不能跨平台）。Mac 包在 Mac 上打。

---

## 商业模式

| 你（服务商） | 客户 |
|-------------|------|
| 打包 **一次** 通用安装包 | 安装同一个软件 |
| `node license.js <指纹> 365` | 发来设备指纹 |
| 只发 **license.lic** | ⚙ → 导入许可证 |

---

## 客户使用流程

1. 安装 `MilFun Setup.exe` / `.dmg`
2. ⚙ → **复制设备指纹** → 发给你
3. 收到 `license.lic` → ⚙ → **导入许可证**
4. 选择 Cocos 构建产物目录 → **开始处理**
5. ZIP 与处理结果输出在**程序工作目录**（开发时为项目根，安装后为 exe 旁或应用数据目录）

---

## 配置（config.js）

| 开关 | 说明 |
|------|------|
| `CAN_OBFUSCATION` | 游戏 JS 混淆 |
| `CAN_IMAGE_SWITCH` | 图片无损重哈希 |
| `CAN_AUDIO_SWITCH` | 音频压缩（需 FFmpeg） |
