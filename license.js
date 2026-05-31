const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class LicenseGenerator {
  constructor() {
    this.privateKey = null;
    this.publicKey = null;
    this.keyPath = path.join(__dirname, 'license-keys');
    
    // 确保密钥目录存在
    if (!fs.existsSync(this.keyPath)) {
      fs.mkdirSync(this.keyPath, { recursive: true });
    }
  }

  // 生成RSA密钥对
  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    this.privateKey = privateKey;
    this.publicKey = publicKey;

    // 保存密钥对
    fs.writeFileSync(path.join(this.keyPath, 'private.key'), privateKey);
    fs.writeFileSync(path.join(this.keyPath, 'public.key'), publicKey);

    return { publicKey, privateKey };
  }

  // 加载密钥对
  loadKeyPair() {
    try {
      this.privateKey = fs.readFileSync(path.join(this.keyPath, 'private.key'), 'utf8');
      this.publicKey = fs.readFileSync(path.join(this.keyPath, 'public.key'), 'utf8');
      return { publicKey: this.publicKey, privateKey: this.privateKey };
    } catch (error) {
      console.warn('未找到现有密钥对，将生成新密钥');
      return this.generateKeyPair();
    }
  }

  // 创建许可证
  createLicense(deviceFingerprint, validityDays = 365, features = {}) {
    if (!this.privateKey) {
      this.loadKeyPair();
    }

    const licenseData = {
      deviceFingerprint,
      issueDate: new Date().toISOString(),
      expiryDate: new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString(),
      features: features
    };

    // 对许可证数据进行签名
    const licenseString = JSON.stringify(licenseData);
    const signature = this.signData(licenseString, this.privateKey);
    
    const license = {
      data: licenseData,
      signature: signature
    };

    return license;
  }

  // 数据签名
  signData(data, privateKey) {
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privateKey, 'base64');
  }

  // 验证签名
  verifySignature(data, signature, publicKey) {
    const verify = crypto.createVerify('SHA256');
    verify.update(data);
    verify.end();
    return verify.verify(publicKey, signature, 'base64');
  }

  // 保存许可证到文件
  saveLicense(license, filePath) {
    fs.writeFileSync(filePath, JSON.stringify(license, null, 2));
    return filePath;
  }

  // 从文件加载许可证
  loadLicense(filePath) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return null;
  }

  // 生成并保存许可证
  generateAndSaveLicense(deviceFingerprint, validityDays = 365, features = {}, outputPath = 'license.lic') {
    const license = this.createLicense(deviceFingerprint, validityDays, features);
    return this.saveLicense(license, outputPath);
  }
}

// 使用示例
if (require.main === module) {
  const generator = new LicenseGenerator();
  
  // 确保有密钥对
  generator.loadKeyPair();
  
  // 从命令行参数获取设备指纹和有效期
  const deviceFingerprint = process.argv[2];
  const validityDays = parseInt(process.argv[3]) || 365;
  
  if (!deviceFingerprint) {
    console.error('请提供设备指纹作为参数');
    console.log('用法: node license-generator.js <设备指纹> [有效期天数]');
    process.exit(1);
  }
  
  // 定义许可证特性
  const features = {
    canExport: true,
    maxUsers: 5,
    premiumFeatures: true
  };
  
  // 生成许可证
  const licensePath = generator.generateAndSaveLicense(
    deviceFingerprint, 
    validityDays, 
    features,
    `license-${deviceFingerprint.substring(0, 8)}.lic`
  );
  
  console.log('许可证已生成并保存到:', licensePath);
  console.log('请将此许可证文件发送给用户，并确保用户也有 public.key 文件');
}

module.exports = LicenseGenerator;