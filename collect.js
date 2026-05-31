const si = require('systeminformation');
const crypto = require('crypto');
const os = require('os');

async function getDeviceFingerprint() {
  try {
    // 获取网络接口的MAC地址（选择第一个非内部的）
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

    // 获取磁盘信息（系统磁盘的序列号）
    const diskData = await si.diskLayout();
    const diskSerial = diskData.length > 0 ? diskData[0].serialNum : '';

    // 主板信息
    const systemData = await si.system();
    const systemSerial = systemData.serial;

    // 获取CPU信息
    const cpuData = await si.cpu();
    const cpuInfo = {
      manufacturer: cpuData.manufacturer,
      brand: cpuData.brand,
      cores: cpuData.cores
    };

    
    console.log('\ndiskSerial:', diskSerial);
    console.log('\ncpuInfo:', cpuInfo);
    console.log('\nmacAddress:', macAddress);
    console.log('\nsystemSerial:', systemSerial);

    // 组合这些信息
    const combined = `${macAddress}|${diskSerial}|${JSON.stringify(cpuInfo)}|${systemSerial}`;

    // 生成SHA256哈希
    const fingerprint = crypto.createHash('sha256').update(combined).digest('hex');
    return fingerprint;
  } catch (error) {
    console.error('获取设备信息失败:', error);
    throw error;
  }
}

// 使用示例
if (require.main === module) {
  // 使用示例
  getDeviceFingerprint().then(fingerprint => {
    console.log('Secret Key:', fingerprint);
  });   
}


module.exports = getDeviceFingerprint;