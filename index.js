const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { User, Withdrawal, Settings, Channel, JoinRequest, BroadcastLog } = require('./models');
const { BOT_TOKEN, ADMIN_ID, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, BOT_USERNAME, WELCOME_BONUS, REFER_BONUS, MIN_WITHDRAW, WELCOME_MESSAGE } = require('./config');

// Express App
const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Telegram Bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Helper Functions
async function getSetting(key, defaultValue) {
  const setting = await Settings.findOne({ key });
  return setting ? setting.value : defaultValue;
}

async function setSetting(key, value) {
  await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true, new: true });
}

// Check if user joined all channels
async function checkAllChannels(userId) {
  const channels = await Channel.find({ isActive: true });
  if (channels.length === 0) return true;
  
  for (const ch of channels) {
    try {
      let chatId = ch.channelId;
      // Handle both public and private channels
      if (!ch.isPrivate && ch.channelId.startsWith('@')) {
        chatId = ch.channelId;
      }
      const member = await bot.getChatMember(chatId, userId);
      if (!['member', 'administrator', 'creator'].includes(member.status)) {
        return false;
      }
    } catch (error) {
      console.error(`Error checking channel ${ch.name}:`, error.message);
      return false;
    }
  }
  return true;
}

// Generate channel buttons with join requests for private channels
async function channelButtons() {
  const channels = await Channel.find({ isActive: true });
  const buttons = [];
  
  for (const ch of channels) {
    buttons.push([{ text: `📢 ${ch.name}`, url: ch.link }]);
  }
  
  buttons.push([{ text: '✅ Joined — Verify Karo', callback_data: 'verify_join' }]);
  return { inline_keyboard: buttons };
}

async function mainMenu(referCode) {
  return {
    inline_keyboard: [
      [{ text: '💰 Balance', callback_data: 'balance' }, { text: '🔗 Refer Link', callback_data: 'refer' }],
      [{ text: '💸 Withdraw', callback_data: 'withdraw' }, { text: '📊 Status', callback_data: 'status' }],
      [{ text: '🏆 Leaderboard', callback_data: 'leaderboard' }, { text: '📜 History', callback_data: 'history' }],
      [{ text: '🆘 Support', url: 'https://t.me/gunman_000' }]
    ]
  };
}

// Initialize default settings and channels
async function initSettings() {
  await setSetting('welcome_bonus', WELCOME_BONUS);
  await setSetting('refer_bonus', REFER_BONUS);
  await setSetting('min_withdraw', MIN_WITHDRAW);
  await setSetting('welcome_message', WELCOME_MESSAGE);
  
  // Add default channels if none exist
  const channelCount = await Channel.countDocuments();
  if (channelCount === 0) {
    await Channel.create({
      channelId: '@YourChannel1',
      link: 'https://t.me/YourChannel1',
      name: 'Channel 1',
      isActive: true,
      isPrivate: false
    });
  }
}
initSettings();

// ─── BOT COMMANDS ─────────────────────────────────────────────────────────────

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const referParam = match[1].trim();
  const referrerId = referParam ? referParam.replace('_ref_', '') : null;

  let user = await User.findOne({ telegramId: userId });

  if (user && user.banned) {
    return bot.sendMessage(chatId, '❌ Aapko admin ne ban kar diya hai!');
  }

  if (!user) {
    user = new User({
      telegramId: userId,
      username: msg.from.username || '',
      firstName: msg.from.first_name || '',
      lastName: msg.from.last_name || '',
      balance: 0,
      referredBy: referrerId && referrerId !== String(userId) ? referrerId : null,
      referCode: String(userId),
      joinedChannels: false,
      pendingReferBonus: referrerId && referrerId !== String(userId) ? referrerId : null,
      ipHash: msg.from.id.toString(),
      deviceInfo: JSON.stringify({ language: msg.from.language_code })
    });
    await user.save();
  }

  const joined = await checkAllChannels(userId);

  if (!joined) {
    const welcomeMsg = await getSetting('welcome_message', WELCOME_MESSAGE);
    const formattedMsg = welcomeMsg.replace('{name}', msg.from.first_name);
    await bot.sendMessage(chatId, formattedMsg, { parse_mode: 'Markdown', reply_markup: await channelButtons() });
    return;
  }

  if (!user.joinedChannels) {
    user.joinedChannels = true;
    const welcomeBonus = await getSetting('welcome_bonus', 5);
    user.balance += welcomeBonus;
    await user.save();
    
    await bot.sendMessage(chatId,
      `✅ *Verification Successful!*\n\n🎁 *₹${welcomeBonus} Welcome Bonus* add ho gaya!\n💰 Balance: *₹${user.balance.toFixed(2)}*`,
      { parse_mode: 'Markdown', reply_markup: await mainMenu(user.referCode) }
    );

    if (user.pendingReferBonus) {
      const referBonus = await getSetting('refer_bonus', 1.5);
      const referrer = await User.findOne({ telegramId: user.pendingReferBonus });
      if (referrer && !referrer.banned) {
        referrer.balance += referBonus;
        referrer.referCount = (referrer.referCount || 0) + 1;
        await referrer.save();
        await bot.sendMessage(referrer.telegramId,
          `🎉 *Refer Bonus!*\n👤 ${user.firstName}\n💰 +₹${referBonus}`,
          { parse_mode: 'Markdown' }
        );
      }
      user.pendingReferBonus = null;
      await user.save();
    }
  } else {
    await bot.sendMessage(chatId,
      `👋 *Wapas Aaye ${msg.from.first_name}!*\n💰 Balance: *₹${user.balance.toFixed(2)}*`,
      { parse_mode: 'Markdown', reply_markup: await mainMenu(user.referCode) }
    );
  }
});

// Admin command to add welcome message
bot.onText(/\/addwelcome (.+)/, async (msg, match) => {
  if (String(msg.from.id) !== ADMIN_ID) return;
  const newMessage = match[1];
  await setSetting('welcome_message', newMessage);
  bot.sendMessage(msg.chat.id, `✅ Welcome message updated!`);
});

// Callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  await bot.answerCallbackQuery(query.id);
  
  const user = await User.findOne({ telegramId: userId });
  if (user && user.banned) return bot.sendMessage(chatId, '❌ Banned!');

  if (data === 'verify_join') {
    const joined = await checkAllChannels(userId);
    if (!joined) {
      return bot.sendMessage(chatId, `❌ *Channels join nahi kiye!*`, { parse_mode: 'Markdown', reply_markup: await channelButtons() });
    }
    
    if (!user.joinedChannels) {
      user.joinedChannels = true;
      const welcomeBonus = await getSetting('welcome_bonus', 5);
      user.balance += welcomeBonus;
      await user.save();
      
      await bot.sendMessage(chatId,
        `✅ *Verified!* 🎁 ₹${welcomeBonus} mila!\n💰 Balance: ₹${user.balance.toFixed(2)}`,
        { parse_mode: 'Markdown', reply_markup: await mainMenu(user.referCode) }
      );
      
      if (user.pendingReferBonus) {
        const referBonus = await getSetting('refer_bonus', 1.5);
        const referrer = await User.findOne({ telegramId: user.pendingReferBonus });
        if (referrer && !referrer.banned) {
          referrer.balance += referBonus;
          referrer.referCount = (referrer.referCount || 0) + 1;
          await referrer.save();
          await bot.sendMessage(referrer.telegramId, `🎉 Refer Bonus! +₹${referBonus}`);
        }
        user.pendingReferBonus = null;
        await user.save();
      }
    }
    return;
  }
  
  if (data === 'balance') {
    return bot.sendMessage(chatId, `💰 Balance: ₹${user.balance.toFixed(2)}`, { parse_mode: 'Markdown', reply_markup: await mainMenu(user.referCode) });
  }
  
  if (data === 'refer') {
    const link = `https://t.me/${BOT_USERNAME.replace('@', '')}?start=_ref_${user.referCode}`;
    const referBonus = await getSetting('refer_bonus', 1.5);
    return bot.sendMessage(chatId,
      `🔗 *Refer Link*\n\`${link}\`\n\n💰 Per Refer: ₹${referBonus}\n👥 Total: ${user.referCount || 0}`,
      { parse_mode: 'Markdown', reply_markup: await mainMenu(user.referCode) }
    );
  }
  
  if (data === 'withdraw') {
    const minWithdraw = await getSetting('min_withdraw', 20);
    if (user.balance < minWithdraw) {
      return bot.sendMessage(chatId, `❌ Minimum withdrawal: ₹${minWithdraw}`);
    }
    if (user.withdrawPending) {
      return bot.sendMessage(chatId, `⏳ Already pending!`);
    }
    user.awaitingUpi = true;
    await user.save();
    return bot.sendMessage(chatId, `💸 Type your UPI ID:`);
  }
  
  if (data === 'leaderboard') {
    const top = await User.find({ banned: { $ne: true } }).sort({ referCount: -1 }).limit(10);
    const text = top.map((u, i) => `${i+1}. ${u.firstName} — ${u.referCount || 0} refers`).join('\n');
    return bot.sendMessage(chatId, `🏆 *Top Referrers*\n\n${text}`, { parse_mode: 'Markdown' });
  }
});

// UPI Handler
bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const user = await User.findOne({ telegramId: userId });
  if (!user || !user.awaitingUpi) return;
  
  const upiId = msg.text.trim();
  if (!upiId.includes('@')) {
    return bot.sendMessage(chatId, `❌ Valid UPI ID!`);
  }
  
  const amount = user.balance;
  user.balance = 0;
  user.awaitingUpi = false;
  user.withdrawPending = true;
  user.totalWithdrawn = (user.totalWithdrawn || 0) + amount;
  await user.save();
  
  const withdrawal = new Withdrawal({ userId, upiId, amount, status: 'pending' });
  await withdrawal.save();
  
  await bot.sendMessage(chatId, `✅ Withdrawal Request Sent!\n💰 ₹${amount}\n📲 ${upiId}\n⏳ Pending`, { parse_mode: 'Markdown' });
  await bot.sendMessage(ADMIN_ID, `🔔 New Withdrawal!\n👤 ${msg.from.first_name}\n💰 ₹${amount}\n📲 ${upiId}`);
});

// ─── EXPRESS ROUTES (Admin Panel) ─────────────────────────────────────────────

function isAuthenticated(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'Invalid credentials!' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({ banned: false });
  const totalWithdrawn = await Withdrawal.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
  const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
  const totalChannels = await Channel.countDocuments({ isActive: true });
  
  res.render('dashboard', { totalUsers, activeUsers, totalWithdrawn: totalWithdrawn[0]?.total || 0, pendingWithdrawals, totalChannels });
});

app.get('/users', isAuthenticated, async (req, res) => {
  const search = req.query.search || '';
  let query = {};
  if (search) {
    query = {
      $or: [
        { telegramId: search },
        { firstName: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ]
    };
  }
  const users = await User.find(query).sort({ createdAt: -1 }).limit(100);
  res.render('users', { users, search });
});

app.get('/user/:id', isAuthenticated, async (req, res) => {
  const user = await User.findOne({ telegramId: req.params.id });
  const withdrawals = await Withdrawal.find({ userId: req.params.id }).sort({ createdAt: -1 });
  if (!user) return res.send('User not found');
  res.render('user_detail', { user, withdrawals });
});

app.post('/user/addbalance', isAuthenticated, async (req, res) => {
  const { userId, amount } = req.body;
  const user = await User.findOne({ telegramId: userId });
  if (user) {
    user.balance += parseFloat(amount);
    await user.save();
    await bot.sendMessage(userId, `🎁 Admin ne *₹${amount}* add kar diya!\n💰 New Balance: *₹${user.balance.toFixed(2)}*`, { parse_mode: 'Markdown' });
  }
  res.redirect(`/user/${userId}`);
});

app.post('/user/toggleban', isAuthenticated, async (req, res) => {
  const { userId } = req.body;
  const user = await User.findOne({ telegramId: userId });
  if (user) {
    user.banned = !user.banned;
    await user.save();
    await bot.sendMessage(userId, user.banned ? '❌ You have been banned!' : '✅ You have been unbanned!');
  }
  res.redirect(`/user/${userId}`);
});

app.get('/withdrawals', isAuthenticated, async (req, res) => {
  const status = req.query.status || 'pending';
  const withdrawals = await Withdrawal.find({ status }).sort({ createdAt: -1 });
  res.render('withdrawals', { withdrawals, status });
});

app.post('/withdraw/approve', isAuthenticated, async (req, res) => {
  const { withdrawalId, userId, amount } = req.body;
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (withdrawal) {
    withdrawal.status = 'paid';
    await withdrawal.save();
    const user = await User.findOne({ telegramId: userId });
    if (user) {
      user.withdrawPending = false;
      await user.save();
      await bot.sendMessage(userId, `✅ *Withdrawal Approved!*\n💰 ₹${amount} sent to your UPI!`, { parse_mode: 'Markdown' });
    }
  }
  res.redirect('/withdrawals');
});

app.post('/withdraw/reject', isAuthenticated, async (req, res) => {
  const { withdrawalId, userId, amount } = req.body;
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (withdrawal) {
    withdrawal.status = 'rejected';
    await withdrawal.save();
    const user = await User.findOne({ telegramId: userId });
    if (user) {
      user.balance += parseFloat(amount);
      user.withdrawPending = false;
      await user.save();
      await bot.sendMessage(userId, `❌ *Withdrawal Rejected*\n₹${amount} added back.`, { parse_mode: 'Markdown' });
    }
  }
  res.redirect('/withdrawals');
});

// ─── CHANNEL MANAGEMENT (PRIVATE CHANNEL SUPPORT) ─────────────────────────────

app.get('/channels', isAuthenticated, async (req, res) => {
  const channels = await Channel.find({});
  const joinRequests = await JoinRequest.find({ status: 'pending' }).populate('userId');
  res.render('channels', { channels, joinRequests });
});

app.post('/channels/add', isAuthenticated, async (req, res) => {
  const { channelId, link, name, isPrivate } = req.body;
  await Channel.create({
    channelId: channelId.trim(),
    link: link.trim(),
    name: name.trim(),
    isActive: true,
    isPrivate: isPrivate === 'on'
  });
  res.redirect('/channels');
});

app.post('/channels/toggle', isAuthenticated, async (req, res) => {
  const { channelId, isActive } = req.body;
  await Channel.findByIdAndUpdate(channelId, { isActive: isActive === 'true' });
  res.redirect('/channels');
});

app.post('/channels/delete', isAuthenticated, async (req, res) => {
  const { channelId } = req.body;
  await Channel.findByIdAndDelete(channelId);
  res.redirect('/channels');
});

// Test channel verification
app.post('/channels/test', isAuthenticated, async (req, res) => {
  const { userId } = req.body;
  const channels = await Channel.find({ isActive: true });
  const results = [];
  
  for (const ch of channels) {
    try {
      let chatId = ch.channelId;
      if (!ch.isPrivate && ch.channelId.startsWith('@')) {
        chatId = ch.channelId;
      }
      const member = await bot.getChatMember(chatId, userId);
      results.push({ name: ch.name, status: member.status, isMember: ['member', 'administrator', 'creator'].includes(member.status) });
    } catch (error) {
      results.push({ name: ch.name, status: 'ERROR', isMember: false, error: error.message });
    }
  }
  
  let html = '<h3>Test Results:</h3><ul>';
  results.forEach(r => {
    html += `<li>${r.name}: ${r.isMember ? '✅ Member' : '❌ Not Member'} (${r.status})</li>`;
  });
  html += '</ul><a href="/channels">Back</a>';
  res.send(html);
});

// Broadcast
app.get('/broadcast', isAuthenticated, (req, res) => {
  res.render('broadcast');
});

app.post('/broadcast/send', isAuthenticated, async (req, res) => {
  const { message } = req.body;
  const users = await User.find({ banned: false });
  let sent = 0, failed = 0;
  
  for (const user of users) {
    try {
      await bot.sendMessage(user.telegramId, `📢 *Admin Broadcast:*\n\n${message}`, { parse_mode: 'Markdown' });
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }
  
  await BroadcastLog.create({ message, sentCount: sent, failedCount: failed });
  res.redirect('/broadcast');
});

// Settings
app.get('/settings', isAuthenticated, async (req, res) => {
  const welcomeBonus = await getSetting('welcome_bonus', 5);
  const referBonus = await getSetting('refer_bonus', 1.5);
  const minWithdraw = await getSetting('min_withdraw', 20);
  const welcomeMessage = await getSetting('welcome_message', WELCOME_MESSAGE);
  
  res.render('settings', { welcomeBonus, referBonus, minWithdraw, welcomeMessage });
});

app.post('/settings/update', isAuthenticated, async (req, res) => {
  const { welcome_bonus, refer_bonus, min_withdraw, welcome_message } = req.body;
  await setSetting('welcome_bonus', parseFloat(welcome_bonus));
  await setSetting('refer_bonus', parseFloat(refer_bonus));
  await setSetting('min_withdraw', parseFloat(min_withdraw));
  await setSetting('welcome_message', welcome_message);
  res.redirect('/settings');
});

// Start server
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/referbot')
  .then(() => {
    console.log('✅ MongoDB connected!');
    app.listen(PORT, () => {
      console.log(`✅ Admin Panel: https://ushnnsns.herokuapp.com`);
      console.log(`🔐 Login: cap1432 / cap1432`);
    });
  })
  .catch(err => console.error('MongoDB error:', err));

module.exports = { bot, app };
