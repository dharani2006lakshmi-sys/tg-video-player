require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input'); // npm install input

const stringSession = new StringSession(''); // create a new session

(async () => {
  let apiId = parseInt(process.env.API_ID);
  let apiHash = process.env.API_HASH;

  if (!apiId || !apiHash) {
    console.log("We need your API credentials from my.telegram.org");
    apiId = parseInt(await input.text('Please enter your API_ID: '));
    apiHash = await input.text('Please enter your API_HASH: ');
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
