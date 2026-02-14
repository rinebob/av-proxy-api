
import axios from 'axios';

const API_KEY = process.env.ALPHAVANTAGE_API_KEY;
const SYMBOL = 'AAPL';

async function main() {
  if (!API_KEY) {
    console.error('ALPHAVANTAGE_API_KEY is required');
    process.exit(1);
  }

  console.log(`Testing AV API with key: ${API_KEY.slice(0, 4)}...`);
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=${SYMBOL}&apikey=${API_KEY}`;
  
  try {
    console.log(`Requesting: ${url.replace(API_KEY, '***')}`);
    const res = await axios.get(url);
    console.log('Status:', res.status);
    console.log('Data:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error('Request Failed:', err.message);
    if (err.response) {
      console.error('Response Status:', err.response.status);
      console.error('Response Data:', JSON.stringify(err.response.data, null, 2));
    }
  }
}

main();
