
const net = require('net');
const dns = require('dns');

const targets = [
  { host: '8.8.8.8', port: 53 },
  { host: 'google.com', port: 80 },
  { host: 'smtp.post.cz', port: 587 },
  { host: 'smtp.post.cz', port: 465 },
  { host: 'smtp.seznam.cz', port: 587 },
  { host: 'smtp.seznam.cz', port: 465 }
];

async function checkDns(host) {
  return new Promise((resolve) => {
    console.log(`Resolving DNS for ${host}...`);
    dns.lookup(host, (err, address) => {
      if (err) {
        console.log(`❌ DNS Resolution for ${host} FAILED: ${err.message}`);
        resolve(null);
      } else {
        console.log(`✅ DNS Resolution for ${host} SUCCESS: ${address}`);
        resolve(address);
      }
    });
  });
}

async function checkPort(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 5000;
    
    socket.setTimeout(timeout);
    
    console.log(`Connecting to ${host}:${port}...`);
    
    socket.on('connect', () => {
      console.log(`✅ ${host}:${port} is REACHABLE!`);
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      console.log(`❌ ${host}:${port} TIMEOUT`);
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', (err) => {
      console.log(`❌ ${host}:${port} ERROR: [${err.code}] ${err.message}`);
      socket.destroy();
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

async function run() {
  await checkDns('smtp.post.cz');
  for (const target of targets) {
    await checkPort(target.host, target.port);
  }
}

run();
