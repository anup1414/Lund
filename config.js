require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '8156079110:AABWYYRk8DkDjAnuQ9I0Fk-ONcQgA9KuQK',
  ADMIN_ID: process.env.ADMIN_ID || '1804574038',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://cap1432:cap1432@cluster0.kz6qtrq.mongodb.net/referbot?retryWrites=true&w=majority',
  
  ADMIN_USERNAME: 'cap1432',
  ADMIN_PASSWORD: 'cap1432',
  SESSION_SECRET: 'cap1432_super_secret_key_2025',
  BOT_USERNAME: '@Refer_and_earn000_bot',
  
  WELCOME_BONUS: 5,
  REFER_BONUS: 1.5,
  MIN_WITHDRAW: 20,
  
  WELCOME_MESSAGE: '🎉 *Swagat Hai {name}!* 🎉\n\n💎 Refer & Earn Bot mein aapka swagat hai!\n\n📌 *Pehle Ye Karo:*\n⭐ Niche diye sare channels join karo\n⭐ *₹5 instant* welcome bonus pao!'
};
