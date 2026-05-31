'use strict';

const crypto = require('crypto');
const os = require('os');
const fs = require('fs-extra');
const path = require('path');

const SI_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

class LicenseValidator {
  constructor(publicKeyPath = 'public.key') {
    this.publicKey = fs.existsSync(publicKeyPath)
      ? fs.readFileSync(publicKeyPath, 'utf8')
      : null;
  }

  setPublicKey(publicKey) {
    this.publicKey = publicKey;
  }

  validateLicense(license, deviceFingerprint = null) {
    if (!this.publicKey) {
      throw new Error('未设置公钥，无法验证许可证');
    }

    const licenseDataStr = JSON.stringify(license.data);
    if (!this.verifySignature(licenseDataStr, license.signature, this.publicKey)) {
      return { valid: false, reason: '许可证签名无效' };
    }

    const licenseData = license.data;
    if (new Date(licenseData.expiryDate) < new Date()) {
      return { valid: false, reason: '许可证已过期', expiryDate: licenseData.expiryDate };
    }

    if (deviceFingerprint && licenseData.deviceFingerprint !== deviceFingerprint) {
      return {
        valid: false,
        reason: '设备不匹配',
        expected: licenseData.deviceFingerprint,
        actual: deviceFingerprint,
      };
    }

    return { valid: true, expiryDate: licenseData.expiryDate, features: licenseData.features };
  }

  verifySignature(data, signature, publicKey) {
    const verify = crypto.createVerify('SHA256');
    verify.update(data);
    verify.end();
    return verify.verify(publicKey, signature, 'base64');
  }

  validateLicenseFile(licensePath, deviceFingerprint = null) {
    if (!fs.existsSync(licensePath)) {
      return { valid: false, reason: '许可证文件不存在' };
    }
    try {
      const license = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
      return this.validateLicense(license, deviceFingerprint);
    } catch (error) {
      return { valid: false, reason: `许可证文件格式错误: ${error.message}` };
    }
  }

  async fullValidation(licensePath, publicKeyPath = 'public.key') {
    if (!fs.existsSync(publicKeyPath)) {
      return { valid: false, reason: '公钥文件不存在' };
    }
    this.setPublicKey(fs.readFileSync(publicKeyPath, 'utf8'));
    const fingerprint = await getDeviceFingerprint();
    return this.validateLicenseFile(licensePath, fingerprint);
  }
}

function getLicenseStorageDir() {
  if (process.env.MILFUN_LICENSE_DIR) return process.env.MILFUN_LICENSE_DIR;
  return path.join(os.homedir(), 'Documents', 'MilFun');
}

function resolvePublicKeyPath(appRoot) {
  const resourcesRoot = process.env.MILFUN_APP_ROOT;
  const candidates = [
    process.env.MILFUN_PUBLIC_KEY_PATH,
    resourcesRoot ? path.join(resourcesRoot, 'public.key') : null,
    process.env.MILFUN_EXE_DIR ? path.join(process.env.MILFUN_EXE_DIR, 'public.key') : null,
    appRoot ? path.join(appRoot, 'public.key') : null,
    path.join(__dirname, 'public.key'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0] || path.join(resourcesRoot || appRoot || '.', 'public.key');
}

function resolveLicensePath(appRoot) {
  const storageDir = getLicenseStorageDir();
  const besideExe = process.env.MILFUN_EXE_DIR
    ? path.join(process.env.MILFUN_EXE_DIR, 'license.lic')
    : null;
  const candidates = [
    process.env.MILFUN_LICENSE_PATH,
    besideExe,
    path.join(storageDir, 'license.lic'),
    path.join(appRoot, 'license.lic'),
    path.join(__dirname, 'license.lic'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(storageDir, 'license.lic');
}

async function getDeviceFingerprint() {
  const si = require('systeminformation');
  const interfaces = os.networkInterfaces();
  let macAddress = '';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
        macAddress = iface.mac;
        break;
      }
    }
    if (macAddress) break;
  }

  const [diskData, systemData, cpuData] = await Promise.all([
    withTimeout(si.diskLayout(), SI_TIMEOUT_MS, []),
    withTimeout(si.system(), SI_TIMEOUT_MS, {}),
    withTimeout(si.cpu(), SI_TIMEOUT_MS, {}),
  ]);

  const diskSerial = diskData.length > 0 ? diskData[0].serialNum : '';
  const cpuInfo = {
    manufacturer: cpuData.manufacturer || '',
    brand: cpuData.brand || '',
    cores: cpuData.cores || 0,
  };
  const combined = `${macAddress}|${diskSerial}|${JSON.stringify(cpuInfo)}|${systemData.serial || ''}`;
  return crypto.createHash('sha256').update(combined).digest('hex');
}

async function importLicense(sourceFile, appRoot) {
  if (!fs.existsSync(sourceFile)) {
    throw new Error('许可证文件不存在');
  }
  const targetDir = getLicenseStorageDir();
  await fs.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, 'license.lic');
  await fs.copy(sourceFile, target);
  return target;
}

async function checkLicense(appRoot, options = {}) {
  const publicKeyPath = resolvePublicKeyPath(appRoot);
  const licensePath = resolveLicensePath(appRoot);

  if (!fs.existsSync(publicKeyPath)) {
    return { valid: false, reason: '缺少 public.key', publicKeyPath, licensePath };
  }
  if (!fs.existsSync(licensePath)) {
    return {
      valid: false,
      reason: '缺少 license.lic，请导入许可证或联系服务商',
      publicKeyPath,
      licensePath,
      licenseDir: getLicenseStorageDir(),
    };
  }

  const validator = new LicenseValidator(publicKeyPath);
  validator.setPublicKey(fs.readFileSync(publicKeyPath, 'utf8'));

  if (options.skipDevice) {
    const result = validator.validateLicenseFile(licensePath, null);
    return { ...result, publicKeyPath, licensePath, licenseDir: getLicenseStorageDir() };
  }

  const result = await validator.fullValidation(licensePath, publicKeyPath);
  return { ...result, publicKeyPath, licensePath, licenseDir: getLicenseStorageDir() };
}

module.exports = {
  LicenseValidator,
  getLicenseStorageDir,
  resolveLicensePath,
  resolvePublicKeyPath,
  getDeviceFingerprint,
  importLicense,
  checkLicense,
};
