require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input'); // npm install input

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(''); // create a new session

(async () => {
  if (!apiId || !apiHash) {
    console.error("Please set API_ID and API_HASH in your .env file or environment variables.");
    process.exit(1);
  }

  console.log('Loading interactive example...');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('Please enter your number (with country code): '),
    password: async () => await input.text('Please enter your password (if you have 2FA): '),
    phoneCode: async () => await input.text('Please enter the code you received: '),
    onError: (err) => console.log(err),
  });

  console.log('You should now be connected.');
  console.log('Save this string to your Render Environment Variables as SESSION_STRING:');
  console.log('\n' + client.session.save() + '\n');
  
  process.exit(0);
})();
