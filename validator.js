const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const getDeviceFingerprint = require('./collect');

class LicenseValidator {
  constructor(publicKeyPath = 'public.key') {
    this.publicKey = null;
    
    if (fs.existsSync(publicKeyPath)) {
      this.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
    }
  }

  // 设置公钥
  setPublicKey(publicKey) {
    this.publicKey = publicKey;
  }

  // 验证许可证
  validateLicense(license, deviceFingerprint = null) {
    if (!this.publicKey) {
      throw new Error('未设置公钥，无法验证许可证');
    }

    // 验证签名
    const licenseDataStr = JSON.stringify(license.data);
    if (!this.verifySignature(licenseDataStr, license.signature, this.publicKey)) {
      return {
        valid: false,
        reason: '许可证签名无效'
      };
    }

    const licenseData = license.data;
    const now = new Date();

    // 检查是否过期
    if (new Date(licenseData.expiryDate) < now) {
      return {
        valid: false,
        reason: '许可证已过期',
        expiryDate: licenseData.expiryDate
      };
    }

    // 如果提供了设备指纹，检查是否匹配
    if (deviceFingerprint && licenseData.deviceFingerprint !== deviceFingerprint) {
      return {
        valid: false,
        reason: '设备不匹配',
        expected: licenseData.deviceFingerprint,
        actual: deviceFingerprint
      };
    }

    return {
      valid: true,
      expiryDate: licenseData.expiryDate,
      features: licenseData.features
    };
  }

  // 验证签名
  verifySignature(data, signature, publicKey) {
    const verify = crypto.createVerify('SHA256');
    verify.update(data);
    verify.end();
    return verify.verify(publicKey, signature, 'base64');
  }

  // 从文件加载并验证许可证
  validateLicenseFile(licensePath, deviceFingerprint = null) {
    if (!fs.existsSync(licensePath)) {
      return {
        valid: false,
        reason: '许可证文件不存在'
      };
    }

    try {
      const license = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
      return this.validateLicense(license, deviceFingerprint);
    } catch (error) {
      return {
        valid: false,
        reason: `许可证文件格式错误: ${error.message}`
      };
    }
  }

  // 完整的验证流程
  fullValidation(licensePath, publicKeyPath = 'public.key') {
    // 加载公钥
    if (fs.existsSync(publicKeyPath)) {
      this.setPublicKey(fs.readFileSync(publicKeyPath, 'utf8'));
    } else {
      return {
        valid: false,
        reason: '公钥文件不存在'
      };
    }

    // 收集设备信息并生成指纹
    return getDeviceFingerprint().then(fingerprint => {
      return this.validateLicenseFile(licensePath, fingerprint);
    })
  }
}

// 使用示例
if (require.main === module) {
  const validator = new LicenseValidator();
  
  // 从命令行参数获取许可证路径
  const licensePath = process.argv[2] || 'license.lic';
  
  const result = validator.fullValidation(licensePath);
  
  if (result.valid) {
    console.log('✅ 许可证验证成功!');
    console.log('有效期至:', result.expiryDate);
    console.log('可用功能:', JSON.stringify(result.features, null, 2));
  } else {
    console.error('❌ 许可证验证失败:', result.reason);
    process.exit(1);
  }
}

module.exports = LicenseValidator;