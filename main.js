import axios from 'axios';
import fs from 'fs/promises';
import FormData from 'form-data';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import blessed from 'blessed';
import { listEmails, getDomains } from 'mail-genie';

// Config
const SUCCESS_FILE = 'success.txt';
const TOKEN_FILE = 'gentoken.txt';
const MERKLE_API_URL = 'https://merklev2.cess.network/merkle';

// Utility Functions
function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/102.0'
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getHeaders(token = null, isMultipart = false) {
  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
    'Origin': 'https://cess.network',
    'Referer': 'https://cess.network/'
  };
  if (token) headers['token'] = token;
  return headers;
}

function getAxiosConfig(proxy, token = null, isMultipart = false) {
  const config = {
    headers: getHeaders(token, isMultipart),
    timeout: 60000,
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
    config.proxy = false;
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    logWindow.log(`{red-fg}Unsupported proxy type: ${proxy}{/red-fg}`);
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 3, backoff = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      if (method.toLowerCase() === 'get') {
        return await axios.get(url, config);
      } else if (method.toLowerCase() === 'post') {
        return await axios.post(url, payload, config);
      } else {
        throw new Error(`Method ${method} not supported.`);
      }
    } catch (error) {
      if (i < retries - 1) {
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      } else {
        throw error;
      }
    }
  }
}

async function readTokens(file) {
  try {
    const data = await fs.readFile(file, 'utf-8');
    const tokens = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (tokens.length === 0) {
      logWindow.log(`{red-fg}No tokens found in ${file}.{/red-fg}`);
      return [];
    }
    logWindow.log(`{green-fg}Loaded ${tokens.length} tokens from ${file}.{/green-fg}`);
    return tokens;
  } catch (error) {
    logWindow.log(`{red-fg}Error reading ${file}: ${error.message}{/red-fg}`);
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    return data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  } catch (error) {
    logWindow.log(`{red-fg}Error reading proxy.txt: ${error.message}{/red-fg}`);
    return [];
  }
}

async function getPublicIP(proxy) {
  try {
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, getAxiosConfig(proxy));
    return response?.data?.ip || 'IP not found';
  } catch (error) {
    return 'Error fetching IP';
  }
}

// Blessed UI Setup
const screen = blessed.screen({
  smartCSR: true,
  title: 'CESS-HACK-BOT',
  cursor: { color: '#00ff00' }
});

// Main Container
const container = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  style: { bg: 'black', fg: '#00ff00' }
});

// Status Bar
const statusBar = blessed.box({
  parent: container,
  top: 0,
  left: 0,
  width: '100%',
  height: 1,
  content: ' [CESS-HACK-BOT v1.0] - SYSTEM ONLINE ',
  style: { bg: '#00ff00', fg: 'black', bold: true }
});

// Log Window
const logWindow = blessed.log({
  parent: container,
  top: 1,
  left: 0,
  width: '70%',
  height: '90%',
  border: { type: 'line', fg: '#00ff00' },
  style: { fg: '#00ff00', bg: 'black', scrollbar: { bg: '#00ff00' } },
  scrollable: true,
  scrollbar: true,
  tags: true,
  padding: { left: 1, right: 1 }
});

// Info Panel
const infoPanel = blessed.box({
  parent: container,
  top: 1,
  right: 0,
  width: '30%',
  height: '90%',
  border: { type: 'line', fg: '#00ff00' },
  style: { fg: '#00ff00', bg: 'black' },
  content: '{center}SYSTEM INFO{/center}\n\nInitializing...',
  tags: true
});

// Input Box
const inputBox = blessed.textbox({
  parent: container,
  top: 'center',
  left: 'center',
  width: 40,
  height: 3,
  border: { type: 'line', fg: '#00ff00' },
  style: { fg: '#00ff00', bg: 'black' },
  hidden: true,
  inputOnFocus: true
});

// Key Bindings
screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

// Input Function
function getInput(promptText) {
  return new Promise((resolve) => {
    logWindow.log(`{yellow-fg}${promptText}{/yellow-fg}`);
    inputBox.setValue('');
    inputBox.show();
    screen.render();

    inputBox.once('submit', (value) => {
      inputBox.hide();
      screen.render();
      resolve(value.trim());
    });

    inputBox.focus();
    inputBox.readInput();
  });
}

// Status Message Function
let lastStatusLine = -1;
function showStatus(message) {
  if (lastStatusLine >= 0) {
    logWindow.setLine(lastStatusLine, `{yellow-fg}${message}{/yellow-fg}`);
  } else {
    lastStatusLine = logWindow.getLines().length;
    logWindow.log(`{yellow-fg}${message}{/yellow-fg}`);
  }
  screen.render();
}

function clearStatus() {
  lastStatusLine = -1;
  screen.render();
}

// Show Banner
function showBanner() {
  logWindow.log('{bold}{green-fg}>>> SYSTEM BOOT SEQUENCE INITIATED{/green-fg}{/bold}');
  logWindow.log('{green-fg}[[ CESS AUTO BOT ]] - BY NT EXHAUST{/green-fg}');
  logWindow.log('{green-fg}TELEGRAM: t.me/NTExhaust{/green-fg}');
  logWindow.log('{green-fg}----------------------------------{/green-fg}');
  screen.render();
}

// Update Info Panel
function updateInfoPanel(accountData, ip, index, total, points = 'N/A') {
  infoPanel.setContent(
    '{center}{bold}SYSTEM INFO{/bold}{/center}\n\n' +
    '{green-fg}ACCOUNT:{/green-fg}\n' +
    `INDEX: ${index + 1}/${total}\n` +
    `USERNAME: ${accountData?.username || 'N/A'}\n` +
    `UUID: ${accountData?.uuid || 'N/A'}\n` +
    `WALLET: ${accountData?.account || 'N/A'}\n` +
    `IP: ${ip || 'N/A'}\n` +
    `POINTS: ${points}\n\n` +
    '{green-fg}STATUS:ONLINE{/green-fg}\n' +
    '{green-fg}OK:{/green-fg}\n'
  );
  screen.render();
}

// Mode Selection UI
function getModeSelection() {
  return new Promise((resolve) => {
    const selectionBox = blessed.list({
      parent: container,
      top: 'center',
      left: 'center',
      width: 30,
      height: 8,
      border: { type: 'line', fg: '#00ff00' },
      style: {
        fg: '#00ff00',
        bg: 'black',
        selected: { bg: '#00ff00', fg: 'black', bold: true },
        item: { fg: '#00ff00' }
      },
      items: ['1. Auto Start', '2. Auto Reff'],
      keys: true,
      vi: true,
      mouse: true,
      label: '{center}SELECT MODE{/center}',
      tags: true
    });

    selectionBox.focus();

    selectionBox.on('select', (item) => {
      const selected = item.getText();
      selectionBox.detach();
      screen.render();
      resolve(selected);
    });

    screen.render();
  });
}

// File Selection UI for Auto Start
function getFileSelection() {
  return new Promise((resolve) => {
    const selectionBox = blessed.list({
      parent: container,
      top: 'center',
      left: 'center',
      width: 30,
      height: 6,
      border: { type: 'line', fg: '#00ff00' },
      style: {
        fg: '#00ff00',
        bg: 'black',
        selected: { bg: '#00ff00', fg: 'black', bold: true },
        item: { fg: '#00ff00' }
      },
      items: ['1. Main.txt', '2. Reff.txt'],
      keys: true,
      vi: true,
      mouse: true,
      label: '{center}SELECT TOKEN FILE{/center}',
      tags: true
    });

    selectionBox.focus();

    selectionBox.on('select', (item) => {
      const selected = item.getText();
      selectionBox.detach();
      screen.render();
      resolve(selected);
    });

    screen.render();
  });
}

// Referral Utility Functions
function generateRandomString(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function saveSuccess(email) {
  try {
    await fs.appendFile(SUCCESS_FILE, `${email}\n`, 'utf8');
    logWindow.log(`{green-fg}Saved email to ${SUCCESS_FILE}: ${email}{/green-fg}`);
  } catch (error) {
    logWindow.log(`{red-fg}Error saving to ${SUCCESS_FILE}: ${error.message}{/red-fg}`);
  }
}

async function saveToken(token) {
  try {
    await fs.appendFile(TOKEN_FILE, `${token}\n`, 'utf8');
    logWindow.log(`{green-fg}Saved token to ${TOKEN_FILE}{/green-fg}`);
  } catch (error) {
    logWindow.log(`{red-fg}Error saving to ${TOKEN_FILE}: ${error.message}{/red-fg}`);
  }
}

async function waitForEmail(email) {
  let waitingTime = 0;
  showStatus(`Waiting for verification email for ${email}...`);

  try {
    while (true) {
      const emails = await listEmails(email);
      if (emails.length > 0) {
        clearStatus();
        logWindow.log(`{green-fg}Email received for ${email} (${waitingTime}s){/green-fg}`);
        return emails[0];
      }
      waitingTime++;
      showStatus(`Waiting for verification email for ${email}... (${waitingTime}s)`);
      await delay(1);
    }
  } catch (error) {
    clearStatus();
    logWindow.log(`{red-fg}Email error for ${email}: ${error.message}{/red-fg}`);
    return null;
  }
}

async function makeReferralRequest(url, data, headers = {}, proxy = null) {
  const config = {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Content-Type': 'application/json',
      ...headers
    },
    httpsAgent: proxy ? newAgent(proxy) : null,
    timeout: 10000,
    proxy: proxy ? false : undefined
  };

  try {
    const response = await axios.post(url, data, config);
    return response.data;
  } catch (error) {
    throw error.response?.data || error.message;
  }
}

async function registerEmail(email, proxy) {
  return await makeReferralRequest(
    `${MERKLE_API_URL}/ecode`,
    { email },
    {},
    proxy
  );
}

async function loginWithCode(email, code, proxy) {
  const result = await makeReferralRequest(
    `${MERKLE_API_URL}/elogin`,
    { email, code },
    {},
    proxy
  );

  if (result?.code === 200) {
    return result.data; // Returns auth token
  }
  return null;
}

async function submitInvite(inviteCode, authToken, proxy) {
  return await makeReferralRequest(
    `${MERKLE_API_URL}/task/invite`,
    { code: inviteCode },
    { 'token': authToken },
    proxy
  );
}

function extractCode(emailBody) {
  const code = emailBody.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error('No verification code found');
  return code;
}

// Core Logic
let globalUseProxy = false;
let globalProxies = [];

async function initializeConfig() {
  logWindow.log('{yellow-fg}>>> INITIALIZING CONFIGURATION...{/yellow-fg}');
  globalProxies = await readProxies();
  if (globalProxies.length > 0) {
    globalUseProxy = true;
    logWindow.log(`{green-fg}Loaded ${globalProxies.length} proxies.{/green-fg}`);
  } else {
    logWindow.log('{yellow-fg}No proxies found in proxy.txt. Proceeding without proxy.{/yellow-fg}');
  }
}

async function processToken(token, index, total, proxy = null) {
  logWindow.log(`{cyan-fg}[[ACCOUNT ${index + 1}/${total}]]{/cyan-fg}`);
  updateInfoPanel(null, null, index, total);

  let statusRes;
  showStatus('Fetching account status...');
  try {
    const response = await requestWithRetry('get', 'https://merklev2.cess.network/merkle/task/status', null, getAxiosConfig(proxy, token));
    statusRes = response.data.data;
    clearStatus();
    logWindow.log('{green-fg}Account status retrieved.{/green-fg}');
  } catch (error) {
    clearStatus();
    logWindow.log(`{red-fg}Failed to fetch status: ${error.message}{/red-fg}`);
    return;
  }

  const accountData = statusRes.account;
  const ip = await getPublicIP(proxy);
  updateInfoPanel(accountData, ip, index, total);

  showStatus('Performing checkin...');
  try {
    const response = await requestWithRetry('post', 'https://merklev2.cess.network/merkle/task/checkin', {}, getAxiosConfig(proxy, token));
    clearStatus();
    if (response.data && response.data.code === 200) {
      logWindow.log(`{green-fg}Checkin successful, reward: ${response.data.data}{/green-fg}`);
    } else {
      logWindow.log(`{red-fg}Checkin failed: ${response.data.data || 'Invalid response'}{/red-fg}`);
    }
  } catch (error) {
    clearStatus();
    logWindow.log(`{red-fg}Checkin failed: ${error.message}{/red-fg}`);
  }

  for (let i = 0; i < 3; i++) {
    showStatus(`Uploading image ${i + 1}/3...`);
    try {
      const randomSeed = Math.floor(Math.random() * 100000);
      const imageUrl = `https://picsum.photos/seed/${randomSeed}/500/500`;
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = imageResponse.data;
      const generatedFilename = `image_${Date.now()}_${randomSeed}.png`;
      const form = new FormData();
      form.append('file', imageBuffer, {
        filename: generatedFilename,
        contentType: 'image/png'
      });
      form.append('user_uuid', accountData.uuid);
      form.append('output', 'json2');
      form.append('filename', generatedFilename);
      form.append('user_wallet', accountData.account);

      const uploadHeaders = {
        ...form.getHeaders(),
        'User-Agent': getRandomUserAgent(),
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://cess.network',
        'Referer': 'https://cess.network/'
      };

      const uploadConfig = {
        headers: uploadHeaders,
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        ...(proxy ? { httpsAgent: newAgent(proxy), proxy: false } : {})
      };

      const uploadResponse = await axios.post('https://filepool.cess.network/group1/upload', form, uploadConfig);
      clearStatus();
      if (uploadResponse.data && uploadResponse.data.status === 'ok') {
        logWindow.log(`{green-fg}Image ${i + 1}/3 uploaded successfully{/green-fg}`);
      } else {
        logWindow.log(`{red-fg}Image ${i + 1}/3 upload failed: ${JSON.stringify(uploadResponse.data)}{/red-fg}`);
      }
    } catch (error) {
      clearStatus();
      logWindow.log(`{red-fg}Image ${i + 1}/3 upload failed: ${error.message}{/red-fg}`);
    }
    await delay(1);
  }

  showStatus('Fetching total points...');
  try {
    const finalResponse = await requestWithRetry('get', 'https://merklev2.cess.network/merkle/task/status', null, getAxiosConfig(proxy, token));
    const finalPoints = finalResponse.data.data.account.points;
    clearStatus();
    logWindow.log(`{green-fg}Total Points: ${finalPoints}{/green-fg}`);
    updateInfoPanel(accountData, ip, index, total, finalPoints);
  } catch (error) {
    clearStatus();
    logWindow.log(`{red-fg}Failed to fetch points: ${error.message}{/red-fg}`);
  }
}

async function processReferral(index, total, proxy = null, inviteCode) {
  logWindow.log(`{cyan-fg}[[REFERRAL ${index + 1}/${total}]]{/cyan-fg}`);
  updateInfoPanel({ username: 'N/A', uuid: 'N/A', account: 'N/A' }, await getPublicIP(proxy), index, total);

  try {
    // Get random domain from mail-genie
    showStatus('Fetching email domains...');
    const domains = await getDomains();
    if (domains.length === 0) throw new Error('No domains available');
    const randomDomain = domains[Math.floor(Math.random() * domains.length)];
    const randomEmail = `${generateRandomString(12)}@${randomDomain}`;
    clearStatus();
    logWindow.log(`{magenta-fg}Generated email: ${randomEmail}{/magenta-fg}`);

    // Register email
    showStatus(`Registering email ${randomEmail}...`);
    await registerEmail(randomEmail, proxy);
    clearStatus();
    logWindow.log(`{blue-fg}Registration successful for ${randomEmail}{/blue-fg}`);

    // Get verification code
    const emailData = await waitForEmail(randomEmail);
    const verificationCode = extractCode(emailData.body.plaintext);
    logWindow.log(`{cyan-fg}Verification code: ${verificationCode}{/cyan-fg}`);

    // Login
    showStatus(`Logging in with ${randomEmail}...`);
    const authToken = await loginWithCode(randomEmail, verificationCode, proxy);
    if (!authToken) throw new Error('Login failed');
    clearStatus();
    logWindow.log(`{green-fg}Login successful for ${randomEmail}{/green-fg}`);

    // Submit invite
    showStatus('Submitting invite code...');
    const inviteResponse = await submitInvite(inviteCode, authToken, proxy);
    clearStatus();
    if (inviteResponse.code === 200) {
      logWindow.log(`{green-fg}Invite submitted successfully for ${randomEmail}{/green-fg}`);
      await saveSuccess(randomEmail);
      showStatus('Extracting and saving token...');
      await saveToken(authToken);
      clearStatus();
    } else {
      logWindow.log(`{red-fg}Invite submission failed: ${JSON.stringify(inviteResponse)}{/red-fg}`);
    }
  } catch (error) {
    clearStatus();
    logWindow.log(`{red-fg}Referral failed: ${error.message}{/red-fg}`);
  }
}

async function runCycle(mode, inviteCode = '', referralCount = 1, tokenFile = 'token.txt') {
  if (mode === '1. Auto Start') {
    const tokens = await readTokens(tokenFile);
    if (tokens.length === 0) {
      logWindow.log(`{red-fg}No tokens found in ${tokenFile}. Exiting...{/red-fg}`);
      return;
    }
    for (let i = 0; i < tokens.length; i++) {
      const proxy = globalUseProxy ? globalProxies[i % globalProxies.length] : null;
      try {
        await processToken(tokens[i], i, tokens.length, proxy);
      } catch (error) {
        logWindow.log(`{red-fg}Error on account ${i + 1}: ${error.message}{/red-fg}`);
      }
    }
  } else if (mode === '2. Auto Reff') {
    for (let i = 0; i < referralCount; i++) {
      const proxy = globalUseProxy ? globalProxies[i % globalProxies.length] : null;
      try {
        await processReferral(i, referralCount, proxy, inviteCode);
        await delay(2); // Delay between referrals
      } catch (error) {
        logWindow.log(`{red-fg}Error on referral ${i + 1}: ${error.message}{/red-fg}`);
      }
    }
  }
}

async function run() {
  showBanner();
  await initializeConfig();

  const selectedMode = await getModeSelection();
  logWindow.log(`{green-fg}Starting ${selectedMode} mode...{/green-fg}`);

  let inviteCode = '';
  let referralCount = 1;
  let tokenFile = 'token.txt';

  if (selectedMode === '1. Auto Start') {
    const selectedFile = await getFileSelection();
    logWindow.log(`{green-fg}Selected ${selectedFile}{/green-fg}`);
    if (selectedFile === '1. Main.txt') {
      tokenFile = 'token.txt';
      logWindow.log(`{green-fg}Loading tokens from token.txt{/green-fg}`);
    } else if (selectedFile === '2. Reff.txt') {
      tokenFile = 'gentoken.txt';
      logWindow.log(`{green-fg}Loading tokens from gentoken.txt{/green-fg}`);
    }
  } else if (selectedMode === '2. Auto Reff') {
    inviteCode = await getInput('Enter invite code:');
    if (!inviteCode) {
      logWindow.log('{red-fg}Invite code is required. Exiting...{/red-fg}');
      process.exit(0);
    }
    const countInput = await getInput('How many accounts to create? (default: 1)');
    referralCount = parseInt(countInput) || 1;
    if (referralCount < 1) {
      logWindow.log('{red-fg}Invalid account count. Exiting...{/red-fg}');
      process.exit(0);
    }
    logWindow.log(`{green-fg}Using invite code: ${inviteCode}, creating ${referralCount} accounts{/green-fg}`);
  }

  while (true) {
    await runCycle(selectedMode, inviteCode, referralCount, tokenFile);
    if (selectedMode === '2. Auto Reff') {
      logWindow.log('{green-fg}Referral cycle completed. Exiting...{/green-fg}');
      logWindow.log('{blue-fg}To access your accounts:\n' +
        '1. Go to https://cess.network/deshareairdrop/login\n' +
        '2. Use email from success.txt\n' +
        '3. Check verification code at https://generator.email/<email>\n' +
        '4. Login with the code{/blue-fg}');
      break;
    } else {
      logWindow.log('{green-fg}Cycle completed. Waiting 24 hours...{/green-fg}');
      await delay(86400);
    }
  }
}

run();
