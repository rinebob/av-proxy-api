const axios = require('axios');
const https = require('https');
require('dotenv').config({ path: '.env.alpha-vantage-proxy-api' });

const agent = new https.Agent({ family: 4 }); // Force IPv4

console.log('Key:', process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY);
axios.get('https://www.alphavantage.co/query', {
  params: {
    function: 'OVERVIEW',
    symbol: 'NVDA',
    apikey: process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY
  },
  timeout: 20000,
  httpsAgent: agent
}).then(res => {
  console.log(res.data);
}).catch(err => {
  console.error('AXIOS ERROR', err);
});